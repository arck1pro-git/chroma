// Núcleo do módulo de Blog: tudo que se DERIVA do markdown de um artigo.
//
// REGRA DA CASA: o campo `conteudo` (markdown) é a única fonte de verdade.
// Sumário, âncoras, FAQ, JSON-LD, HTML de publicação, contagem de palavras,
// tempo de leitura e checklist de SEO saem daqui, na hora. Nenhum deles é
// coluna no banco — não existe cópia para sair de sincronia quando alguém
// edita o texto.
//
// TUDO AQUI É FUNÇÃO PURA, SEM BANCO. O painel do artigo é componente de
// cliente e importa este arquivo para recalcular a nota de SEO a cada tecla; se
// uma linha daqui importasse lib/db.ts, o bundle do navegador arrastaria o
// driver do Postgres junto (o mesmo motivo que separa contextos-tipos.ts de
// contextos.ts). O único helper que consulta o banco — `slugLivre`, que
// desambigua slug repetido — mora em lib/artigo-server.ts.

// ── Tipos ───────────────────────────────────────────────────────────────────

/**
 * Os dois estados do artigo, e a régua da rota pública: `aprovado` é o que o
 * site recebe em /api/publico/<chave>/artigos, `pendente` é o que fica dentro
 * do CRM. Todo artigo nasce pendente — quem escreve é a IA, e nada vai ao ar
 * sem alguém ler.
 */
export const ARTIGO_STATUS = ["pendente", "aprovado"] as const;
export type ArtigoStatus = (typeof ARTIGO_STATUS)[number];

export const ARTIGO_STATUS_LABEL: Record<ArtigoStatus, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
};

export interface Blog {
  id: number;
  nome: string;
  /** contextos(id) — o bloco de prompt que orienta a linha editorial do blog. */
  auditoria_id: string | null;
  descricao: string;
  url_base: string;
  autor: string;
  /**
   * O segredo na URL de conexão do site: /api/publico/<chave>/artigos. Nasce
   * com o blog (default do banco) e é trocável — ver migration-blog-publicacao.sql.
   */
  chave: string;
  created_at: string;
  /** Vem do JOIN em contextos, não é coluna de `blog`. */
  auditoria_nome?: string | null;
  /** Contagem de artigos, não é coluna de `blog`. */
  artigos?: number;
}

export interface Artigo {
  id: number;
  blog_id: number;
  titulo: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  palavra_chave: string;
  keywords: string;
  resumo: string;
  conteudo: string;
  imagem_alt: string;
  status: ArtigoStatus;
  fonte_titulo: string;
  fonte_url: string;
  created_at: string;
  updated_at: string;
  /** Vem do JOIN em blog na listagem global (/api/artigos sem filtro). */
  blog_nome?: string;
}

/** Os campos que o gerador devolve e que a tela salva. */
export type ArtigoRascunho = Pick<
  Artigo,
  | "titulo"
  | "slug"
  | "meta_title"
  | "meta_description"
  | "palavra_chave"
  | "keywords"
  | "resumo"
  | "conteudo"
  | "imagem_alt"
>;

// ── Texto e slug ────────────────────────────────────────────────────────────

/** Marcas de acento soltas depois do NFD (combining diacritical marks). */
const ACENTOS = /[̀-ͯ]/g;

/**
 * "Como calcular o retorno?" → "como-calcular-o-retorno".
 *
 * A ordem importa: corta em 80 DEPOIS de trocar os separadores e ANTES de tirar
 * o hífen do fim — senão o corte pode deixar um hífen pendurado no final.
 */
export function slugify(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(ACENTOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/**
 * Markdown → texto corrido, para contar palavras, medir densidade e frases.
 * Não é renderização: aqui o objetivo é sobrar só o que uma pessoa leria.
 */
export function textoPuro(markdown: string): string {
  return (markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ") // bloco de código não é prosa
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // marcador de heading (o texto fica)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // imagem some inteira
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // link vira só o rótulo
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "") // bullet e numeração
    .replace(/[*_`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contarPalavras(markdown: string): number {
  const puro = textoPuro(markdown);
  return puro ? puro.split(/\s+/).length : 0;
}

/** Minutos, a 200 palavras por minuto. Nunca zero: artigo curto lê "1 min". */
export function tempoLeitura(markdown: string): number {
  return Math.max(1, Math.round(contarPalavras(markdown) / 200));
}

// ── Renderizador de markdown ────────────────────────────────────────────────

export interface Heading {
  nivel: number;
  texto: string;
  id: string;
}

export interface ArtigoRenderizado {
  html: string;
  sumario: Heading[];
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A defesa do renderizador. O HTML daqui vai para dangerouslySetInnerHTML na
 * prévia E para o CMS pelo botão "Copiar HTML" — um href `javascript:` que
 * passasse viraria XSS nos dois lugares. Só estes quatro esquemas entram;
 * qualquer outro perde o link e sobra o texto do rótulo.
 */
const HREF_PERMITIDO = /^(https?:\/\/|mailto:|\/|#)/i;

/**
 * Formatação dentro da linha. A ordem é deliberada: escapa o HTML PRIMEIRO
 * (senão o markdown do usuário injeta tag), depois código, imagem, link,
 * negrito e ênfase — imagem antes de link porque `![x](y)` também casaria com o
 * padrão de link se o `!` não fosse consumido antes.
 *
 * O título entre aspas de `[x](url "título")` chega aqui já escapado como
 * `&quot;`, daí o padrão opcional procurar por isso e não por aspas cruas.
 */
function inline(bruto: string): string {
  let t = escapar(bruto);

  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");

  t = t.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g,
    (_m, alt: string, src: string) =>
      HREF_PERMITIDO.test(src)
        ? `<img src="${src}" alt="${alt}" loading="lazy" />`
        : alt,
  );

  t = t.replace(
    /\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g,
    (_m, rotulo: string, url: string) => {
      if (!HREF_PERMITIDO.test(url)) return rotulo;
      const externo = /^https?:\/\//i.test(url);
      const extra = externo ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${url}"${extra}>${rotulo}</a>`;
    },
  );

  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return t;
}

/**
 * Gera o `id` de cada título, deduplicando dentro do artigo: dois "Conclusão"
 * viram `conclusao` e `conclusao-2`. Sem isto o sumário teria duas entradas
 * apontando para a mesma âncora, e o navegador rolaria sempre para a primeira.
 */
function criarSlugger() {
  const usados = new Map<string, number>();
  return (texto: string): string => {
    const base = slugify(texto) || "secao";
    const vistos = usados.get(base) ?? 0;
    usados.set(base, vistos + 1);
    return vistos === 0 ? base : `${base}-${vistos + 1}`;
  };
}

const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;

function ehLinhaDeTabela(linha: string): boolean {
  return /^\s*\|.*\|\s*$/.test(linha);
}

function ehSeparadorDeTabela(linha: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(linha) && linha.includes("-");
}

function celulas(linha: string): string[] {
  return linha
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Markdown → HTML **e** sumário, numa varredura só.
 *
 * POR QUE NÃO UMA BIBLIOTECA: duas razões. A primeira é segurança — este HTML é
 * injetado com dangerouslySetInnerHTML e colado no CMS, então a lista de
 * esquemas de href permitidos (HREF_PERMITIDO) precisa ser nossa, e não uma
 * opção de configuração que alguém desliga sem perceber. A segunda é o sumário:
 * os `id` dos títulos e os links do índice TÊM que sair do mesmo lugar. Com um
 * renderizador de fora seriam duas passadas e dois sluggers — e bastaria um
 * título repetido para o índice apontar para a âncora errada.
 *
 * O subconjunto suportado é exatamente o que o prompt de geração pede: heading,
 * parágrafo, lista, tabela, citação, régua, bloco de código e o inline.
 */
export function renderArtigo(markdown: string): ArtigoRenderizado {
  const linhas = (markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const partes: string[] = [];
  const sumario: Heading[] = [];
  const ancora = criarSlugger();

  let paragrafo: string[] = [];
  let citacao: string[] = [];
  let lista:
    | { tipo: "ul" | "ol"; itens: string[]; continuavel: boolean }
    | null = null;
  let codigo: { lang: string; linhas: string[] } | null = null;

  const fecharParagrafo = () => {
    if (!paragrafo.length) return;
    partes.push(`<p>${inline(paragrafo.join(" "))}</p>`);
    paragrafo = [];
  };
  const fecharCitacao = () => {
    if (!citacao.length) return;
    partes.push(`<blockquote><p>${inline(citacao.join(" "))}</p></blockquote>`);
    citacao = [];
  };
  const fecharLista = () => {
    if (!lista) return;
    const itens = lista.itens.map((i) => `<li>${inline(i)}</li>`).join("");
    partes.push(`<${lista.tipo}>${itens}</${lista.tipo}>`);
    lista = null;
  };
  const fecharCodigo = () => {
    if (!codigo) return;
    const classe = codigo.lang ? ` class="language-${codigo.lang}"` : "";
    partes.push(
      `<pre><code${classe}>${escapar(codigo.linhas.join("\n"))}</code></pre>`,
    );
    codigo = null;
  };
  const fecharTudo = () => {
    fecharParagrafo();
    fecharCitacao();
    fecharLista();
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    // 1. Bloco de código cercado — literal até o fechamento, sem interpretar
    //    nada. Vem primeiro justamente para que "# " ou "- " dentro do bloco
    //    não virem heading nem lista.
    if (codigo) {
      if (/^\s*```/.test(linha)) fecharCodigo();
      else codigo.linhas.push(linha);
      continue;
    }
    const abreCodigo = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/.exec(linha);
    if (abreCodigo) {
      fecharTudo();
      codigo = { lang: slugify(abreCodigo[1]), linhas: [] };
      continue;
    }

    // 2. Linha em branco: fecha parágrafo e citação. A lista NÃO fecha aqui —
    //    lista com linha em branco entre os itens continua sendo uma lista só —,
    //    mas deixa de aceitar continuação de item (ver 7).
    if (!linha.trim()) {
      fecharParagrafo();
      fecharCitacao();
      if (lista) lista.continuavel = false;
      continue;
    }

    // 3. Heading. Só H2 e H3 entram no sumário: H1 é o título do artigo (que
    //    nem deveria estar no corpo) e H4+ é detalhe demais para um índice.
    const heading = RE_HEADING.exec(linha);
    if (heading) {
      fecharTudo();
      const nivel = heading[1].length;
      const bruto = heading[2].trim().replace(/\s+#+\s*$/, "");
      const texto = textoPuro(bruto);
      const id = ancora(texto);
      if (nivel === 2 || nivel === 3) sumario.push({ nivel, texto, id });
      partes.push(`<h${nivel} id="${id}">${inline(bruto)}</h${nivel}>`);
      continue;
    }

    // 4. Régua. Antes da lista porque "* * *" também casa com o padrão de item.
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(linha)) {
      fecharTudo();
      partes.push("<hr />");
      continue;
    }

    // 5. Citação: linhas ">" consecutivas viram um blockquote só.
    const cita = /^\s{0,3}>\s?(.*)$/.exec(linha);
    if (cita) {
      fecharParagrafo();
      fecharLista();
      citacao.push(cita[1].trim());
      continue;
    }
    fecharCitacao();

    // 6. Tabela pipe: só é tabela se a linha seguinte for a separadora. Sem
    //    essa checagem, qualquer parágrafo com "|" viraria tabela de uma coluna.
    if (
      ehLinhaDeTabela(linha) &&
      i + 1 < linhas.length &&
      ehSeparadorDeTabela(linhas[i + 1])
    ) {
      fecharTudo();
      const cabecalho = celulas(linha);
      i += 2;
      const corpo: string[][] = [];
      while (i < linhas.length && ehLinhaDeTabela(linhas[i])) {
        corpo.push(celulas(linhas[i]));
        i++;
      }
      i--; // o for incrementa de novo
      const th = cabecalho.map((c) => `<th>${inline(c)}</th>`).join("");
      const tr = corpo
        .map((l) => `<tr>${l.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("");
      partes.push(
        `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`,
      );
      continue;
    }

    // 7. Lista. Trocar de tipo (marcador → numerada) fecha a anterior e abre
    //    outra, senão as duas se misturariam num <ul> só.
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(linha);
    if (item) {
      fecharParagrafo();
      const tipo = /^\d/.test(item[2]) ? "ol" : "ul";
      if (lista && lista.tipo !== tipo) fecharLista();
      if (!lista) lista = { tipo, itens: [], continuavel: true };
      lista.itens.push(item[3].trim());
      lista.continuavel = true;
      continue;
    }

    // Linha solta logo abaixo de um item continua aquele item: é assim que o
    // texto quebrado em duas linhas no editor volta a ser uma frase só.
    if (lista && lista.continuavel && lista.itens.length) {
      lista.itens[lista.itens.length - 1] += ` ${linha.trim()}`;
      continue;
    }

    // 8. Qualquer outra coisa é parágrafo. Começar um parágrafo novo encerra a
    //    lista aberta — assim ele sai DEPOIS do <ul>, e não engolido por ele.
    if (!paragrafo.length) fecharLista();
    paragrafo.push(linha.trim());
  }

  fecharCodigo(); // bloco sem fechamento não engole o resto em silêncio
  fecharTudo();

  return { html: partes.join("\n"), sumario };
}

/** Só o índice. Mesma varredura de renderArtigo, para não divergir dos ids. */
export function extrairSumario(markdown: string): Heading[] {
  return renderArtigo(markdown).sumario;
}

// ── FAQ ─────────────────────────────────────────────────────────────────────

/** O H2 que abre o bloco de perguntas. */
const RE_TITULO_FAQ = /perguntas\s+frequentes|d[uú]vidas\s+frequentes|\bfaq\b/i;

export interface PerguntaFaq {
  pergunta: string;
  resposta: string;
}

/**
 * Lê o bloco de FAQ do markdown para virar `FAQPage` no JSON-LD — que é o que
 * o Google usa para o rich snippet de perguntas.
 *
 * Delimitação: começa no H2 cujo título casa com RE_TITULO_FAQ e termina no
 * próximo H2 (ou num H1). É por isso que o prompt de geração manda fechar o
 * artigo com "## Conclusão" DEPOIS da FAQ: aquele H2 é o que fecha o bloco.
 */
export function extrairFaq(markdown: string): PerguntaFaq[] {
  const linhas = (markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const itens: PerguntaFaq[] = [];

  let dentro = false;
  let pergunta = "";
  let resposta: string[] = [];

  const guardar = () => {
    const texto = textoPuro(resposta.join(" "));
    // Pergunta sem resposta é descartada: viraria um Question vazio no schema.
    if (pergunta && texto) itens.push({ pergunta, resposta: texto });
    pergunta = "";
    resposta = [];
  };

  for (const linha of linhas) {
    const heading = RE_HEADING.exec(linha);

    if (heading) {
      const nivel = heading[1].length;
      const titulo = textoPuro(heading[2].trim());

      if (nivel <= 2) {
        if (dentro) {
          guardar();
          dentro = false;
        }
        if (nivel === 2 && RE_TITULO_FAQ.test(titulo)) dentro = true;
        continue;
      }

      if (dentro && nivel === 3) {
        guardar(); // fecha a pergunta anterior antes de abrir a próxima
        pergunta = `${titulo.replace(/\s*\?+\s*$/, "")}?`;
      }
      continue;
    }

    if (dentro && pergunta) resposta.push(linha);
  }

  if (dentro) guardar();
  return itens;
}

// ── Publicação ──────────────────────────────────────────────────────────────

/** Endereço final do artigo. Sem `url_base` no blog, não há URL — string vazia. */
export function urlDoArtigo(
  blog: Pick<Blog, "url_base">,
  artigo: Pick<Artigo, "slug" | "titulo">,
): string {
  const base = (blog.url_base ?? "").trim().replace(/\/+$/, "");
  if (!base) return "";
  const slug = (artigo.slug || slugify(artigo.titulo)).replace(/^\/+/, "");
  return `${base}/${slug}`;
}

/** "a, b; c" → ["a", "b", "c"]. Aceita vírgula, ponto e vírgula e quebra. */
export function listaKeywords(keywords: string): string[] {
  return (keywords ?? "")
    .split(/[,;\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Os blocos de dados estruturados do artigo, de 1 a 3.
 *
 * BlogPosting sai sempre. FAQPage só quando o markdown tem mesmo um bloco de
 * perguntas — declarar um FAQPage vazio é pedir penalidade por marcação que não
 * corresponde à página. BreadcrumbList só quando há URL, porque sem `url_base`
 * não há como dizer onde a página fica.
 */
export function jsonLd(
  artigo: Artigo,
  blog: Blog,
): Record<string, unknown>[] {
  const url = urlDoArtigo(blog, artigo);
  const faq = extrairFaq(artigo.conteudo);

  const post: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: artigo.meta_title || artigo.titulo,
    description: artigo.meta_description || artigo.resumo,
    inLanguage: "pt-BR",
    datePublished: artigo.created_at,
    dateModified: artigo.updated_at || artigo.created_at,
    wordCount: contarPalavras(artigo.conteudo),
    keywords: listaKeywords(artigo.keywords),
    publisher: { "@type": "Organization", name: blog.nome },
  };
  if (blog.autor) post.author = { "@type": "Person", name: blog.autor };
  if (url) {
    post.url = url;
    post.mainEntityOfPage = { "@type": "WebPage", "@id": url };
  }
  if (artigo.fonte_url) post.citation = artigo.fonte_url;

  const blocos: Record<string, unknown>[] = [post];

  if (faq.length) {
    blocos.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.pergunta,
        acceptedAnswer: { "@type": "Answer", text: f.resposta },
      })),
    });
  }

  if (url) {
    blocos.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: blog.nome,
          item: (blog.url_base ?? "").trim().replace(/\/+$/, ""),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: artigo.titulo,
          item: url,
        },
      ],
    });
  }

  return blocos;
}

/** O bloco de <head> pronto para colar. Linha vazia não entra. */
export function metaTags(artigo: Artigo, blog: Blog): string {
  const url = urlDoArtigo(blog, artigo);
  const titulo = artigo.meta_title || artigo.titulo;
  const descricao = artigo.meta_description || artigo.resumo;
  const chaves = listaKeywords(artigo.keywords);

  const meta = (atributo: string, nome: string, valor: string) =>
    `<meta ${atributo}="${nome}" content="${escapar(valor)}" />`;

  return [
    `<title>${escapar(titulo)}</title>`,
    descricao && meta("name", "description", descricao),
    chaves.length && meta("name", "keywords", chaves.join(", ")),
    blog.autor && meta("name", "author", blog.autor),
    meta("name", "robots", "index, follow"),
    url && `<link rel="canonical" href="${escapar(url)}" />`,
    meta("property", "og:type", "article"),
    meta("property", "og:title", titulo),
    descricao && meta("property", "og:description", descricao),
    meta("property", "og:locale", "pt_BR"),
    blog.nome && meta("property", "og:site_name", blog.nome),
    url && meta("property", "og:url", url),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", titulo),
    descricao && meta("name", "twitter:description", descricao),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * O `<article>` completo + o JSON-LD, que é o que o botão "Copiar HTML"
 * entrega. Colável direto no CMS: o sumário já vem ancorado nos ids do corpo.
 */
export function artigoParaHtml(artigo: Artigo, blog: Blog): string {
  const { html, sumario } = renderArtigo(artigo.conteudo);

  const indice = sumario.length
    ? [
        '<nav class="artigo-sumario" aria-label="Neste artigo">',
        '  <p class="artigo-sumario__titulo">Neste artigo</p>',
        "  <ol>",
        ...sumario.map(
          (h) =>
            `    <li class="nivel-${h.nivel}"><a href="#${h.id}">${escapar(h.texto)}</a></li>`,
        ),
        "  </ol>",
        "</nav>",
      ].join("\n")
    : "";

  // nofollow na fonte: é citação de matéria de terceiro, não endosso.
  const fonte = artigo.fonte_url
    ? `<p class="artigo-fonte">Fonte: <a href="${escapar(artigo.fonte_url)}" target="_blank" rel="noopener nofollow">${escapar(artigo.fonte_titulo || artigo.fonte_url)}</a></p>`
    : "";

  const corpo = [
    '<article class="artigo">',
    `  <h1>${escapar(artigo.titulo)}</h1>`,
    artigo.resumo ? `  <p class="artigo-resumo">${escapar(artigo.resumo)}</p>` : "",
    indice,
    html,
    fonte,
    "</article>",
  ]
    .filter(Boolean)
    .join("\n");

  const blocos = jsonLd(artigo, blog);
  const dados = JSON.stringify(blocos.length === 1 ? blocos[0] : blocos, null, 2);

  return `${corpo}\n\n<script type="application/ld+json">\n${dados}\n</script>`;
}

// ── Checklist de SEO ────────────────────────────────────────────────────────

export type NivelSeo = "ok" | "alerta" | "erro";

export interface CheckSeo {
  id: string;
  label: string;
  nivel: NivelSeo;
  detalhe: string;
}

export interface AnaliseSeo {
  checks: CheckSeo[];
  nota: number;
}

/** Sem acento e em minúscula: "Automação" e "automacao" são a mesma palavra. */
function normalizar(texto: string): string {
  return (texto ?? "").normalize("NFD").replace(ACENTOS, "").toLowerCase();
}

/** Chave vazia nunca "está contida" — senão todo check passaria de graça. */
function contemChave(texto: string, chave: string): boolean {
  if (!chave.trim()) return false;
  return normalizar(texto).includes(normalizar(chave));
}

function ocorrencias(texto: string, chave: string): number {
  const alvo = normalizar(texto);
  const termo = normalizar(chave).trim();
  if (!termo) return 0;
  let total = 0;
  let de = 0;
  for (;;) {
    const achou = alvo.indexOf(termo, de);
    if (achou === -1) return total;
    total++;
    de = achou + termo.length;
  }
}

const decimal = (n: number, casas: number) => n.toFixed(casas).replace(".", ",");

/**
 * O checklist que a tela mostra ao vivo enquanto se edita o markdown.
 *
 * Recebe o RASCUNHO, não a linha do banco: é o que permite recalcular a nota a
 * cada tecla, antes de salvar.
 *
 * A nota é média ponderada — ok vale 1, alerta 0,5, erro 0 — sobre todos os
 * checks. Não é um número de mercado, é um placar interno: serve para comparar
 * dois artigos deste blog e para dizer o que falta, não para prometer posição
 * no Google.
 */
export function analiseSeo(artigo: ArtigoRascunho): AnaliseSeo {
  const chave = (artigo.palavra_chave ?? "").trim();
  const conteudo = artigo.conteudo ?? "";
  const puro = textoPuro(conteudo);
  const palavras = puro ? puro.split(/\s+/).length : 0;

  const { sumario } = renderArtigo(conteudo);
  const h2 = sumario.filter((h) => h.nivel === 2);
  const faq = extrairFaq(conteudo);

  const metaTitle = artigo.meta_title || artigo.titulo || "";
  const metaDescription = artigo.meta_description ?? "";
  const slug = artigo.slug ?? "";
  const intro = puro.slice(0, 200);

  // A imagem é sintaxe de link também: o "!" na frente é o que separa os dois.
  const hrefs = Array.from(conteudo.matchAll(/(!?)\[[^\]]*\]\(([^)\s]+)/g))
    .filter((m) => !m[1])
    .map((m) => m[2]);
  const externos = hrefs.filter((h) => /^https?:\/\//i.test(h));
  const internos = hrefs.filter((h) => h.startsWith("/"));

  const vezes = ocorrencias(puro, chave);
  const palavrasDaChave = chave ? chave.split(/\s+/).filter(Boolean).length : 0;
  const densidade = palavras ? (vezes * palavrasDaChave * 100) / palavras : 0;

  const frases = puro.split(/[.!?]+\s/).filter((f) => f.trim());
  const mediaFrase = frases.length ? palavras / frases.length : 0;

  const checks: CheckSeo[] = [];
  const add = (id: string, label: string, nivel: NivelSeo, detalhe: string) =>
    checks.push({ id, label, nivel, detalhe });

  // 1. Sem palavra-chave nada mais se mede — por isso é erro, não alerta.
  if (chave) {
    add("palavra-chave", "Palavra-chave definida", "ok", `"${chave}"`);
  } else {
    add(
      "palavra-chave",
      "Palavra-chave definida",
      "erro",
      "Sem palavra-chave o resto do checklist não fecha.",
    );
  }

  // 2. Título SEO
  const nTitle = metaTitle.length;
  if (nTitle === 0) {
    add("meta-title", "Título SEO entre 30 e 60 caracteres", "erro", "Vazio.");
  } else if (nTitle < 30) {
    add(
      "meta-title",
      "Título SEO entre 30 e 60 caracteres",
      "alerta",
      `${nTitle} caracteres — curto demais.`,
    );
  } else if (nTitle > 60) {
    add(
      "meta-title",
      "Título SEO entre 30 e 60 caracteres",
      "alerta",
      `${nTitle} caracteres — o Google corta em ~60.`,
    );
  } else {
    add(
      "meta-title",
      "Título SEO entre 30 e 60 caracteres",
      "ok",
      `${nTitle} caracteres.`,
    );
  }

  // 3. A palavra-chave no título é o sinal mais forte da página.
  add(
    "chave-no-title",
    "Palavra-chave no título SEO",
    contemChave(metaTitle, chave) ? "ok" : "erro",
    contemChave(metaTitle, chave)
      ? "Presente."
      : "Inclua a palavra-chave, de preferência no começo.",
  );

  // 4. Meta descrição
  const nDesc = metaDescription.length;
  if (nDesc === 0) {
    add(
      "meta-description",
      "Meta descrição entre 110 e 160 caracteres",
      "erro",
      "Vazia.",
    );
  } else if (nDesc < 110) {
    add(
      "meta-description",
      "Meta descrição entre 110 e 160 caracteres",
      "alerta",
      `${nDesc} caracteres — sobra espaço na SERP.`,
    );
  } else if (nDesc > 160) {
    add(
      "meta-description",
      "Meta descrição entre 110 e 160 caracteres",
      "alerta",
      `${nDesc} caracteres — vai ser truncada.`,
    );
  } else {
    add(
      "meta-description",
      "Meta descrição entre 110 e 160 caracteres",
      "ok",
      `${nDesc} caracteres.`,
    );
  }

  // 5.
  add(
    "chave-na-description",
    "Palavra-chave na meta descrição",
    contemChave(metaDescription, chave) ? "ok" : "alerta",
    contemChave(metaDescription, chave)
      ? "Presente."
      : "O termo buscado aparece em negrito na SERP.",
  );

  // 6. Slug
  if (!slug) {
    add("slug", "Slug curto e com a palavra-chave", "erro", "Sem slug.");
  } else if (slug !== slugify(slug)) {
    add(
      "slug",
      "Slug curto e com a palavra-chave",
      "erro",
      "Use só minúsculas, números e hífen.",
    );
  } else if (!contemChave(slug.replace(/-/g, " "), chave)) {
    add(
      "slug",
      "Slug curto e com a palavra-chave",
      "alerta",
      "A palavra-chave não aparece na URL.",
    );
  } else if (slug.split("-").length > 8) {
    add(
      "slug",
      "Slug curto e com a palavra-chave",
      "alerta",
      `${slug.split("-").length} palavras — encurte.`,
    );
  } else {
    add("slug", "Slug curto e com a palavra-chave", "ok", `/${slug}`);
  }

  // 7.
  add(
    "chave-na-intro",
    "Palavra-chave nos primeiros parágrafos",
    contemChave(intro, chave) ? "ok" : "alerta",
    contemChave(intro, chave)
      ? "Presente na abertura."
      : "Traga o termo para as primeiras linhas.",
  );

  // 8.
  const chaveEmH2 = h2.some((h) => contemChave(h.texto, chave));
  add(
    "chave-em-h2",
    "Palavra-chave em pelo menos um H2",
    chaveEmH2 ? "ok" : "alerta",
    chaveEmH2 ? "Presente em um intertítulo." : "Nenhum H2 usa a palavra-chave.",
  );

  // 9. Densidade
  if (!chave || !palavras) {
    add(
      "densidade",
      "Densidade da palavra-chave entre 0,5% e 2,5%",
      "erro",
      "Sem palavra-chave ou sem texto para medir.",
    );
  } else if (densidade < 0.5) {
    add(
      "densidade",
      "Densidade da palavra-chave entre 0,5% e 2,5%",
      "alerta",
      `${decimal(densidade, 2)}% — ${vezes}x no texto, pouco.`,
    );
  } else if (densidade > 2.5) {
    add(
      "densidade",
      "Densidade da palavra-chave entre 0,5% e 2,5%",
      "alerta",
      `${decimal(densidade, 2)}% — ${vezes}x, soa forçado.`,
    );
  } else {
    add(
      "densidade",
      "Densidade da palavra-chave entre 0,5% e 2,5%",
      "ok",
      `${decimal(densidade, 2)}% (${vezes} ocorrências).`,
    );
  }

  // 10. Tamanho
  if (palavras >= 800) {
    add("tamanho", "Artigo com no mínimo 800 palavras", "ok", `${palavras} palavras.`);
  } else if (palavras >= 500) {
    add(
      "tamanho",
      "Artigo com no mínimo 800 palavras",
      "alerta",
      `${palavras} palavras — raso para ranquear.`,
    );
  } else {
    add(
      "tamanho",
      "Artigo com no mínimo 800 palavras",
      "erro",
      `${palavras} palavras — curto demais para ranquear.`,
    );
  }

  // 11. Estrutura
  if (h2.length >= 3) {
    add("estrutura", "Estrutura com 3 ou mais H2", "ok", `${h2.length} intertítulos.`);
  } else if (h2.length >= 1) {
    add(
      "estrutura",
      "Estrutura com 3 ou mais H2",
      "alerta",
      `${h2.length} intertítulo(s) — quebre mais o texto.`,
    );
  } else {
    add(
      "estrutura",
      "Estrutura com 3 ou mais H2",
      "erro",
      "Sem intertítulos: não gera sumário.",
    );
  }

  // 12.
  add(
    "sumario",
    "Sumário com links para as seções",
    sumario.length >= 3 ? "ok" : "alerta",
    sumario.length >= 3
      ? `${sumario.length} âncoras geradas.`
      : `${sumario.length} âncora(s) — poucas seções para um índice útil.`,
  );

  // 13. FAQ
  if (faq.length >= 3) {
    add(
      "faq",
      "Bloco de perguntas frequentes",
      "ok",
      `${faq.length} perguntas → FAQPage no schema.`,
    );
  } else if (faq.length >= 1) {
    add(
      "faq",
      "Bloco de perguntas frequentes",
      "alerta",
      `${faq.length} pergunta(s) — o ideal são 3 a 5.`,
    );
  } else {
    add(
      "faq",
      "Bloco de perguntas frequentes",
      "alerta",
      "Sem FAQ o artigo perde o rich snippet.",
    );
  }

  // 14. Links internos
  if (internos.length >= 2) {
    add("links-internos", "Links internos", "ok", `${internos.length} links internos.`);
  } else if (internos.length === 1) {
    add(
      "links-internos",
      "Links internos",
      "alerta",
      "1 link interno — dois ou mais distribuem melhor a autoridade.",
    );
  } else {
    add(
      "links-internos",
      "Links internos",
      "alerta",
      "Nenhum link para outras páginas do site.",
    );
  }

  // 15.
  add(
    "links-externos",
    "Fonte externa citada",
    externos.length >= 1 ? "ok" : "alerta",
    externos.length >= 1
      ? `${externos.length} link(s) de referência.`
      : "Citar a fonte sustenta o E-E-A-T.",
  );

  // 16.
  const nResumo = (artigo.resumo ?? "").length;
  add(
    "resumo",
    "Resumo/chamada preenchido",
    nResumo >= 60 ? "ok" : "alerta",
    nResumo >= 60
      ? `${nResumo} caracteres.`
      : "Usado na home do blog e nas redes.",
  );

  // 17. Alt da capa
  const alt = artigo.imagem_alt ?? "";
  if (!alt) {
    add(
      "imagem-alt",
      "Texto alternativo da imagem de capa",
      "alerta",
      "Descreva a capa para acessibilidade e Google Imagens.",
    );
  } else if (contemChave(alt, chave)) {
    add("imagem-alt", "Texto alternativo da imagem de capa", "ok", "Presente, com a palavra-chave.");
  } else {
    add(
      "imagem-alt",
      "Texto alternativo da imagem de capa",
      "alerta",
      "Sem a palavra-chave no texto alternativo.",
    );
  }

  // 18. Legibilidade
  if (!frases.length) {
    add("legibilidade", "Frases com menos de 25 palavras em média", "erro", "Sem texto.");
  } else if (mediaFrase <= 25) {
    add(
      "legibilidade",
      "Frases com menos de 25 palavras em média",
      "ok",
      `${decimal(mediaFrase, 1)} palavras por frase.`,
    );
  } else {
    add(
      "legibilidade",
      "Frases com menos de 25 palavras em média",
      "alerta",
      `${decimal(mediaFrase, 1)} palavras por frase — quebre as longas.`,
    );
  }

  const peso = { ok: 1, alerta: 0.5, erro: 0 };
  const soma = checks.reduce((total, c) => total + peso[c.nivel], 0);
  const nota = checks.length ? Math.round((soma / checks.length) * 100) : 0;

  return { checks, nota };
}
