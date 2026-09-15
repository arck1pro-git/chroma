// A geração do artigo: matéria real + auditoria do blog → rascunho.
//
// POR QUE É UM MÓDULO E NÃO CÓDIGO DA ROTA: dois caminhos chegam aqui — a
// geração manual (/api/artigos/generate, alguém colou um link) e a automática
// (/api/blogs/rss/gerar, o n8n na segunda de manhã). O prompt, o schema da
// resposta e as regras de normalização TÊM que ser os mesmos nos dois: um
// artigo gerado pela automação não pode sair com estrutura diferente do gerado
// à mão, senão o checklist de SEO mede duas coisas distintas.
//
// AS TRÊS REGRAS QUE ESTE MÓDULO SUSTENTA:
//
// 1. Artigo nasce de matéria real. O link é lido ANTES de chamar o modelo, e se
//    a leitura falhar nada é gerado — nunca se escreve "por cima do título".
// 2. A auditoria manda no ângulo e no tom, não no formato. Ela pode ter sido
//    escrita para carrossel; aqui a saída é artigo, e o prompt diz isso.
// 3. NADA É GRAVADO AQUI. Quem devolve é um rascunho em memória; gravar é
//    decisão de quem chamou (a tela, depois da prévia; ou a rota de RSS, que
//    grava direto porque não há ninguém para aprovar às 8h da segunda).
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import { slugify, type ArtigoRascunho } from "@/lib/artigo";
import { campo } from "@/lib/blog";
import { FalhaMateria, MENSAGEM_FALHA, lerMateria } from "@/lib/artigo-materia";
import { SEM_CREDENCIAL } from "@/lib/ia/conversa";

// O modelo é fixo (e não IA_MODELO como no painel do CRM): o artigo é texto
// longo com estrutura, FAQ e regras de SEO simultâneas — é o trabalho para o
// qual o Opus foi escolhido, e trocá-lo por engano degradaria a saída sem
// nenhum aviso na tela.
const MODELO = "claude-opus-5";

export type Tamanho = "curto" | "medio" | "longo";

export const ALVOS: Record<Tamanho, { palavras: string; secoes: string }> = {
  curto: { palavras: "700 a 900", secoes: "3 a 4" },
  medio: { palavras: "1200 a 1500", secoes: "4 a 6" },
  longo: { palavras: "1800 a 2200", secoes: "6 a 8" },
};

export function tamanhoValido(bruto: unknown): Tamanho {
  const s = campo(bruto, 20);
  return s === "curto" || s === "longo" || s === "medio" ? s : "medio";
}

/** Erro com o status HTTP que a rota deve devolver. */
export class FalhaGeracao extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "FalhaGeracao";
  }
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "titulo",
    "slug",
    "meta_title",
    "meta_description",
    "palavra_chave",
    "keywords",
    "resumo",
    "imagem_alt",
    "conteudo",
  ],
  properties: {
    titulo: { type: "string", description: "H1 do artigo, 55 a 70 caracteres." },
    slug: {
      type: "string",
      description: "minusculas-com-hifen, no maximo 6 palavras.",
    },
    meta_title: {
      type: "string",
      description: "Ate 60 caracteres, palavra-chave no inicio.",
    },
    meta_description: {
      type: "string",
      description:
        "Entre 120 e 155 caracteres. Nunca passar de 155 — o Google trunca.",
    },
    palavra_chave: { type: "string", description: "Palavra-chave principal." },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "5 a 8 termos secundarios e cauda longa.",
    },
    resumo: {
      type: "string",
      description: "Chamada de 2 frases para a listagem do blog.",
    },
    imagem_alt: {
      type: "string",
      description: "Texto alternativo da capa, com a palavra-chave.",
    },
    conteudo: {
      type: "string",
      description: "Corpo do artigo em markdown, sem repetir o H1.",
    },
  },
} as const;

interface DadosPrompt {
  blog: { nome: string; descricao: string; autor: string };
  auditoria: { nome: string; conteudo: string };
  vizinhos: { titulo: string; slug: string }[];
  materia: { titulo: string; url: string; texto: string };
  palavraChave: string;
  instrucoes: string;
  tamanho: Tamanho;
}

/**
 * O prompt. A ordem das seções é deliberada: BLOG e LINKS INTERNOS antes do
 * MATERIAL, MATERIAL antes da AUDITORIA, e as REGRAS por último — o que vem
 * depois pesa mais na hora de escrever, e as restrições são o que não pode ser
 * esquecido no fim de um texto longo.
 */
function montarPrompt(d: DadosPrompt): string {
  const alvo = ALVOS[d.tamanho];

  const linksInternos = d.vizinhos.length
    ? [
        "## ARTIGOS JÁ PUBLICADOS NESTE BLOG (use como link interno quando fizer sentido)",
        ...d.vizinhos.map((a) => `- [${a.titulo}](/${a.slug})`),
      ].join("\n")
    : [
        "## LINKS INTERNOS",
        "Este blog ainda não tem outros artigos. Crie de 2 a 3 links internos para pautas",
        "vizinhas usando slugs plausíveis no formato /slug-do-artigo — o time ajusta depois.",
      ].join("\n");

  // As seções opcionais entram como `null`, e não como string vazia: a string
  // vazia É uma linha em branco do layout do prompt, e um filter(Boolean)
  // colaria todas as seções umas nas outras.
  const linhas: (string | null)[] = [
    "Você é redator de conteúdo SEO para blog corporativo. Escreve em português do Brasil.",
    "",
    "Sua tarefa: transformar o MATERIAL abaixo (uma matéria real) em um ARTIGO DE BLOG",
    "otimizado para busca orgânica, seguindo a AUDITORIA que orienta este blog.",
    "",
    "A AUDITORIA é a única fonte de verdade sobre a marca, o posicionamento e o que pode",
    "ou não ser dito. Não invente nada sobre a empresa que não esteja escrito nela nem",
    "no MATERIAL.",
    "",
    "## BLOG",
    `Nome: ${d.blog.nome}`,
    d.blog.descricao ? `Sobre: ${d.blog.descricao}` : null,
    d.blog.autor ? `Assinado por: ${d.blog.autor}` : null,
    "",
    linksInternos,
    "",
    `## MATERIAL (matéria: "${d.materia.titulo || "sem título"}" — ${d.materia.url})`,
    d.materia.texto,
    "",
    `## AUDITORIA DESTE BLOG — "${d.auditoria.nome}" (diretrizes obrigatórias)`,
    d.auditoria.conteudo,
    "",
    "### Como aplicar a auditoria a um artigo de blog",
    "A auditoria acima manda no ÂNGULO, no TOM, nos critérios editoriais e no que pode",
    "ou não ser dito. Ela NÃO manda no formato: mesmo que tenha sido escrita para",
    "carrossel, Reels ou vídeo, aqui a saída é um artigo de blog. Ignore instruções de",
    "slide, de gancho de retenção, de contagem de caracteres por tela, de CTA de story",
    "e de duração — e transponha a lógica editorial dela para a estrutura de artigo",
    "descrita abaixo. Onde a auditoria conflitar com o formato, o formato de artigo vence.",
    "",
    d.palavraChave ? `## PALAVRA-CHAVE OBRIGATÓRIA\n${d.palavraChave}\n` : null,
    d.instrucoes ? `## INSTRUÇÕES EXTRAS DO EDITOR\n${d.instrucoes}\n` : null,
    '## COMO ESTRUTURAR O ARTIGO (campo "conteudo", em markdown)',
    "",
    '1. NÃO repita o título como "# " no corpo — o H1 vai no campo "titulo".',
    "2. Abertura de 2 ou 3 parágrafos curtos que respondem à intenção de busca já nas",
    "   primeiras linhas. A palavra-chave principal precisa aparecer no primeiro parágrafo.",
    `3. ${alvo.secoes} seções com "## ". Use "### " para subdividir quando a seção for longa.`,
    "   Os títulos das seções devem ser descritivos e conter variações da palavra-chave —",
    "   eles viram o índice clicável do artigo.",
    "4. Pelo menos um link ancorado para outra seção DESTE artigo, no meio do texto.",
    "   A âncora é o título da seção em minúsculas, sem acento, com hífen no lugar do espaço.",
    '   Ex.: se existe a seção "## Como calcular o retorno", escreva',
    '   "veja [como calcular o retorno](#como-calcular-o-retorno)".',
    "5. De 2 a 3 links internos para outras páginas do blog, no formato [texto](/slug).",
    "6. Cite a matéria de origem ao menos uma vez como link externo markdown apontando",
    `   para ${d.materia.url}.`,
    '7. Inclua pelo menos uma lista (com "- " ou numerada). Se houver comparação ou',
    '   números, monte uma tabela markdown com "|".',
    '8. Use uma citação em bloco ("> ") para destacar o dado mais forte da matéria.',
    '9. Termine com "## Perguntas frequentes" contendo de 3 a 5 perguntas, cada uma como',
    '   "### " com a pergunta que a pessoa digitaria no Google — primeira letra maiúscula',
    "   e ponto de interrogação no fim — e a resposta logo abaixo em 40 a 60 palavras,",
    "   direta e completa em si mesma.",
    '10. Depois da FAQ, feche com "## Conclusão" trazendo o próximo passo (CTA) coerente',
    "    com o que a auditoria posiciona. Sem promessa de resultado garantido.",
    "",
    "## REGRAS",
    `- Tamanho alvo: ${alvo.palavras} palavras no campo "conteudo".`,
    "- Só use números, datas e nomes que estejam no MATERIAL. Não invente dado, pesquisa,",
    "  preço ou estatística. Se a matéria não traz um número, escreva sem número.",
    "- Frases curtas (média abaixo de 25 palavras) e parágrafos de no máximo 4 linhas.",
    "- Distribua a palavra-chave de forma natural: entre 0,5% e 2,5% do texto.",
    '- Nada de "neste artigo você vai ver", "no mundo atual", "cada vez mais" nem',
    "  linguagem de release. Escreva como especialista explicando para um cliente.",
    "- Respeite integralmente as restrições e proibições escritas na auditoria.",
    '- Não escreva o índice/sumário à mão: ele é gerado a partir dos "## " e "### ".',
    "",
    "Responda apenas com o JSON no formato pedido.",
  ];

  return linhas.filter((l): l is string => l !== null).join("\n");
}

/**
 * Rede de segurança do parse. Com structured output o texto normalmente já vem
 * JSON puro; este recorte cobre o caso em que sobra alguma palavra em volta.
 */
function extrairJson(texto: string): Record<string, unknown> | null {
  const tentar = (s: string) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const direto = tentar(texto);
  if (direto) return direto;

  const abre = texto.indexOf("{");
  const fecha = texto.lastIndexOf("}");
  if (abre === -1 || fecha <= abre) return null;
  return tentar(texto.slice(abre, fecha + 1));
}

export interface PedidoGeracao {
  blogId: number;
  link: string;
  newsTitle?: string;
  palavraChave?: string;
  tamanho?: Tamanho;
  instrucoes?: string;
}

export interface ResultadoGeracao {
  artigo: ArtigoRascunho;
  fonte_titulo: string;
  fonte_url: string;
}

/**
 * O caminho inteiro: valida o blog, lê a matéria, monta o prompt e normaliza a
 * resposta. Lança FalhaGeracao com o status HTTP que a rota deve devolver.
 */
export async function gerarArtigoDeMateria(
  pedido: PedidoGeracao,
): Promise<ResultadoGeracao> {
  const { blogId } = pedido;
  const link = campo(pedido.link, 2000);
  const newsTitle = campo(pedido.newsTitle, 500);
  const palavraChave = campo(pedido.palavraChave, 200);
  const instrucoes = campo(pedido.instrucoes, 4000);
  const tamanho = pedido.tamanho ?? "medio";

  // ── Blog e auditoria ──────────────────────────────────────────────────────
  const [blog] = await sql`
    SELECT id, nome, descricao, autor, auditoria_id FROM blog WHERE id = ${blogId}`;
  if (!blog) throw new FalhaGeracao(404, "Blog não encontrado.");
  if (!blog.auditoria_id) {
    throw new FalhaGeracao(
      400,
      "Este blog não tem auditoria vinculada. Edite o blog e escolha uma.",
    );
  }

  // ── A matéria, antes de qualquer token gasto ──────────────────────────────
  let materia;
  try {
    materia = await lerMateria(link);
  } catch (e) {
    const codigo = e instanceof FalhaMateria ? e.codigo : "FALHA";
    throw new FalhaGeracao(502, MENSAGEM_FALHA[codigo]);
  }

  const [auditoria] = await sql`
    SELECT nome, conteudo FROM contextos WHERE id = ${blog.auditoria_id}`;
  if (!auditoria) {
    throw new FalhaGeracao(
      404,
      "A auditoria deste blog não existe mais. Edite o blog e escolha outra.",
    );
  }

  // Vizinhos: link interno REAL em vez de slug inventado.
  const vizinhos = await sql`
    SELECT titulo, slug FROM artigo
    WHERE blog_id = ${blogId} AND slug <> ''
    ORDER BY created_at DESC
    LIMIT 12`;

  const prompt = montarPrompt({
    blog: {
      nome: blog.nome as string,
      descricao: (blog.descricao as string) ?? "",
      autor: (blog.autor as string) ?? "",
    },
    auditoria: {
      nome: auditoria.nome as string,
      conteudo: auditoria.conteudo as string,
    },
    vizinhos: vizinhos as unknown as { titulo: string; slug: string }[],
    materia: { titulo: newsTitle, url: materia.url, texto: materia.texto },
    palavraChave,
    instrucoes,
    tamanho,
  });

  // ── O modelo ──────────────────────────────────────────────────────────────
  let mensagem: Anthropic.Message;
  try {
    // Streaming não é enfeite: um artigo "longo" com max_tokens alto estoura o
    // timeout HTTP do SDK sem ele. finalMessage() espera o fim do stream.
    const fluxo = new Anthropic().messages.stream({
      model: MODELO,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [{ role: "user", content: prompt }],
    });
    mensagem = await fluxo.finalMessage();
  } catch (e) {
    const detalhe =
      e instanceof Anthropic.AuthenticationError ||
      (e instanceof Error &&
        e.message.includes("Could not resolve authentication method"))
        ? SEM_CREDENCIAL
        : `Erro Claude: ${e instanceof Error ? e.message : String(e)}`;
    throw new FalhaGeracao(502, detalhe);
  }

  if (mensagem.stop_reason === "refusal") {
    throw new FalhaGeracao(
      502,
      "A IA recusou gerar o artigo a partir desta matéria. Escolha outra pauta.",
    );
  }

  const texto = mensagem.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!texto) throw new FalhaGeracao(500, "A IA não retornou conteúdo.");

  const dados = extrairJson(texto);
  if (!dados) {
    throw new FalhaGeracao(
      502,
      "A IA devolveu um formato inesperado. Tente de novo.",
    );
  }

  // ── Normalização ──────────────────────────────────────────────────────────
  const titulo = campo(dados.titulo, 500) || newsTitle || "Artigo sem título";
  const conteudo = campo(dados.conteudo, 200_000);
  if (!conteudo) {
    throw new FalhaGeracao(502, "A IA não devolveu o corpo do artigo.");
  }

  const keywords = Array.isArray(dados.keywords)
    ? dados.keywords.filter((k) => typeof k === "string").join(", ")
    : campo(dados.keywords, 1000);

  return {
    artigo: {
      titulo,
      slug: slugify(campo(dados.slug, 200) || titulo),
      meta_title: campo(dados.meta_title, 300) || titulo,
      meta_description: campo(dados.meta_description, 500),
      palavra_chave: campo(dados.palavra_chave, 200) || palavraChave,
      keywords,
      resumo: campo(dados.resumo, 2000),
      conteudo,
      imagem_alt: campo(dados.imagem_alt, 500),
    },
    fonte_titulo: newsTitle,
    // A URL RESOLVIDA, não a que chegou: se o link era de agregador, o que vale
    // citar (e o que o artigo linkou) é a matéria de verdade.
    fonte_url: materia.url,
  };
}
