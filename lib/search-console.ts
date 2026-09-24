// Cliente da Search Console API. Três leituras, e só leitura:
//
//   propriedades()  → quais sites esta service account enxerga
//   consultar()     → cliques, impressões, CTR e posição por página/termo/dia
//   inspecionar()   → o estado de INDEXAÇÃO de uma URL (o que o Google fez com ela)
//
// AS DUAS APIs SÃO A MESMA COISA COM DOIS ENDEREÇOS, e isso confunde na hora de
// debugar: Search Analytics e a lista de sites ainda moram no caminho
// `/webmasters/v3` (herança do Webmaster Tools), enquanto a Inspeção de URL,
// que é nova, mora em `/v1`. Por isso as duas constantes de base aqui embaixo.
//
// O QUE ESTE MÓDULO NÃO FAZ: guardar nada. Ele lê da API e devolve. A
// persistência é decisão de modelagem em aberto — e ela É necessária, porque a
// janela do Search Console é de 16 meses e o que sai dela some para sempre.
import "server-only";
import { ESCOPO_SEARCH_CONSOLE, tokenDeAcesso } from "@/lib/google-sa";

const BASE_V3 = "https://www.googleapis.com/webmasters/v3";
const BASE_V1 = "https://searchconsole.googleapis.com/v1";

/**
 * O identificador da propriedade, do jeito que a API o exige:
 *
 *   · propriedade de DOMÍNIO  → "sc-domain:amaan.com.br"
 *   · propriedade de PREFIXO  → "https://amaan.com.br/"  (com a barra final!)
 *
 * Não dá para adivinhar qual dos dois um site é — depende de como foi
 * cadastrado no Search Console. `propriedades()` responde com a string exata,
 * e é ela que tem de ser guardada, não o domínio.
 */
export type SiteUrl = string;

export interface Propriedade {
  siteUrl: SiteUrl;
  /** "siteOwner" | "siteFullUser" | "siteRestrictedUser" | "siteUnverifiedUser" */
  permissao: string;
}

/** As dimensões que a consulta pode abrir. */
export type Dimensao = "date" | "page" | "query" | "country" | "device";

export interface LinhaConsulta {
  /** Um valor por dimensão pedida, na mesma ordem. */
  chaves: string[];
  cliques: number;
  impressoes: number;
  /** 0..1 — a API já devolve a divisão pronta. */
  ctr: number;
  /** Posição média. Menor é melhor; 1.0 é o primeiro resultado. */
  posicao: number;
}

export interface OpcoesConsulta {
  /** "YYYY-MM-DD", no fuso da propriedade (America/Los_Angeles). */
  inicio: string;
  fim: string;
  dimensoes: Dimensao[];
  /**
   * Teto de 25.000 por chamada. Acima disso é paginar com `startRow` — não
   * implementado porque um blog levaria anos para passar disso.
   */
  limite?: number;
  /**
   * "final" (padrão) só traz dado fechado, com 2 a 3 dias de atraso. "all"
   * inclui os dias frescos, que ainda estão subindo e MUDAM depois — bom para
   * a tela ("o que aconteceu ontem"), ruim para gravar como número definitivo.
   */
  frescos?: boolean;
}

async function pedir<T>(url: string, corpo?: unknown): Promise<T> {
  const token = await tokenDeAcesso(ESCOPO_SEARCH_CONSOLE);

  const resposta = await fetch(url, {
    method: corpo ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(corpo ? { "content-type": "application/json" } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    cache: "no-store",
  });

  if (!resposta.ok) {
    const texto = await resposta.text();
    // O 403 daqui quase sempre tem UMA causa: a service account não foi
    // adicionada como usuária da propriedade no Search Console. A API não diz
    // isso com clareza, então a dica vai junto.
    const dica =
      resposta.status === 403
        ? " — confira se o e-mail da service account está em Search Console → " +
          "Configurações → Usuários e permissões da propriedade"
        : "";
    throw new Error(
      `Search Console respondeu ${resposta.status}${dica}: ${texto.slice(0, 400)}`,
    );
  }

  return (await resposta.json()) as T;
}

/**
 * As propriedades que esta service account pode ler.
 *
 * É a primeira chamada a fazer ao conectar um cliente: ela confirma que o
 * passo manual (adicionar o e-mail como usuário) foi feito, e devolve a string
 * exata do `siteUrl` a guardar.
 */
export async function propriedades(): Promise<Propriedade[]> {
  const dados = await pedir<{
    siteEntry?: { siteUrl: string; permissionLevel: string }[];
  }>(`${BASE_V3}/sites`);

  return (dados.siteEntry ?? []).map((s) => ({
    siteUrl: s.siteUrl,
    permissao: s.permissionLevel,
  }));
}

/**
 * Search Analytics: a tabela de desempenho, agrupada pelas dimensões pedidas.
 *
 * O `siteUrl` vai CODIFICADO no caminho — "sc-domain:x" tem dois-pontos, que
 * sem encode a API lê como outra rota e devolve 404.
 */
export async function consultar(
  siteUrl: SiteUrl,
  opcoes: OpcoesConsulta,
): Promise<LinhaConsulta[]> {
  const caminho = `${BASE_V3}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

  const dados = await pedir<{
    rows?: {
      keys?: string[];
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }[];
  }>(caminho, {
    startDate: opcoes.inicio,
    endDate: opcoes.fim,
    dimensions: opcoes.dimensoes,
    rowLimit: opcoes.limite ?? 1000,
    dataState: opcoes.frescos ? "all" : "final",
  });

  return (dados.rows ?? []).map((r) => ({
    chaves: r.keys ?? [],
    cliques: r.clicks,
    impressoes: r.impressions,
    ctr: r.ctr,
    posicao: r.position,
  }));
}

/** O que o Google fez com uma URL. É o "dados de indexação" da tela. */
export interface Indexacao {
  /** "PASS" | "PARTIAL" | "FAIL" | "NEUTRAL" — o resumo do semáforo. */
  veredito: string;
  /** Em texto: "Submitted and indexed", "Discovered - currently not indexed"… */
  cobertura: string;
  /** Se está indexada e por quê não, quando não está. */
  estadoIndexacao: string;
  robots: string;
  /** Última visita do robô, ISO. Vazio quando nunca foi rastreada. */
  ultimoRastreio: string;
  /** A canônica que o GOOGLE escolheu — pode divergir da que o site declara. */
  canonicaGoogle: string;
  canonicaSite: string;
  /** Sitemaps que apontam para ela. Vazio é sinal de que falta no sitemap. */
  sitemaps: string[];
}

/**
 * Inspeção de URL: o estado de indexação de UM endereço.
 *
 * É a resposta para "o artigo que aprovamos já está no Google?" — que nem
 * Search Analytics nem GA4 respondem. Sem clique nenhum, esta chamada já
 * distingue "ninguém procurou" de "o Google nem sabe que existe".
 *
 * COTA: 2.000 inspeções por dia e 600 por minuto, POR PROPRIEDADE. Dá de sobra
 * para inspecionar os artigos de um blog, mas não é chamada para fazer em laço
 * a cada render de tela — é de rodar quando um artigo é aprovado, e depois de
 * vez em quando enquanto ele não for indexado.
 *
 * A URL inspecionada precisa estar DENTRO da propriedade; senão, 403.
 */
export async function inspecionar(
  siteUrl: SiteUrl,
  url: string,
): Promise<Indexacao> {
  const dados = await pedir<{
    inspectionResult?: {
      indexStatusResult?: {
        verdict?: string;
        coverageState?: string;
        indexingState?: string;
        robotsTxtState?: string;
        lastCrawlTime?: string;
        googleCanonical?: string;
        userCanonical?: string;
        sitemap?: string[];
      };
    };
  }>(`${BASE_V1}/urlInspection/index:inspect`, {
    inspectionUrl: url,
    siteUrl,
    languageCode: "pt-BR",
  });

  const r = dados.inspectionResult?.indexStatusResult ?? {};
  return {
    veredito: r.verdict ?? "",
    cobertura: r.coverageState ?? "",
    estadoIndexacao: r.indexingState ?? "",
    robots: r.robotsTxtState ?? "",
    ultimoRastreio: r.lastCrawlTime ?? "",
    canonicaGoogle: r.googleCanonical ?? "",
    canonicaSite: r.userCanonical ?? "",
    sitemaps: r.sitemap ?? [],
  };
}
