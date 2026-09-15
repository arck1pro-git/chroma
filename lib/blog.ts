// Acesso ao banco do módulo de Blog. Só o lado SERVIDOR importa daqui — as
// funções puras (renderização, SEO, JSON-LD) vivem em lib/artigo.ts, que a tela
// importa direto.
//
// Os SELECTs moram aqui, e não espalhados pelas rotas, por um motivo prático: o
// formato do blog que o GET da lista devolve é o MESMO que o POST e o PUT
// devolvem — a tela substitui o item no array com o que voltou. Três cópias da
// mesma projeção sairiam de sincronia no primeiro campo novo.
import { sql } from "@/lib/db";
import type { Artigo, Blog } from "@/lib/artigo";

/**
 * Projeção canônica do blog: colunas + `auditoria_nome` (do JOIN em contextos)
 * + `artigos` (contagem). Os dois últimos não são colunas de `blog`.
 *
 * Datas viram texto ISO no Postgres, como no resto do projeto: assim o valor
 * que chega ao JSON não depende de como o driver serializa Date.
 */
const CAMPOS_BLOG = `
  b.id, b.nome, b.auditoria_id, b.descricao, b.url_base, b.autor, b.chave,
  to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  c.nome AS auditoria_nome,
  (SELECT count(*) FROM artigo a WHERE a.blog_id = b.id)::int AS artigos`;

const DE_BLOG = `FROM blog b LEFT JOIN contextos c ON c.id = b.auditoria_id`;

/**
 * Ordenação canônica da lista de artigos, usada em TODA listagem por blog:
 * pendente antes de aprovado; dentro de cada grupo, do mais novo para o mais
 * antigo.
 *
 * É a ordem do trabalho, não a do arquivo: o que ainda espera leitura fica no
 * topo, porque é ele que impede o artigo de ir ao ar.
 */
export const ORDEM_ARTIGO = `
  ORDER BY CASE status WHEN 'pendente' THEN 0 ELSE 1 END,
           created_at DESC`;

/** Colunas do artigo. `prefixo` só é necessário em JOIN (id e created_at colidem com blog). */
export function camposArtigo(prefixo = ""): string {
  const p = prefixo ? `${prefixo}.` : "";
  return `
    ${p}id, ${p}blog_id, ${p}titulo, ${p}slug, ${p}meta_title, ${p}meta_description,
    ${p}palavra_chave, ${p}keywords, ${p}resumo, ${p}conteudo, ${p}imagem_alt,
    ${p}status, ${p}fonte_titulo, ${p}fonte_url,
    to_char(${p}created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
    to_char(${p}updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at`;
}

export async function listarBlogs(auditoriaId?: string | null): Promise<Blog[]> {
  const linhas = auditoriaId
    ? await sql`
        SELECT ${sql.unsafe(CAMPOS_BLOG)} ${sql.unsafe(DE_BLOG)}
        WHERE b.auditoria_id = ${auditoriaId}
        ORDER BY b.nome`
    : await sql`
        SELECT ${sql.unsafe(CAMPOS_BLOG)} ${sql.unsafe(DE_BLOG)}
        ORDER BY b.nome`;
  return linhas as unknown as Blog[];
}

export async function blogPorId(id: number): Promise<Blog | null> {
  const [linha] = await sql`
    SELECT ${sql.unsafe(CAMPOS_BLOG)} ${sql.unsafe(DE_BLOG)}
    WHERE b.id = ${id}`;
  return (linha as Blog | undefined) ?? null;
}

export async function artigosDoBlog(blogId: number): Promise<Artigo[]> {
  const linhas = await sql`
    SELECT ${sql.unsafe(camposArtigo())} FROM artigo
    WHERE blog_id = ${blogId}
    ${sql.unsafe(ORDEM_ARTIGO)}`;
  return linhas as unknown as Artigo[];
}

// ── Utilidades das rotas ────────────────────────────────────────────────────

/** Corpo JSON ou `null` — quem chama devolve 400 quando vem null. */
export async function lerCorpo(
  req: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const corpo = await req.json();
    return corpo && typeof corpo === "object"
      ? (corpo as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Campo de texto vindo do cliente: string ou vazio, aparado e com teto.
 * O teto não é validação de negócio — é o que impede um POST de 10 MB de virar
 * uma linha de 10 MB no banco.
 */
export function campo(valor: unknown, max = 20_000): string {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}

/** `url_base` normalizada: sem espaço em volta e sem barra no fim. */
export function urlBase(valor: unknown): string {
  return campo(valor, 500).replace(/\/+$/, "");
}

/** Recarrega o blog no formato da lista — usado depois de INSERT e UPDATE. */
export async function blogDepoisDeGravar(id: number): Promise<Blog> {
  const blog = await blogPorId(id);
  if (!blog) throw new Error(`blog ${id} sumiu logo depois de gravar`);
  return blog;
}
