// A pauta do blog: quais notícias dos feeds ainda não viraram artigo — e o
// caminho de UMA delas até o artigo gravado.
//
// POR QUE É UM MÓDULO E NÃO CÓDIGO DAS ROTAS: quatro portas fazem as mesmas
// duas perguntas, e elas não podem responder coisas diferentes.
//
//   · GET  /api/blogs/noticias        → a tela, que lista as notícias
//   · POST /api/blogs/noticias/gerar  → a tela, quando alguém clica em "Gerar"
//   · POST /api/blogs/rss/pauta       → o n8n, de segunda a sexta às 7h
//   · POST /api/blogs/rss/gerar       → o n8n, um item por vez
//
// Se o "já virou artigo" fosse decidido em dois lugares, a tela ofereceria como
// pauta nova exatamente o que a automação descartou — e o clique produziria um
// artigo repetido.
//
// O QUE ELE NÃO FAZ: ler feed (é lib/blog-rss.ts) nem escrever artigo (é
// lib/artigo-geracao.ts). Aqui só se cruza uma coisa com a outra, e se grava.
import { sql } from "@/lib/db";
import type { Artigo } from "@/lib/artigo";
import { camposArtigo } from "@/lib/blog";
import { pautaDosFeeds, type ItemRss } from "@/lib/blog-rss";
import { escolherPautas } from "@/lib/blog-curadoria";
import { AGENDA_AUTOMACAO } from "@/lib/blog-automacao-tipos";
import { slugLivre } from "@/lib/artigo-server";
import {
  FalhaGeracao,
  gerarArtigoDeMateria,
  type Tamanho,
} from "@/lib/artigo-geracao";
import type { ItemPauta, PautaDoBlog } from "@/lib/blog-pauta-tipos";

// Os tipos do JSON vivem em ./blog-pauta-tipos.ts (a tela não pode importar
// deste arquivo: `postgres` iria junto para o bundle). Reexportados para o
// servidor não ter de importar dos dois lugares.
export type { ItemPauta, PautaDoBlog } from "@/lib/blog-pauta-tipos";

/**
 * Artigos por blog por rodada da automação (AGENDA_AUTOMACAO): 2, de segunda a
 * sexta. A pauta da rodada leva alguns a MAIS, em ordem de prioridade: matéria
 * com paywall falha antes de gastar token, e o próximo da fila ocupa a vaga. A
 * cota do dia é conferida na geração (`artigosDeHoje`).
 */
export const POR_BLOG_AUTOMACAO = AGENDA_AUTOMACAO.porBlog;
export const CANDIDATOS_AUTOMACAO = POR_BLOG_AUTOMACAO + 3;

/** Teto do que a TELA mostra por blog. Feed grande não vira lista infinita. */
export const POR_BLOG_TELA = 30;

/**
 * Notícia mais velha que isso não entra na rodada da automação: a pauta é de
 * notícia, e a do mês passado já foi coberta por todo mundo. Na tela ela
 * continua, para quem quiser gerar à mão.
 */
const RECENTE_MS = 3 * 86_400_000;

const CAMPOS_BLOG = `b.id, b.nome, b.descricao`;
const DE_BLOG = `FROM blog b`;
const TEM_FEED = `EXISTS (SELECT 1 FROM blog_rss r WHERE r.blog_id = b.id)`;

interface BlogDaPauta {
  id: number;
  nome: string;
  descricao: string;
}

/**
 * Os blogs que entram na pauta.
 *
 * `somenteAtivos` é o recorte da automação: blogs com RSS ligado e feed.
 * A tela também mostra os blogs cujo RSS está pausado.
 */
async function blogsComFeed(opcoes: {
  blogId?: number;
  somenteAtivos?: boolean;
}): Promise<BlogDaPauta[]> {
  const linhas = opcoes.blogId
    ? await sql`
        SELECT ${sql.unsafe(CAMPOS_BLOG)} ${sql.unsafe(DE_BLOG)}
        WHERE b.id = ${opcoes.blogId} AND ${sql.unsafe(TEM_FEED)}`
    : opcoes.somenteAtivos
      ? await sql`
          SELECT ${sql.unsafe(CAMPOS_BLOG)} ${sql.unsafe(DE_BLOG)}
          WHERE b.rss_ativo AND ${sql.unsafe(TEM_FEED)}
          ORDER BY b.id`
      : await sql`
          SELECT ${sql.unsafe(CAMPOS_BLOG)} ${sql.unsafe(DE_BLOG)}
          WHERE ${sql.unsafe(TEM_FEED)}
          ORDER BY b.nome`;
  return linhas as unknown as BlogDaPauta[];
}

/**
 * `fonte_url` → id do artigo, para um blog.
 *
 * A chave é a URL RESOLVIDA da matéria — a mesma que a geração gravou. Um link
 * de agregador que resolve para o mesmo destino não gera artigo repetido.
 */
async function artigosPorFonte(blogId: number): Promise<Map<string, number>> {
  const linhas = await sql`
    SELECT id, fonte_url FROM artigo
    WHERE blog_id = ${blogId} AND fonte_url <> ''`;
  return new Map(linhas.map((a) => [a.fonte_url as string, a.id as number]));
}

/**
 * A rodada da automação: as notícias recentes que ainda não viraram artigo,
 * escolhidas pela descrição do blog (lib/blog-curadoria.ts) e em ordem de
 * prioridade. Sem nenhuma recente, vale o que houver.
 */
async function escolherDaRodada(blog: BlogDaPauta, novos: ItemRss[], limite: number): Promise<ItemRss[]> {
  const desde = Date.now() - RECENTE_MS;
  const recentes = novos.filter((i) => !i.data || Date.parse(i.data) >= desde);
  return escolherPautas(blog, recentes.length ? recentes : novos, limite);
}

async function pautaDeUmBlog(
  blog: BlogDaPauta,
  limite: number,
  incluirUsados: boolean,
  curar: boolean,
): Promise<PautaDoBlog> {
  const feeds = await sql`
    SELECT url FROM blog_rss WHERE blog_id = ${blog.id} ORDER BY id`;

  const [itens, usados] = await Promise.all([
    pautaDosFeeds(feeds.map((f) => f.url as string)),
    artigosPorFonte(blog.id),
  ]);

  const naoUsados = itens.filter((i) => !usados.has(i.link));
  const novos: ItemPauta[] = (
    curar ? await escolherDaRodada(blog, naoUsados, limite) : naoUsados.slice(0, limite)
  ).map((i) => ({ ...i, artigoId: null }));

  // Os já usados vão DEPOIS dos novos, não intercalados pela data: o que a tela
  // precisa em cima é o que ainda dá trabalho. Eles continuam na lista porque
  // "essa eu já usei" é resposta, não ruído — e o link leva ao artigo.
  const repetidos: ItemPauta[] = incluirUsados
    ? itens
        .filter((i) => usados.has(i.link))
        .slice(0, limite)
        .map((i) => ({ ...i, artigoId: usados.get(i.link)! }))
    : [];

  return {
    blogId: blog.id,
    blogNome: blog.nome,
    feeds: feeds.length,
    lidos: itens.length,
    itens: [...novos, ...repetidos],
  };
}

/**
 * A pauta de todos os blogs do recorte, em paralelo.
 *
 * Em paralelo e não em fila: cada blog espera rede (até 5 feeds, 12s de teto
 * cada). Em fila, cinco blogs com um feed lento cada levariam um minuto para
 * pintar uma tela que é só uma lista.
 */
export async function pautaDosBlogs(opcoes: {
  blogId?: number;
  somenteAtivos?: boolean;
  limite: number;
  incluirUsados?: boolean;
  /** A rodada da automação: só recentes, escolhidas pela descrição do blog. */
  curar?: boolean;
}): Promise<PautaDoBlog[]> {
  const blogs = await blogsComFeed(opcoes);
  return Promise.all(
    blogs.map((b) =>
      pautaDeUmBlog(b, opcoes.limite, opcoes.incluirUsados ?? false, opcoes.curar ?? false),
    ),
  );
}

/**
 * Quantos artigos vindos de notícia o blog já recebeu HOJE (dia de Brasília).
 * É a cota da automação: a rodada traz candidatos a mais, e a geração para
 * quando o blog atinge POR_BLOG_AUTOMACAO.
 */
export async function artigosDeHoje(blogId: number): Promise<number> {
  const [linha] = await sql`
    SELECT count(*)::int AS n FROM artigo
    WHERE blog_id = ${blogId} AND fonte_url <> ''
      AND created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;
  return linha.n as number;
}

// ── Da notícia ao artigo gravado ────────────────────────────────────────────

export type SaidaGeracao =
  | { ok: true; artigo: Artigo }
  /** `repetido`: este link já virou artigo — não é falha, é um pulo. */
  | { ok: false; repetido: boolean; mensagem: string; status: number };

/**
 * Notícia → artigo GRAVADO, em rascunho.
 *
 * Diferente de /api/artigos/generate, que devolve a prévia e deixa a gravação
 * para quem aprova: aqui o pedido é "pega essa notícia e gera", de um clique só
 * — ou do n8n às 7h, quando não há ninguém para aprovar. Rascunho é
 * justamente o estado que pede revisão humana antes de publicar, e ela acontece
 * depois, no painel do artigo.
 *
 * Falha esperada (paywall, site fora) volta como `ok:false`
 * com o status HTTP que a rota deve usar. O inesperado sobe: 500 é 500.
 */
export async function gerarDaPauta(pedido: {
  blogId: number;
  link: string;
  titulo?: string;
  tamanho?: Tamanho;
}): Promise<SaidaGeracao> {
  const { blogId, link } = pedido;

  // Corrida entre quem pede: se a lista foi montada há 20 minutos e o mesmo
  // link virou artigo nesse meio-tempo (à mão, ou na execução do n8n), não vale
  // gerar de novo — nem gastar os tokens de novo.
  const [repetido] = await sql`
    SELECT id FROM artigo WHERE blog_id = ${blogId} AND fonte_url = ${link}`;
  if (repetido) {
    return {
      ok: false,
      repetido: true,
      mensagem: "Esta matéria já virou artigo neste blog.",
      status: 409,
    };
  }

  let gerado;
  try {
    gerado = await gerarArtigoDeMateria({
      blogId,
      link,
      newsTitle: pedido.titulo ?? "",
      tamanho: pedido.tamanho ?? "medio",
    });
  } catch (e) {
    if (e instanceof FalhaGeracao) {
      return {
        ok: false,
        repetido: false,
        mensagem: e.message,
        status: e.status,
      };
    }
    throw e;
  }

  const { artigo } = gerado;
  const slug = await slugLivre(blogId, artigo.slug || artigo.titulo);

  const [novo] = await sql`
    INSERT INTO artigo (
      blog_id, titulo, slug, meta_title, meta_description, palavra_chave,
      keywords, resumo, conteudo, imagem_alt, fonte_titulo, fonte_url
    ) VALUES (
      ${blogId},
      ${artigo.titulo},
      ${slug},
      ${artigo.meta_title},
      ${artigo.meta_description},
      ${artigo.palavra_chave},
      ${artigo.keywords},
      ${artigo.resumo},
      ${artigo.conteudo},
      ${artigo.imagem_alt},
      ${gerado.fonte_titulo},
      ${gerado.fonte_url}
    )
    RETURNING ${sql.unsafe(camposArtigo())}`;

  return { ok: true, artigo: novo as unknown as Artigo };
}
