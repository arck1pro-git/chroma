import type { CrmAds, InsightAds, LeadsCrm, MetricasAds, ObjetoAds } from "./meta-ads-tipos";

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
export function metricasAds(i?: InsightAds): MetricasAds {
  const gasto = numero(i?.spend), cliques = numero(i?.clicks), impressoes = numero(i?.impressions);
  const acao = (tipo: string) => numero(i?.actions?.find(a => a.action_type === tipo)?.value);
  return { gasto, cliques, impressoes, alcance: numero(i?.reach),
    ctr: dividir(cliques * 100, impressoes), cpc: dividir(gasto, cliques), cpm: dividir(gasto * 1000, impressoes),
    frequencia: i?.frequency ? numero(i.frequency) : null, leads: acao("lead"), compras: acao("purchase"),
    valorCompras: numero(i?.action_values?.find(a => a.action_type === "purchase")?.value) };
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
export function resolverOrigem(origem: OrigemAds, objetos: ObjetoAds[], nivel: "campaign" | "adset" | "ad") {
  const ids = nivel === "campaign" ? ["campaign_id", "campanha_id", "utm_id"] : nivel === "adset" ? ["adset_id", "conjunto_id"] : ["ad_id", "anuncio_id"];
  const nomes = nivel === "campaign" ? ["campaign_name", "utm_campaign"] : nivel === "adset" ? ["adset_name", "utm_term"] : ["ad_name", "utm_content"];
  const id = valor(origem, ids), nome = valor(origem, nomes);
  if (!id && !nome) return { id: null, motivo: "semOrigem" as const };
  const encontrados = objetos.filter(o => id ? o.id === id : o.id === nome || o.name === nome);
  return encontrados.length === 1 ? { id: encontrados[0].id, motivo: null }
    : { id: null, motivo: encontrados.length > 1 ? "ambiguas" as const : "semCorrespondencia" as const };
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
