// As contas puras de Meta Ads: os números da Meta em MetricasAds, a soma de
// vários objetos, a atribuição de um lead do CRM a campanha, conjunto, anúncio e
// peça, e o resumo do CRM. Sem servidor: a tela importa `dividir` daqui.
//
// MÉTRICAS (2026-10-23, "todas as métricas possíveis do gerenciador"):
// - As razões (CPM, CTR, custo por lead, taxa de gancho...) saem SEMPRE das
//   contagens, numa função só (`comRazoes`), e não dos campos prontos da Meta
//   (ctr, cpc, cpm, cpp): assim a linha de uma campanha e a soma de três
//   anúncios usam a mesma fórmula, e a soma não tem como divergir da linha.
// - Lead é a ação "lead", o agregado da Meta. Somar onsite_web_lead e
//   offsite_* junto contaria a mesma pessoa duas vezes.
// - `video3s` é a ação "video_view" (reprodução de 3 s), não video_play_actions
//   (qualquer início de reprodução): é a base do gancho e da retenção.
// - O custo do RESULTADO é investido ÷ resultados, como os demais custos. Nos
//   resultados que a Meta cobra por mil (alcance), o Gerenciador mostra o custo
//   por mil e aqui sai o custo unitário — as campanhas da casa otimizam por lead.
// - Na soma, alcance é a soma dos alcances: a Meta não deduplica a pessoa entre
//   objetos, então frequência e CPP da soma são aproximados. O total da conta
//   vem de uma leitura própria da conta (lib/meta-ads-relatorio.ts) justamente
//   para não somar campanhas.
import type { CrmAds, InsightAds, LeadsCrm, MetricasAds, ObjetoAds, ResultadoMeta, TipoCriativoAds } from "./meta-ads-tipos";

export type OrigemAds = Record<string, unknown> | null;
export type OportunidadeAds = {
  id: string; contato_id: string; status: string; valor: number;
  etapa_id: string; etapa_nome: string; etapa_ordem: number; funil_id: string; funil_nome: string;
  primeira_ordem: number; campos: OrigemAds; contato_campos: OrigemAds;
};
/**
 * Uma ENTRADA no CRM dentro do período: o contato que nasceu, ou a oportunidade
 * nova de alguém (que pode já ser contato antigo — é o lead que voltou). As
 * duas carregam a origem: `campos` é o da oportunidade (null na entrada de
 * contato) e `contato_campos` o do contato.
 */
export type EntradaCrm = { contato_id: string; dia: string; campos: OrigemAds; contato_campos: OrigemAds };

export function dividir(n: number, d: number): number | null { return d > 0 ? n / d : null; }
const numero = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;

/** O que soma de um objeto para outro. Todo o resto de MetricasAds é derivado ou escolhido. */
const CONTAGENS = [
  "gasto", "impressoes", "alcance", "cliques", "cliquesUnicos", "cliquesLink", "cliquesSaida", "visualizacoesPagina",
  "leads", "conversas", "compras", "valorCompras",
  "video3s", "thruplays", "videoP25", "videoP50", "videoP75", "videoP95", "videoP100",
  "engajamentos", "reacoes", "comentarios", "compartilhamentos", "salvamentos", "visitasPerfil",
] as const satisfies ReadonlyArray<keyof MetricasAds>;
type Contagens = Record<(typeof CONTAGENS)[number], number>;
/** O que não é contagem nem razão: vem pronto da Meta (um objeto) ou é escolhido (soma). */
type Avulsos = {
  frequencia: number | null; tempoMedioVideo: number | null;
  resultado: { tipo: string; valor: number } | null; qualidade: MetricasAds["qualidade"];
};

/** As razões, a partir das contagens. A ÚNICA fórmula de cada uma: metricasAds e somarMetricas passam por aqui. */
function comRazoes(c: Contagens, a: Avulsos): MetricasAds {
  return {
    ...c, ...a,
    cpm: dividir(c.gasto * 1000, c.impressoes), cpp: dividir(c.gasto * 1000, c.alcance),
    ctr: dividir(c.cliques * 100, c.impressoes), cpc: dividir(c.gasto, c.cliques),
    ctrLink: dividir(c.cliquesLink * 100, c.impressoes), cpcLink: dividir(c.gasto, c.cliquesLink),
    custoVisualizacaoPagina: dividir(c.gasto, c.visualizacoesPagina),
    taxaCarregamento: dividir(c.visualizacoesPagina * 100, c.cliquesLink),
    custoPorLead: dividir(c.gasto, c.leads), custoPorConversa: dividir(c.gasto, c.conversas),
    resultado: a.resultado ? { ...a.resultado, custo: dividir(c.gasto, a.resultado.valor) } : null,
    // Anúncio de imagem não tem gancho: é "não se aplica", não 0%.
    taxaGancho: c.video3s > 0 ? dividir(c.video3s * 100, c.impressoes) : null,
    taxaRetencao: dividir(c.thruplays * 100, c.video3s), custoThruplay: dividir(c.gasto, c.thruplays),
  };
}

/**
 * O primeiro resultado que a Meta informa. Indicador sem `values` é a campanha
 * que não teve resultado nenhum: valor 0 (o custo sai null). Sem `results`, a
 * Meta não disse pelo que otimiza: null.
 */
function resultadoDe(results?: ResultadoMeta[]) {
  const r = results?.[0];
  return r?.indicator ? { tipo: r.indicator.replace(/^actions:/, ""), valor: numero(r.values?.[0]?.value) } : null;
}

export function metricasAds(i?: InsightAds): MetricasAds {
  const acao = (tipo: string) => numero(i?.actions?.find(a => a.action_type === tipo)?.value);
  // Os campos de vídeo e de clique de saída vêm como lista de ações (uma por tipo, em geral "video_view").
  const soma = (lista?: Array<{ value: string }>) => (lista ?? []).reduce((s, a) => s + numero(a.value), 0);
  const contagens: Contagens = {
    gasto: numero(i?.spend), impressoes: numero(i?.impressions), alcance: numero(i?.reach),
    cliques: numero(i?.clicks), cliquesUnicos: numero(i?.unique_clicks),
    cliquesLink: i?.inline_link_clicks !== undefined ? numero(i.inline_link_clicks) : acao("link_click"),
    cliquesSaida: soma(i?.outbound_clicks), visualizacoesPagina: acao("landing_page_view"),
    leads: acao("lead"), conversas: acao("onsite_conversion.messaging_conversation_started_7d"),
    compras: acao("purchase"), valorCompras: numero(i?.action_values?.find(a => a.action_type === "purchase")?.value),
    video3s: acao("video_view"), thruplays: soma(i?.video_thruplay_watched_actions),
    videoP25: soma(i?.video_p25_watched_actions), videoP50: soma(i?.video_p50_watched_actions),
    videoP75: soma(i?.video_p75_watched_actions), videoP95: soma(i?.video_p95_watched_actions),
    videoP100: soma(i?.video_p100_watched_actions),
    engajamentos: acao("post_engagement"), reacoes: acao("post_reaction"), comentarios: acao("comment"),
    compartilhamentos: acao("post"), salvamentos: acao("onsite_conversion.post_save"),
    visitasPerfil: numero(i?.instagram_profile_visits),
  };
  const temQualidade = Boolean(i?.quality_ranking || i?.engagement_rate_ranking || i?.conversion_rate_ranking);
  return comRazoes(contagens, {
    frequencia: i?.frequency ? numero(i.frequency) : null,
    tempoMedioVideo: i?.video_avg_time_watched_actions?.length ? numero(i.video_avg_time_watched_actions[0].value) : null,
    resultado: resultadoDe(i?.results),
    qualidade: temQualidade ? {
      qualidade: i?.quality_ranking ?? "UNKNOWN", engajamento: i?.engagement_rate_ranking ?? "UNKNOWN",
      conversao: i?.conversion_rate_ranking ?? "UNKNOWN",
    } : null,
  });
}

/**
 * A soma de vários objetos (os anúncios de uma peça), com as razões
 * recalculadas pelas mesmas fórmulas. Não serve para o total da conta: alcance
 * somado conta duas vezes quem viu dois anúncios (frequência e CPP aproximados).
 * O tempo médio é ponderado pelas reproduções de 3 s; o resultado só soma
 * quando todos otimizam pelo mesmo; a qualidade é a do que teve mais impressões.
 */
export function somarMetricas(lista: MetricasAds[]): MetricasAds {
  const c = Object.fromEntries(CONTAGENS.map(k => [k, lista.reduce((s, m) => s + m[k], 0)])) as Contagens;
  const comTempo = lista.filter(m => m.tempoMedioVideo !== null && m.video3s > 0);
  const peso = comTempo.reduce((s, m) => s + m.video3s, 0);
  // Um tipo só, e ninguém sem resultado: somar lead com conversa, ou com quem a Meta não informou, mentiria.
  const tipos = new Set(lista.map(m => m.resultado?.tipo ?? null));
  const tipo = tipos.size === 1 ? [...tipos][0] : null;
  const maisVisto = lista.filter(m => m.qualidade).sort((a, b) => b.impressoes - a.impressoes)[0];
  return comRazoes(c, {
    frequencia: dividir(c.impressoes, c.alcance),
    tempoMedioVideo: peso > 0 ? comTempo.reduce((s, m) => s + m.tempoMedioVideo! * m.video3s, 0) / peso : null,
    resultado: tipo !== null ? { tipo, valor: lista.reduce((s, m) => s + (m.resultado?.valor ?? 0), 0) } : null,
    qualidade: maisVisto?.qualidade ?? null,
  });
}

function valor(origem: OrigemAds, chaves: string[]) {
  for (const chave of chaves) {
    const v = origem?.[chave];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
// A origem que vale: a da oportunidade, quando ela tem campanha; senão a do
// contato. Serve à oportunidade e à entrada no CRM, que carregam os dois.
export function origemDaOportunidade(o: { campos: OrigemAds; contato_campos: OrigemAds }) {
  return valor(o.campos, ["campaign_id", "campanha_id", "utm_id", "campaign_name", "utm_campaign"])
    ? o.campos : o.contato_campos;
}
export function resolverOrigem(origem: OrigemAds, objetos: Array<Pick<ObjetoAds, "id" | "name">>, nivel: "campaign" | "adset" | "ad") {
  const ids = nivel === "campaign" ? ["campaign_id", "campanha_id", "utm_id"] : nivel === "adset" ? ["adset_id", "conjunto_id"] : ["ad_id", "anuncio_id"];
  const nomes = nivel === "campaign" ? ["campaign_name", "utm_campaign"] : nivel === "adset" ? ["adset_name", "utm_term"] : ["ad_name", "utm_content"];
  const id = valor(origem, ids), nome = valor(origem, nomes);
  if (!id && !nome) return { id: null, motivo: "semOrigem" as const };
  const encontrados = objetos.filter(o => id ? o.id === id : o.id === nome || o.name === nome);
  return encontrados.length === 1 ? { id: encontrados[0].id, motivo: null }
    : { id: null, motivo: encontrados.length > 1 ? "ambiguas" as const : "semCorrespondencia" as const };
}
/**
 * O anúncio de um lead na CONTA inteira: a campanha, depois o conjunto dentro
 * dela, depois o anúncio dentro do conjunto — o critério da gaveta de uma
 * campanha (carregarDetalheCampanha), sem chutar quando um nível não resolve.
 */
export function anuncioDaOrigem(
  origem: OrigemAds,
  campanhas: Array<Pick<ObjetoAds, "id" | "name">>,
  conjuntos: Array<Pick<ObjetoAds, "id" | "name" | "campaign_id">>,
  anuncios: Array<Pick<ObjetoAds, "id" | "name" | "adset_id">>,
): string | null {
  const campanha = resolverOrigem(origem, campanhas, "campaign").id;
  if (!campanha) return null;
  const conjunto = resolverOrigem(origem, conjuntos.filter(j => j.campaign_id === campanha), "adset").id;
  return conjunto ? resolverOrigem(origem, anuncios.filter(a => a.adset_id === conjunto), "ad").id : null;
}

/**
 * A PEÇA de um anúncio, o que junta anúncios no ranking de criativos: o vídeo,
 * a imagem ou, sem nenhum dos dois (catálogo), o próprio criativo. Anúncio sem
 * criativo conhecido (a Meta não devolveu o anúncio) é peça própria.
 *
 * Cada um tem três fontes, nesta ordem: o topo do criativo, o `asset_feed_spec`
 * (criativo DINÂMICO, que não traz nada no topo; 2026-10-23: eram 49 de 116
 * peças caindo em "outro") e o `object_story_spec`. Vídeo vem antes de imagem
 * porque o vídeo também tem imagem (a capa). O carrossel é conferido primeiro:
 * vários cartões não são a imagem de um deles.
 */
export function pecaDoAnuncio(anuncioId: string, criativo?: ObjetoAds["creative"]): { chave: string; tipo: TipoCriativoAds } {
  if (!criativo) return { chave: anuncioId, tipo: "outro" };
  const feed = criativo.asset_feed_spec, post = criativo.object_story_spec;
  if (post?.link_data?.child_attachments?.length) return { chave: criativo.id, tipo: "outro" };
  const video = criativo.video_id || feed?.videos?.[0]?.video_id || post?.video_data?.video_id;
  if (video) return { chave: video, tipo: "video" };
  const imagem = criativo.image_hash || feed?.images?.[0]?.hash || post?.link_data?.image_hash;
  if (imagem) return { chave: imagem, tipo: "imagem" };
  if (criativo.object_type === "PHOTO") return { chave: criativo.id, tipo: "imagem" };
  return { chave: criativo.id, tipo: "outro" };
}

/** O título e o texto do anúncio, nas mesmas três fontes da peça: topo, `asset_feed_spec`, `object_story_spec`. */
export function textosDoCriativo(criativo?: ObjetoAds["creative"]): { titulo: string | null; texto: string | null } {
  const feed = criativo?.asset_feed_spec, post = criativo?.object_story_spec;
  return {
    titulo: criativo?.title || feed?.titles?.[0]?.text || post?.link_data?.name || post?.video_data?.title || null,
    texto: criativo?.body || feed?.bodies?.[0]?.text || post?.link_data?.message || post?.video_data?.message || null,
  };
}

// O que perguntar à Meta para gravar o ID da campanha no lead, ou null quando
// não há o que fazer: já tem ID (que prevalece sobre o nome) ou não tem origem.
// Conjunto e anúncio por ID só valem como número, e todo texto com macro não
// substituída da URL ("{{adset.id}}", "{{campaign.name}}") é descartado: ele
// chega literal quando o link é aberto fora do anúncio (prévia, link copiado).
//
// Os NOMES de conjunto e anúncio (utm_term e utm_content, na convenção dos
// links) entraram em 2026-10-07: são a pista que sobra quando o nome da
// campanha não é mais o atual — ver campanhaPelosNomes.
export function pedidoDeCampanha(campos: OrigemAds) {
  if (valor(campos, ["campaign_id", "campanha_id", "utm_id"])) return null;
  const numero = (chaves: string[]) => { const v = valor(campos, chaves); return v && /^\d+$/.test(v) ? v : null; };
  const texto = (chaves: string[]) => { const v = valor(campos, chaves); return v && !/\{\{.*\}\}/.test(v) ? v : null; };
  const pedido = {
    nome: texto(["campaign_name", "utm_campaign"]),
    anuncio: numero(["ad_id", "anuncio_id"]), conjunto: numero(["adset_id", "conjunto_id"]),
    nomeDoConjunto: texto(["adset_name", "utm_term"]), nomeDoAnuncio: texto(["ad_name", "utm_content"]),
  };
  return Object.values(pedido).some(Boolean) ? pedido : null;
}

type PecaAds = { id: string; name: string; campaign_id?: string };

/**
 * A campanha de um lead pelo nome do CONJUNTO e do ANÚNCIO, quando o nome da
 * campanha não casa — ela foi renomeada entre o clique e o formulário, ou a
 * página guardou a UTM de uma visita antiga. Foi assim que os 42 leads de
 * "SCP - TOPO DE FUNIL [LEADS][CBO][LP]" se provaram da "TOPO CHECKLIST": o
 * conjunto e o anúncio deles só existem nela.
 *
 * Cada pista só vale se apontar UMA campanha (conjunto com o mesmo nome em duas
 * campanhas é o normal de quem duplica campanha), e as duas juntas têm de
 * concordar. Na dúvida, null: lead sem campanha é melhor que lead na errada.
 */
export function campanhaPelosNomes(
  pedido: { nomeDoConjunto: string | null; nomeDoAnuncio: string | null },
  conjuntos: PecaAds[], anuncios: PecaAds[],
): string | null {
  const unica = (lista: PecaAds[], nome: string | null) => {
    if (!nome) return null;
    const ids = new Set(lista.filter(x => x.name === nome && x.campaign_id).map(x => x.campaign_id!));
    return ids.size === 1 ? [...ids][0] : null;
  };
  const peloConjunto = unica(conjuntos, pedido.nomeDoConjunto), peloAnuncio = unica(anuncios, pedido.nomeDoAnuncio);
  if (peloConjunto && peloAnuncio && peloConjunto !== peloAnuncio) return null;
  return peloConjunto ?? peloAnuncio;
}
export function resumoCrm(oportunidades: OportunidadeAds[], etapaAlvo?: { funil_id: string; ordem: number }): CrmAds {
  const etapas = new Map<string, CrmAds["etapas"][number]>();
  for (const o of oportunidades) {
    const etapa = etapas.get(o.etapa_id) ?? { id: o.etapa_id, nome: o.etapa_nome, funil: o.funil_nome, ordem: o.etapa_ordem, total: 0 };
    etapa.total++; etapas.set(o.etapa_id, etapa);
  }
  return {
    leads: new Set(oportunidades.map(o => o.contato_id)).size, oportunidades: oportunidades.length,
    abertas: oportunidades.filter(o => o.status === "aberta").length,
    ganhas: oportunidades.filter(o => o.status === "ganha").length,
    perdidas: oportunidades.filter(o => o.status === "perdida").length,
    avancaram: oportunidades.filter(o => etapaAlvo
      ? o.funil_id === etapaAlvo.funil_id && o.etapa_ordem >= etapaAlvo.ordem
      : o.etapa_ordem > o.primeira_ordem || o.status === "ganha").length,
    valorGanho: oportunidades.filter(o => o.status === "ganha").reduce((s, o) => s + numero(o.valor), 0),
    valorAberto: oportunidades.filter(o => o.status === "aberta").reduce((s, o) => s + numero(o.valor), 0),
    etapas: [...etapas.values()].sort((a, b) => a.funil.localeCompare(b.funil) || a.ordem - b.ordem),
  };
}

/**
 * Leads por objeto (campanha, conjunto, anúncio): para cada id que `resolver`
 * devolver, os contatos dele com o dia da PRIMEIRA entrada. Uma pessoa conta
 * uma vez por objeto, mesmo com duas entradas no período — o contato que nasceu
 * e a oportunidade dele no mesmo minuto são a mesma pessoa chegando.
 *
 * `entradas` precisa vir em ordem de chegada: é a primeira que fica.
 */
export function leadsPor(entradas: EntradaCrm[], resolver: (e: EntradaCrm) => string | null) {
  const porObjeto = new Map<string, Map<string, string>>();
  for (const e of entradas) {
    const id = resolver(e);
    if (!id) continue;
    const contatos = porObjeto.get(id) ?? new Map<string, string>();
    if (!contatos.has(e.contato_id)) contatos.set(e.contato_id, e.dia);
    porObjeto.set(id, contatos);
  }
  return porObjeto;
}

type Situacao = Exclude<keyof LeadsCrm, "total">;
// Com duas entradas, vale a que a atribuição mais conseguiu dizer: a pessoa que
// entrou sem UTM e depois voltou por uma campanha é lead dessa campanha.
const PESO: Record<Situacao, number> = { atribuidos: 3, ambiguas: 2, semCorrespondencia: 1, semOrigem: 0 };

/** Quantas PESSOAS entraram no CRM no período, e o que a atribuição disse de cada uma. */
export function situacaoDosLeads(entradas: EntradaCrm[], campanhas: ObjetoAds[]): LeadsCrm {
  const porContato = new Map<string, Situacao>();
  for (const e of entradas) {
    const r = resolverOrigem(origemDaOportunidade(e), campanhas, "campaign");
    const s: Situacao = r.id ? "atribuidos" : r.motivo!;
    const atual = porContato.get(e.contato_id);
    if (atual === undefined || PESO[s] > PESO[atual]) porContato.set(e.contato_id, s);
  }
  const resumo: LeadsCrm = { total: porContato.size, atribuidos: 0, semOrigem: 0, semCorrespondencia: 0, ambiguas: 0 };
  for (const s of porContato.values()) resumo[s]++;
  return resumo;
}
