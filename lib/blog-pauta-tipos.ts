// Os tipos da pauta, SEM tocar o banco.
//
// Existe separado de ./blog-pauta.ts pela mesma razão dura de
// lib/contextos-tipos.ts: aquele importa lib/db.ts, que importa `postgres`, que
// importa `net`/`tls`. A lista de notícias é componente de cliente — se ela
// importasse os tipos de lá, o driver do Postgres iria junto para o bundle do
// navegador e o build quebraria em "module not found: net".
//
// A regra prática: o formato do JSON que a tela recebe mora aqui; quem consulta
// o banco mora em ./blog-pauta.ts, que reexporta isto.

/** Uma notícia do feed, já cruzada com os artigos do blog. */
export interface ItemPauta {
  titulo: string;
  link: string;
  /** ISO 8601 quando o feed traz data; null quando não traz. */
  data: string | null;
  /**
   * id do artigo que já saiu desta matéria neste blog; `null` quando é pauta
   * nova. É o que a tela usa para trocar o botão por um link.
   */
  artigoId: number | null;
}

/** A pauta de um blog: o cabeçalho que a tela mostra e os itens. */
export interface PautaDoBlog {
  blogId: number;
  blogNome: string;
  auditoriaNome: string | null;
  /** Sem auditoria não se gera artigo — a tela desabilita o botão e diz por quê. */
  temAuditoria: boolean;
  feeds: number;
  /** Itens lidos dos feeds ANTES do corte: distingue "feed mudo" de "tudo já usado". */
  lidos: number;
  itens: ItemPauta[];
}

/** O corpo de GET /api/blogs/noticias. */
export interface RespostaNoticias {
  blogs: PautaDoBlog[];
}
