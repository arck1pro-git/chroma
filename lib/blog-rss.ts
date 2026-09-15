// Leitura dos feeds RSS/Atom que alimentam a pauta do blog.
//
// POR QUE SEM BIBLIOTECA: o que precisamos de cada item são três campos —
// título, link e data. Um parser de XML completo traria tratamento de namespace,
// entidade externa e DTD, que é superfície de ataque sobre um documento vindo de
// um site de terceiro. Aqui não existe expansão de entidade nem resolução de
// DOCTYPE: é varredura de texto sobre um recorte conhecido.
//
// O que este módulo NÃO faz: ler a matéria. Ele só descobre QUAIS notícias
// existem; quem busca o texto é lib/artigo-materia.ts, na hora de gerar.

/** Feed lento é feed descartado: a pauta tem outros quatro para usar. */
const TIMEOUT_MS = 12_000;

/** Teto de itens lidos por feed. Feed grande não pode dominar a pauta. */
const MAX_ITENS = 40;

export interface ItemRss {
  titulo: string;
  link: string;
  /** ISO 8601 quando o feed traz data; null quando não traz. */
  data: string | null;
}

/** &amp; e &#39; viram & e ' — entidades do XML, sem expansão de nada. */
function decodificar(texto: string): string {
  return texto
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) =>
      String.fromCharCode(parseInt(n, 16)),
    )
    // &amp; por último: senão "&amp;lt;" viraria "<" em vez de "&lt;".
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Conteúdo da primeira <tag> do bloco. */
function tag(bloco: string, nome: string): string {
  const m = new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, "i").exec(
    bloco,
  );
  return m ? decodificar(m[1]) : "";
}

/**
 * O link do item. RSS põe no corpo de <link>; Atom põe no atributo href de
 * <link rel="alternate">, com o corpo vazio — daí as duas tentativas.
 */
function link(bloco: string): string {
  const corpo = tag(bloco, "link");
  if (corpo && /^https?:\/\//i.test(corpo)) return corpo;

  const alternate =
    /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(bloco) ??
    /<link[^>]*href=["']([^"']+)["']/i.exec(bloco);
  const href = alternate ? decodificar(alternate[1]) : "";
  return /^https?:\/\//i.test(href) ? href : "";
}

function data(bloco: string): string | null {
  const bruto =
    tag(bloco, "pubDate") ||
    tag(bloco, "published") ||
    tag(bloco, "updated") ||
    tag(bloco, "dc:date");
  if (!bruto) return null;
  const d = new Date(bruto);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** XML de feed → itens. Aceita RSS 2.0 (<item>) e Atom (<entry>). */
export function lerFeed(xml: string): ItemRss[] {
  const blocos = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].slice(0, MAX_ITENS);

  const itens: ItemRss[] = [];
  for (const m of blocos) {
    const bloco = m[1];
    const titulo = tag(bloco, "title");
    const url = link(bloco);
    // Item sem link não vira artigo: a geração precisa da matéria, e sem
    // endereço não há o que ler.
    if (!url) continue;
    itens.push({ titulo, link: url, data: data(bloco) });
  }
  return itens;
}

/**
 * Busca um feed. NUNCA lança: um feed fora do ar não pode derrubar a pauta dos
 * outros quatro — a execução de segunda tem que entregar o que der.
 */
export async function buscarFeed(url: string): Promise<ItemRss[]> {
  try {
    const r = await fetch(url, {
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "user-agent": "Mozilla/5.0 (compatible; ChromaBlog/1.0)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return [];
    return lerFeed(await r.text());
  } catch {
    return [];
  }
}

/**
 * Todos os feeds de um blog, em paralelo, já sem repetição de link e ordenados
 * do mais novo para o mais antigo.
 *
 * Item sem data vai para o fim: sem saber quando saiu, é pauta de segunda
 * classe diante de uma notícia com data conhecida.
 */
export async function pautaDosFeeds(urls: string[]): Promise<ItemRss[]> {
  const listas = await Promise.all(urls.map(buscarFeed));

  const porLink = new Map<string, ItemRss>();
  for (const item of listas.flat()) {
    if (!porLink.has(item.link)) porLink.set(item.link, item);
  }

  return [...porLink.values()].sort((a, b) => {
    if (a.data && b.data) return a.data < b.data ? 1 : -1;
    if (a.data) return -1;
    if (b.data) return 1;
    return 0;
  });
}

/** Aceita só http(s). Feed é URL que o servidor vai buscar — sem file:// nem outros esquemas. */
export function urlDeFeedValida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
