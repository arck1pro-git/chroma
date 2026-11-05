// O blog no Google: do endereço do blog até os números que a tela mostra.
//
// TRÊS PERGUNTAS, NESTA ORDEM, e cada "não" é uma tela própria (GoogleDoBlog):
//   1. Há credencial? (GOOGLE_SA_* no servidor)
//   2. O blog tem endereço? Sem url_base não há site para procurar.
//   3. A conta de serviço enxerga esse site? A propriedade é ACHADA pelo
//      endereço do blog entre as que a conta vê — não há coluna guardando
//      "qual propriedade". O vínculo é o próprio domínio: cadastrar o e-mail da
//      conta no Search Console do site é o único passo, e a tela o ensina.
//
// GUARDA EM MEMÓRIA (`lembrar`, lib/meta.ts), por instância: a lista de
// propriedades por 5 min, os números por 15 min e a inspeção de indexação por
// 6 h. O Search Console atualiza uma vez por dia; ir a ele a cada troca de aba
// só gastaria cota (a inspeção tem 2.000 por dia por propriedade) e segundos.
// O botão Atualizar da tela força a releitura.
//
// O QUE NÃO GUARDA: nada no banco. A janela do Search Console é de 16 meses,
// e persistir o histórico é decisão de modelagem em aberto (lib/search-console.ts).
import "server-only";
import { lembrar, MINUTO, type Validade } from "@/lib/meta";
import {
  consultar,
  inspecionar,
  propriedades,
  type FiltroConsulta,
  type LinhaConsulta,
  type Propriedade,
} from "@/lib/search-console";
import { urlDoArtigo, type Artigo, type Blog } from "@/lib/artigo";
import {
  SEM_METRICAS,
  urlComparavel,
  type ConsultaGoogle,
  type DesempenhoDoArtigo,
  type DiaGoogle,
  type GoogleDoArtigo,
  type GoogleDoBlog,
  type IndexacaoArtigo,
  type MetricasGoogle,
  type PaginaGoogle,
  type PeriodoLido,
} from "@/lib/blog-google-tipos";

const VALIDADE_PROPRIEDADES: Validade = { fresco: 5 * MINUTO, velho: 30 * MINUTO };
const VALIDADE_NUMEROS: Validade = { fresco: 15 * MINUTO, velho: 60 * MINUTO };
const VALIDADE_INDEXACAO: Validade = { fresco: 360 * MINUTO, velho: 720 * MINUTO };

/** Linhas de consulta e de página que a aba mostra. */
const TOPO = 10;

type ArtigoDoMapa = Pick<Artigo, "id" | "slug" | "titulo" | "status">;

function temCredencial(): boolean {
  return Boolean(process.env.GOOGLE_SA_EMAIL?.trim() && process.env.GOOGLE_SA_PRIVATE_KEY?.trim());
}

// ── Datas ───────────────────────────────────────────────────────────────────
//
// O Search Console conta o dia no fuso do Pacífico. A janela termina ONTEM lá:
// hoje ainda não tem linha, e ontem chega pela metade (dataState "all"), o que a
// tela avisa com o trecho tracejado do gráfico.

const diaNoPacifico = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

export function janelas(dias: number, agora = new Date()): { atual: PeriodoLido; anterior: PeriodoLido } {
  const fim = somarDias(diaNoPacifico.format(agora), -1);
  const inicio = somarDias(fim, -(dias - 1));
  return {
    atual: { inicio, fim, dias },
    anterior: { inicio: somarDias(inicio, -dias), fim: somarDias(inicio, -1), dias },
  };
}

// ── Qual propriedade é a do blog ────────────────────────────────────────────

/**
 * A propriedade que cobre o endereço do blog, entre as que a conta enxerga.
 *
 * Domínio ("sc-domain:site.com.br") vence prefixo ("https://site.com.br/"): ele
 * soma http, https, www e subdomínios, e é o que o próprio Google recomenda.
 * Entre dois do mesmo tipo, o mais específico. Conta "não verificada" não lê
 * dado nenhum, então nem entra.
 */
export function propriedadeDoEndereco(urlBase: string, lista: Propriedade[]): Propriedade | null {
  let host: string;
  try {
    host = new URL(urlBase).hostname.toLowerCase();
  } catch {
    return null;
  }
  const alvo = urlComparavel(urlBase);
  const validas = lista.filter((p) => p.permissao !== "siteUnverifiedUser");

  const dominios = validas
    .filter((p) => p.siteUrl.startsWith("sc-domain:"))
    .map((p) => ({ p, d: p.siteUrl.slice("sc-domain:".length).toLowerCase() }))
    .filter(({ d }) => host === d || host.endsWith(`.${d}`))
    .sort((a, b) => b.d.length - a.d.length);
  if (dominios.length) return dominios[0].p;

  const prefixos = validas
    .filter((p) => /^https?:\/\//i.test(p.siteUrl))
    .map((p) => ({ p, base: urlComparavel(p.siteUrl) }))
    .filter(({ base }) => alvo === base || alvo.startsWith(`${base}/`))
    .sort((a, b) => b.base.length - a.base.length);
  return prefixos[0]?.p ?? null;
}

/**
 * O pedaço da URL que recorta as páginas do blog: "site.com.br/blog". Vai num
 * filtro "contém", sem protocolo e sem www, para pegar as variantes que o
 * Google tiver guardado.
 */
function recorteDoBlog(urlBase: string): string {
  return urlComparavel(urlBase);
}

type Liberacao =
  | { ok: false; resposta: Exclude<GoogleDoBlog, { estado: "ok" }> }
  | { ok: true; propriedade: Propriedade };

async function liberar(blog: Pick<Blog, "url_base">, forcar: boolean): Promise<Liberacao> {
  if (!temCredencial()) return { ok: false, resposta: { estado: "sem-credencial" } };
  if (!blog.url_base) return { ok: false, resposta: { estado: "sem-endereco" } };

  let lista: Propriedade[];
  try {
    ({ valor: lista } = await lembrar("gsc/propriedades", VALIDADE_PROPRIEDADES, propriedades, forcar));
  } catch (e) {
    return { ok: false, resposta: { estado: "erro", mensagem: mensagemDe(e) } };
  }

  const propriedade = propriedadeDoEndereco(blog.url_base, lista);
  if (!propriedade) {
    let host = blog.url_base;
    try {
      host = new URL(blog.url_base).hostname.replace(/^www\./, "");
    } catch {
      // endereço inválido: a tela mostra o que está gravado
    }
    return {
      ok: false,
      resposta: {
        estado: "sem-acesso",
        email: process.env.GOOGLE_SA_EMAIL!.trim(),
        host,
        propriedades: lista.map((p) => p.siteUrl),
      },
    };
  }
  return { ok: true, propriedade };
}

function mensagemDe(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  // O corpo cru do Google pode trazer o e-mail da conta e detalhes internos; a
  // tela precisa só do começo, que diz o status e a causa.
  return texto.slice(0, 240);
}

// ── Contas sobre as linhas ──────────────────────────────────────────────────

function metricas(l: LinhaConsulta | undefined): MetricasGoogle {
  return l ? { cliques: l.cliques, impressoes: l.impressoes, ctr: l.ctr, posicao: l.posicao } : { ...SEM_METRICAS };
}

/**
 * Soma linhas que são a MESMA coisa (a página com e sem www, com e sem barra).
 * Cliques e impressões somam; CTR se refaz; a posição é a média pesada pelas
 * impressões — a mesma conta do Search Console ao juntar páginas.
 */
function somar(linhas: MetricasGoogle[]): MetricasGoogle {
  const cliques = linhas.reduce((t, l) => t + l.cliques, 0);
  const impressoes = linhas.reduce((t, l) => t + l.impressoes, 0);
  const pesoPosicao = linhas.reduce((t, l) => t + l.posicao * l.impressoes, 0);
  return {
    cliques,
    impressoes,
    ctr: impressoes ? cliques / impressoes : 0,
    posicao: impressoes ? pesoPosicao / impressoes : 0,
  };
}

/** O último pedaço do caminho: "/blog/como-investir/" → "como-investir". */
function ultimoTrecho(url: string): string {
  const caminho = urlComparavel(url).split("/").slice(1);
  return caminho.filter(Boolean).pop() ?? "";
}

/**
 * Página do Search Console → artigo do blog. Primeiro pela URL inteira que o
 * CRM monta; depois pelo slug no fim do caminho — o site pode servir o artigo
 * em /blog/categoria/slug, e o slug é único dentro do blog.
 */
export function casarArtigo(
  url: string,
  blog: Pick<Blog, "url_base">,
  artigos: ArtigoDoMapa[],
): ArtigoDoMapa | null {
  const alvo = urlComparavel(url);
  const recorte = recorteDoBlog(blog.url_base);
  if (recorte && !alvo.startsWith(recorte)) return null;

  const pelaUrl = artigos.find((a) => a.slug && urlComparavel(urlDoArtigo(blog, a)) === alvo);
  if (pelaUrl) return pelaUrl;
  const trecho = ultimoTrecho(url);
  return trecho ? (artigos.find((a) => a.slug === trecho) ?? null) : null;
}

function porDiaCompleto(periodo: PeriodoLido, linhas: LinhaConsulta[], chave = 0): DiaGoogle[] {
  const porData = new Map<string, MetricasGoogle[]>();
  for (const l of linhas) {
    const dia = l.chaves[chave];
    porData.set(dia, [...(porData.get(dia) ?? []), metricas(l)]);
  }
  const dias: DiaGoogle[] = [];
  for (let dia = periodo.inicio; dia <= periodo.fim; dia = somarDias(dia, 1)) {
    dias.push({ dia, ...somar(porData.get(dia) ?? []) });
  }
  return dias;
}

// ── O blog ──────────────────────────────────────────────────────────────────

/** O que vem do Google, antes de cruzar com os artigos (que mudam a cada edição). */
interface Leitura {
  periodo: PeriodoLido;
  site: MetricasGoogle;
  siteAnterior: MetricasGoogle;
  blog: MetricasGoogle;
  blogAnterior: MetricasGoogle;
  porDia: DiaGoogle[];
  consultas: ConsultaGoogle[];
  paginas: { url: string; metricas: MetricasGoogle }[];
  paginasDoBlog: { url: string; metricas: MetricasGoogle }[];
}

async function lerDoGoogle(siteUrl: string, recorte: string, dias: number): Promise<Leitura> {
  const { atual, anterior } = janelas(dias);
  const doBlog: FiltroConsulta[] = [{ dimensao: "page", operador: "contains", expressao: recorte }];
  const base = { frescos: true };

  const [site, siteAnt, blog, blogAnt, diario, consultas, paginas, paginasDoBlog] = await Promise.all([
    consultar(siteUrl, { ...base, ...atual, dimensoes: [] }),
    consultar(siteUrl, { ...base, ...anterior, dimensoes: [] }),
    consultar(siteUrl, { ...base, ...atual, dimensoes: [], filtros: doBlog }),
    consultar(siteUrl, { ...base, ...anterior, dimensoes: [], filtros: doBlog }),
    consultar(siteUrl, { ...base, ...atual, dimensoes: ["date"] }),
    consultar(siteUrl, { ...base, ...atual, dimensoes: ["query"], limite: TOPO }),
    consultar(siteUrl, { ...base, ...atual, dimensoes: ["page"], limite: TOPO }),
    consultar(siteUrl, { ...base, ...atual, dimensoes: ["page"], filtros: doBlog, limite: 1000 }),
  ]);

  return {
    periodo: atual,
    site: metricas(site[0]),
    siteAnterior: metricas(siteAnt[0]),
    blog: metricas(blog[0]),
    blogAnterior: metricas(blogAnt[0]),
    porDia: porDiaCompleto(atual, diario),
    consultas: consultas.map((l) => ({ termo: l.chaves[0], ...metricas(l) })),
    paginas: paginas.map((l) => ({ url: l.chaves[0], metricas: metricas(l) })),
    paginasDoBlog: paginasDoBlog.map((l) => ({ url: l.chaves[0], metricas: metricas(l) })),
  };
}

/**
 * O desempenho do blog no período: o site, o recorte do blog, os dias, as
 * consultas e páginas do topo e os números de cada artigo publicado.
 */
export async function googleDoBlog(
  blog: Pick<Blog, "url_base">,
  artigos: ArtigoDoMapa[],
  dias: number,
  forcar = false,
): Promise<GoogleDoBlog> {
  const liberado = await liberar(blog, forcar);
  if (!liberado.ok) return liberado.resposta;
  const { siteUrl } = liberado.propriedade;
  const recorte = recorteDoBlog(blog.url_base);

  let leitura: Leitura;
  let em: number;
  try {
    ({ valor: leitura, em } = await lembrar(
      `gsc/${siteUrl}/${recorte}/${dias}`,
      VALIDADE_NUMEROS,
      () => lerDoGoogle(siteUrl, recorte, dias),
      forcar,
    ));
  } catch (e) {
    return { estado: "erro", mensagem: mensagemDe(e) };
  }

  // O cruzamento com os artigos fica FORA do guardado: aprovar um artigo agora
  // tem que pôr os números dele no cartão na próxima leitura, sem esperar 15 min.
  const publicados = artigos.filter((a) => a.status === "aprovado");
  const porArtigo = new Map<number, MetricasGoogle[]>();
  for (const p of leitura.paginasDoBlog) {
    const a = casarArtigo(p.url, blog, publicados);
    if (a) porArtigo.set(a.id, [...(porArtigo.get(a.id) ?? []), p.metricas]);
  }

  const paginas: PaginaGoogle[] = leitura.paginas.map((p) => ({
    url: p.url,
    artigoId: casarArtigo(p.url, blog, publicados)?.id ?? null,
    ...p.metricas,
  }));

  return {
    estado: "ok",
    propriedade: siteUrl,
    periodo: leitura.periodo,
    site: leitura.site,
    siteAnterior: leitura.siteAnterior,
    blog: leitura.blog,
    blogAnterior: leitura.blogAnterior,
    porDia: leitura.porDia,
    consultas: leitura.consultas,
    paginas,
    artigos: Object.fromEntries([...porArtigo].map(([id, linhas]) => [String(id), somar(linhas)])),
    lidoEm: new Date(em).toISOString(),
  };
}

// ── Um artigo ───────────────────────────────────────────────────────────────

function resumoDaInspecao(i: Awaited<ReturnType<typeof inspecionar>>, em: number): IndexacaoArtigo {
  return {
    situacao: i.veredito === "PASS" ? "indexada" : i.veredito === "FAIL" || i.veredito === "PARTIAL" ? "problema" : "fora",
    cobertura: i.cobertura,
    ultimoRastreio: i.ultimoRastreio,
    canonicaGoogle: i.canonicaGoogle,
    canonicaSite: i.canonicaSite,
    sitemaps: i.sitemaps,
    lidoEm: new Date(em).toISOString(),
  };
}

/**
 * Um artigo publicado no Google: os números da página, o dia a dia, as
 * consultas que a trouxeram e o que o Google fez com a URL (indexação).
 */
export async function googleDoArtigo(
  blog: Pick<Blog, "url_base">,
  artigo: ArtigoDoMapa,
  dias: number,
  forcar = false,
): Promise<GoogleDoArtigo> {
  const liberado = await liberar(blog, forcar);
  if (!liberado.ok) return liberado.resposta;
  const url = urlDoArtigo(blog, artigo);
  if (artigo.status !== "aprovado" || !artigo.slug || !url) return { estado: "sem-url" };
  const { siteUrl } = liberado.propriedade;

  const eDele = (pagina: string) => casarArtigo(pagina, blog, [artigo]) !== null;
  const daPagina: FiltroConsulta[] = [{ dimensao: "page", operador: "contains", expressao: `/${artigo.slug}` }];

  let numeros: Omit<DesempenhoDoArtigo, "indexacao" | "lidoEm"> & { urlNoGoogle: string | null };
  let em: number;
  try {
    ({ valor: numeros, em } = await lembrar(
      `gsc/${siteUrl}/artigo/${urlComparavel(url)}/${dias}`,
      VALIDADE_NUMEROS,
      async () => {
        const { atual } = janelas(dias);
        const base = { frescos: true, ...atual, filtros: daPagina };
        const [paginas, diario, consultas] = await Promise.all([
          consultar(siteUrl, { ...base, dimensoes: ["page"], limite: 50 }),
          consultar(siteUrl, { ...base, dimensoes: ["date", "page"], limite: 5000 }),
          consultar(siteUrl, { ...base, dimensoes: ["query", "page"], limite: 1000 }),
        ]);
        const minhas = paginas.filter((l) => eDele(l.chaves[0]));
        const porTermo = new Map<string, MetricasGoogle[]>();
        for (const l of consultas.filter((c) => eDele(c.chaves[1]))) {
          porTermo.set(l.chaves[0], [...(porTermo.get(l.chaves[0]) ?? []), metricas(l)]);
        }
        return {
          url,
          // A URL como o Google a conhece (com www, com barra): é ela que se
          // inspeciona — a montada pelo CRM pode ser só um redirecionamento.
          urlNoGoogle: minhas.sort((a, b) => b.impressoes - a.impressoes)[0]?.chaves[0] ?? null,
          periodo: atual,
          metricas: somar(minhas.map(metricas)),
          porDia: porDiaCompleto(atual, diario.filter((l) => eDele(l.chaves[1]))),
          consultas: [...porTermo]
            .map(([termo, linhas]) => ({ termo, ...somar(linhas) }))
            .sort((a, b) => b.impressoes - a.impressoes || b.cliques - a.cliques)
            .slice(0, TOPO),
        };
      },
      forcar,
    ));
  } catch (e) {
    return { estado: "erro", mensagem: mensagemDe(e) };
  }

  // A inspeção tem cota própria (2.000/dia por propriedade) e falha por motivos
  // que não impedem os números de aparecer — URL fora da propriedade, cota
  // estourada. Falhou, a tela mostra os números e diz que a indexação não veio.
  const inspecionada = numeros.urlNoGoogle ?? url;
  let indexacao: IndexacaoArtigo | null = null;
  try {
    const { valor, em: quando } = await lembrar(
      `gsc/inspecao/${inspecionada}`,
      VALIDADE_INDEXACAO,
      () => inspecionar(siteUrl, inspecionada),
      forcar,
    );
    indexacao = resumoDaInspecao(valor, quando);
  } catch (e) {
    console.error("[blog-google] inspeção falhou:", mensagemDe(e));
  }

  return {
    estado: "ok",
    propriedade: siteUrl,
    url: numeros.url,
    periodo: numeros.periodo,
    metricas: numeros.metricas,
    porDia: numeros.porDia,
    consultas: numeros.consultas,
    indexacao,
    lidoEm: new Date(em).toISOString(),
  };
}
