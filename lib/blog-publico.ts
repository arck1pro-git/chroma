// A cara pública do blog: o que o SITE do cliente recebe quando consulta a URL
// de conexão. Duas rotas leem daqui, e é por isso que o formato mora num módulo
// e não dentro delas:
//
//     GET /api/publico/<chave>/artigos          → o índice
//     GET /api/publico/<chave>/artigos/<slug>   → um artigo
//
// O resumo do índice é PREFIXO do artigo inteiro: o mesmo objeto, com o corpo
// a mais. Assim a página de listagem do site e a do post leem os mesmos campos
// com o mesmo nome, e ninguém precisa de dois mapeadores.
//
// O QUE SAI: só `aprovado`. Pendente é trabalho interno — se vazasse aqui, o
// site publicaria o que ninguém leu. E só com slug: sem ele o artigo não tem
// endereço, então não existe URL que o devolva (ver `aprovar` em
// app/api/artigos/[id]/route.ts, que preenche o slug antes de aprovar).
//
// O HTML VEM PRONTO. O markdown vai junto para quem quiser renderizar do seu
// jeito, mas o padrão é o site colar `html` — é o mesmo renderizador da prévia
// e do botão "Copiar HTML", com a mesma defesa contra href `javascript:`.
import { sql } from "@/lib/db";
import {
  contarPalavras,
  jsonLd,
  listaKeywords,
  metaTags,
  renderArtigo,
  tempoLeitura,
  urlDoArtigo,
  type Artigo,
  type Blog,
  type Heading,
} from "@/lib/artigo";
import { camposArtigo } from "@/lib/blog";

/** O blog, como o site o vê. Sem id, sem auditoria, sem chave. */
export interface BlogPublico {
  nome: string;
  descricao: string;
  url_base: string;
  autor: string;
}

/** Uma linha do índice. */
export interface ArtigoPublicoResumo {
  slug: string;
  titulo: string;
  resumo: string;
  meta_title: string;
  meta_description: string;
  palavra_chave: string;
  keywords: string[];
  imagem_alt: string;
  /** url_base + slug. Vazio quando o blog não tem endereço configurado. */
  url: string;
  palavras: number;
  minutos: number;
  criado_em: string;
  atualizado_em: string;
}

/** O artigo inteiro: o resumo + o corpo e o que vai no <head>. */
export interface ArtigoPublico extends ArtigoPublicoResumo {
  markdown: string;
  html: string;
  sumario: Heading[];
  /** Bloco de <title>/<meta>/<link rel=canonical> pronto para colar. */
  meta_tags: string;
  /** BlogPosting, e FAQPage/BreadcrumbList quando cabem. */
  json_ld: Record<string, unknown>[];
  autor: string;
  /** A matéria que originou o artigo, quando ele saiu de uma. */
  fonte: { titulo: string; url: string } | null;
}

/** Índice + artigo compartilham o envelope: o site sempre sabe de quem é. */
export interface RespostaIndice {
  blog: BlogPublico;
  artigos: ArtigoPublicoResumo[];
}

export interface RespostaArtigo {
  blog: BlogPublico;
  artigo: ArtigoPublico;
}

/**
 * O blog dono da chave, ou null.
 *
 * A chave é o único identificador aceito na rota pública — `id` sequencial na
 * URL deixaria qualquer um enumerar os blogs vizinhos trocando o número.
 */
export async function blogPorChave(chave: string): Promise<Blog | null> {
  const [linha] = await sql`
    SELECT b.id, b.nome, b.auditoria_id, b.descricao, b.url_base, b.autor,
           b.chave,
           to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             AS created_at
    FROM blog b
    WHERE b.chave = ${chave}`;
  return (linha as Blog | undefined) ?? null;
}

export function blogPublico(blog: Blog): BlogPublico {
  return {
    nome: blog.nome,
    descricao: blog.descricao,
    url_base: blog.url_base,
    autor: blog.autor,
  };
}

/**
 * Os artigos publicáveis do blog, do mais novo para o mais antigo.
 *
 * A ORDEM AQUI NÃO É A DA TELA: lá é a ordem do trabalho (pendente em cima),
 * aqui é a do blog — o site quer o último post primeiro.
 *
 * SEM PÁGINA E COM O MARKDOWN JUNTO, de propósito por enquanto: o índice lê o
 * `conteudo` de cada artigo só para contar palavras e minutos, e devolve todos.
 * Com dezenas de artigos isso é barato e o cache de 5 min absorve; se um blog
 * passar de algumas centenas, o caminho é contar as palavras no SQL e paginar —
 * e aí o `next_cursor` entra no envelope, que já é um objeto justamente para
 * caber um campo novo sem quebrar quem consome.
 */
export async function artigosPublicos(blogId: number): Promise<Artigo[]> {
  const linhas = await sql`
    SELECT ${sql.unsafe(camposArtigo())} FROM artigo
    WHERE blog_id = ${blogId} AND status = 'aprovado' AND slug <> ''
    ORDER BY created_at DESC`;
  return linhas as unknown as Artigo[];
}

export async function artigoPublicoPorSlug(
  blogId: number,
  slug: string,
): Promise<Artigo | null> {
  const [linha] = await sql`
    SELECT ${sql.unsafe(camposArtigo())} FROM artigo
    WHERE blog_id = ${blogId} AND status = 'aprovado' AND slug = ${slug}`;
  return (linha as Artigo | undefined) ?? null;
}

// ── Formato ─────────────────────────────────────────────────────────────────

export function resumoPublico(artigo: Artigo, blog: Blog): ArtigoPublicoResumo {
  return {
    slug: artigo.slug,
    titulo: artigo.titulo,
    resumo: artigo.resumo,
    meta_title: artigo.meta_title || artigo.titulo,
    meta_description: artigo.meta_description || artigo.resumo,
    palavra_chave: artigo.palavra_chave,
    keywords: listaKeywords(artigo.keywords),
    imagem_alt: artigo.imagem_alt,
    url: urlDoArtigo(blog, artigo),
    palavras: contarPalavras(artigo.conteudo),
    minutos: tempoLeitura(artigo.conteudo),
    criado_em: artigo.created_at,
    atualizado_em: artigo.updated_at,
  };
}

export function artigoPublico(artigo: Artigo, blog: Blog): ArtigoPublico {
  const { html, sumario } = renderArtigo(artigo.conteudo);

  return {
    ...resumoPublico(artigo, blog),
    markdown: artigo.conteudo,
    html,
    sumario,
    meta_tags: metaTags(artigo, blog),
    json_ld: jsonLd(artigo, blog),
    autor: blog.autor,
    fonte: artigo.fonte_url
      ? { titulo: artigo.fonte_titulo, url: artigo.fonte_url }
      : null,
  };
}

// ── Resposta HTTP ───────────────────────────────────────────────────────────

/**
 * CORS ABERTO, DE PROPÓSITO: quem consome é o site do cliente, de um domínio
 * que este CRM não conhece e que muda (staging, preview de deploy, o domínio
 * final). Travar em uma origem seria quebrar a conexão a cada ambiente novo.
 * O que protege o conteúdo é a chave na URL — e o que está aqui é material
 * aprovado para publicação, que vai virar página aberta no ar de qualquer jeito.
 *
 * Só GET: não há nada a escrever por esta porta.
 */
const CABECALHOS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  // 5 minutos na borda, meia hora servindo o antigo enquanto revalida: aprovar
  // um artigo aparece no site em minutos, e uma rajada de acessos não vira
  // uma rajada de consultas ao banco.
  "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=1800",
};

export function respostaPublica(corpo: unknown, status = 200): Response {
  return Response.json(corpo, { status, headers: CABECALHOS });
}

/**
 * Chave errada e artigo inexistente devolvem o MESMO 404, sem dizer qual dos
 * dois foi: respostas diferentes deixariam adivinhar chaves válidas uma a uma.
 *
 * SEM CACHE, ao contrário do 200: um artigo aprovado agora vale na hora. Com o
 * `s-maxage` dos outros, quem tivesse aberto a URL um minuto antes continuaria
 * batendo no 404 guardado na borda por mais cinco.
 */
export function naoEncontrado(): Response {
  return Response.json(
    { error: "Não encontrado." },
    { status: 404, headers: { ...CABECALHOS, "cache-control": "no-store" } },
  );
}

/** Resposta do preflight do navegador. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CABECALHOS });
}
