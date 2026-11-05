// O blog no Google (Search Console): o formato que a tela recebe e as contas
// puras sobre ele. SEM banco e SEM rede, de propósito: a aba Desempenho, os
// cartões do quadro e o painel do artigo são componentes de cliente, e importar
// daqui não pode arrastar o driver do Postgres para o navegador. Quem lê o
// Search Console e monta estes objetos é lib/blog-google.ts.

/** Os períodos que a tela oferece, em dias. 28 é o padrão do próprio Search Console. */
export const PERIODOS_GOOGLE = [7, 28, 90] as const;
export type PeriodoGoogle = (typeof PERIODOS_GOOGLE)[number];

export function periodoValido(bruto: unknown): PeriodoGoogle {
  const n = Number(bruto);
  return (PERIODOS_GOOGLE as readonly number[]).includes(n) ? (n as PeriodoGoogle) : 28;
}

/** Os quatro números do Search Console. CTR é 0..1; posição média, 1 é o topo. */
export interface MetricasGoogle {
  cliques: number;
  impressoes: number;
  ctr: number;
  posicao: number;
}

export const SEM_METRICAS: MetricasGoogle = { cliques: 0, impressoes: 0, ctr: 0, posicao: 0 };

export interface DiaGoogle extends MetricasGoogle {
  /** 'AAAA-MM-DD', no fuso do Search Console (Pacífico). */
  dia: string;
}

export interface ConsultaGoogle extends MetricasGoogle {
  termo: string;
}

export interface PaginaGoogle extends MetricasGoogle {
  url: string;
  /** O artigo deste blog que mora nesta página, quando é um. */
  artigoId: number | null;
}

export interface PeriodoLido {
  inicio: string;
  fim: string;
  dias: number;
}

/** Tudo o que a aba Desempenho e os cartões de "Postado" mostram. */
export interface DesempenhoDoBlog {
  /** A propriedade como o Search Console a nomeia: "sc-domain:x" ou "https://x/". */
  propriedade: string;
  periodo: PeriodoLido;
  /** O site inteiro no período e no período anterior de mesmo tamanho. */
  site: MetricasGoogle;
  siteAnterior: MetricasGoogle;
  /** Só as páginas debaixo do endereço do blog. */
  blog: MetricasGoogle;
  blogAnterior: MetricasGoogle;
  porDia: DiaGoogle[];
  consultas: ConsultaGoogle[];
  paginas: PaginaGoogle[];
  /** Por id do artigo (chave em texto: é JSON). Artigo sem linha não aparece. */
  artigos: Record<string, MetricasGoogle>;
  /** Quando os números saíram do Google (ISO). É o "atualizado há 3 min". */
  lidoEm: string;
}

/**
 * O que a tela precisa saber ANTES dos números: se dá para ler. Cada estado
 * vira uma tela diferente — o passo a passo de conexão não é erro, é onboarding.
 */
export type GoogleDoBlog =
  /** GOOGLE_SA_* não definidas no servidor. */
  | { estado: "sem-credencial" }
  /** O blog não tem endereço (url_base): não há site para procurar. */
  | { estado: "sem-endereco" }
  /** A conta de serviço não enxerga o site: falta adicioná-la no Search Console. */
  | { estado: "sem-acesso"; email: string; host: string; propriedades: string[] }
  | { estado: "erro"; mensagem: string }
  | ({ estado: "ok" } & DesempenhoDoBlog);

/** O resumo do que o Google fez com a URL do artigo. */
export interface IndexacaoArtigo {
  /** "indexada" quando o veredito é PASS; "problema" em FAIL/PARTIAL; "fora" no resto. */
  situacao: "indexada" | "fora" | "problema";
  cobertura: string;
  ultimoRastreio: string;
  canonicaGoogle: string;
  canonicaSite: string;
  sitemaps: string[];
  lidoEm: string;
}

export interface DesempenhoDoArtigo {
  url: string;
  periodo: PeriodoLido;
  metricas: MetricasGoogle;
  porDia: DiaGoogle[];
  consultas: ConsultaGoogle[];
  /** null quando a inspeção falhou (cota, URL fora da propriedade). */
  indexacao: IndexacaoArtigo | null;
  lidoEm: string;
}

export type GoogleDoArtigo =
  | Exclude<GoogleDoBlog, { estado: "ok" }>
  /** Artigo ainda em revisão, ou blog sem endereço: não há página no ar. */
  | { estado: "sem-url" }
  | ({ estado: "ok"; propriedade: string } & DesempenhoDoArtigo);

// ── Contas ──────────────────────────────────────────────────────────────────

/**
 * Variação percentual de `anterior` para `atual`. null quando não há base
 * (anterior zero): "+∞%" não diz nada, e a tela mostra "novo" no lugar.
 */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return (atual - anterior) / anterior;
}

/**
 * URL comparável: sem protocolo, sem "www.", sem query, sem âncora e sem barra
 * no fim, em minúsculas. O Search Console devolve a URL como o Google a
 * guardou ("https://www.site.com.br/blog/x/"), e o CRM a monta a partir do
 * endereço do blog ("https://site.com.br/blog/x") — são a mesma página.
 */
export function urlComparavel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const caminho = decodeURI(u.pathname).replace(/\/+$/, "").toLowerCase();
    return `${host}${caminho}`;
  } catch {
    return url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

/** "1.234", "12,3 mil", "1,2 mi": o número de cartão, curto e em pt-BR. */
export function numeroCurto(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (n >= 10_000) return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString("pt-BR");
}

/** 0,0345 → "3,5%". */
export function porcento(ctr: number): string {
  return `${(ctr * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: ctr > 0 && ctr < 0.1 ? 1 : 0 })}%`;
}

/** 7,46 → "7,5". Sem impressão não há posição: "—". */
export function posicao(p: number): string {
  return p > 0 ? p.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : "—";
}
