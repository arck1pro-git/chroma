import type { CrmAds, InsightAds, MetricasAds, ObjetoAds } from "./meta-ads-tipos";

export type OrigemAds = Record<string, unknown> | null;
export type OportunidadeAds = {
  id: string; contato_id: string; status: string; valor: number;
  etapa_id: string; etapa_nome: string; etapa_ordem: number; funil_id: string; funil_nome: string;
  primeira_ordem: number; campos: OrigemAds; contato_campos: OrigemAds;
};
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
export function origemDaOportunidade(o: OportunidadeAds) {
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
