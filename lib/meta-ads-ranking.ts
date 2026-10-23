// O ranking das campanhas e dos criativos (pedido dele, 2026-10-23: "um
// ranking das melhores campanhas e do melhor criativo").
//
// "MELHOR" PRECISA DE REGRA À VISTA, não de nota mágica: a tela diz por qual
// critério ordenou e qual volume mínimo exigiu. O padrão é o custo por lead que
// CHEGOU AO CRM — o que a equipe de fato recebe —, e sem acesso ao funil, o
// custo por lead da Meta.
//
// O VOLUME MÍNIMO é o que impede a sorte de ganhar: uma campanha com 1 lead a
// R$ 4 não é melhor que uma com 80 leads a R$ 11. Quem fica abaixo do mínimo não
// entra, e a tela conta quantos ficaram de fora.
//
// Sem servidor: a tela ordena o que já tem.
import { metrica, type ContextoMetrica, type DefMetrica, type LinhaMetricas } from "./meta-ads-metricas";

export type CriterioRanking = {
  id: string;
  rotulo: string;
  /** A métrica que ordena, do catálogo. */
  metrica: string;
  /** O volume para entrar no ranking, dito como gente fala. */
  minimo: string;
  elegivel: (l: LinhaMetricas) => boolean;
  /** Precisa do CRM: sem acesso ao funil, o critério não aparece. */
  crm?: boolean;
  /** Só faz sentido para vídeo. */
  video?: boolean;
};

// Custo só ranqueia quem gastou: campanha parada no período cujos leads chegam
// ao CRM por um clique antigo sairia com custo zero e ganharia o pódio.
const investiu = (l: LinhaMetricas) => l.metricas.gasto > 0;

export const CRITERIOS_RANKING: CriterioRanking[] = [
  { id: "custoLeadCrm", rotulo: "Menor custo por lead (CRM)", metrica: "custoLeadCrm", minimo: "3 leads no CRM", crm: true,
    elegivel: (l) => investiu(l) && (l.crm?.leads ?? 0) >= 3 },
  { id: "leadsCrm", rotulo: "Mais leads (CRM)", metrica: "leadsCrm", minimo: "1 lead no CRM", crm: true,
    elegivel: (l) => (l.crm?.leads ?? 0) >= 1 },
  { id: "custoOportunidade", rotulo: "Menor custo por oportunidade", metrica: "custoOportunidade", minimo: "2 oportunidades", crm: true,
    elegivel: (l) => investiu(l) && (l.crm?.oportunidades ?? 0) >= 2 },
  { id: "oportunidades", rotulo: "Mais oportunidades", metrica: "oportunidades", minimo: "1 oportunidade", crm: true,
    elegivel: (l) => (l.crm?.oportunidades ?? 0) >= 1 },
  { id: "custoPorLead", rotulo: "Menor custo por lead (Meta)", metrica: "custoPorLead", minimo: "3 leads na Meta",
    elegivel: (l) => investiu(l) && l.metricas.leads >= 3 },
  { id: "leads", rotulo: "Mais leads (Meta)", metrica: "leads", minimo: "1 lead na Meta",
    elegivel: (l) => l.metricas.leads >= 1 },
  { id: "ctrLink", rotulo: "Maior CTR do link", metrica: "ctrLink", minimo: "1.000 impressões",
    elegivel: (l) => l.metricas.impressoes >= 1000 },
  { id: "taxaGancho", rotulo: "Maior taxa de gancho", metrica: "taxaGancho", minimo: "1.000 impressões com vídeo", video: true,
    elegivel: (l) => l.metricas.impressoes >= 1000 && l.metricas.video3s > 0 },
  { id: "taxaRetencao", rotulo: "Maior retenção do vídeo", metrica: "taxaRetencao", minimo: "500 reproduções de 3 s", video: true,
    elegivel: (l) => l.metricas.video3s >= 500 },
];

export function criterio(id: string): CriterioRanking {
  return CRITERIOS_RANKING.find((c) => c.id === id) ?? CRITERIOS_RANKING[0];
}

/** Os critérios que valem para quem está vendo: sem CRM, os do funil saem. */
export function criteriosDisponiveis(temCrm: boolean, comVideo = true) {
  return CRITERIOS_RANKING.filter((c) => (temCrm || !c.crm) && (comVideo || !c.video));
}

export type PosicaoRanking<T> = { item: T; valor: number; posicao: number };

/**
 * Os itens elegíveis, do melhor para o pior pelo critério. Empate (o mesmo
 * custo, a mesma taxa) fica com quem investiu mais: o mesmo resultado com mais
 * volume é mais confiável.
 */
export function ranquear<T extends LinhaMetricas>(itens: T[], c: CriterioRanking, ctx: ContextoMetrica) {
  const def: DefMetrica = metrica(c.metrica);
  const sentido = def.melhor === "menor" ? 1 : -1;
  const comValor: Array<{ item: T; valor: number }> = [];
  let foraDoMinimo = 0;
  for (const item of itens) {
    const valor = c.elegivel(item) ? def.valor(item, ctx) : null;
    if (valor === null || !Number.isFinite(valor)) { if (item.metricas.gasto > 0 || item.metricas.impressoes > 0) foraDoMinimo++; continue; }
    comValor.push({ item, valor });
  }
  comValor.sort((a, b) => (a.valor - b.valor) * sentido || b.item.metricas.gasto - a.item.metricas.gasto);
  const posicoes: Array<PosicaoRanking<T>> = comValor.map((x, i) => ({ ...x, posicao: i + 1 }));
  return { posicoes, foraDoMinimo, def };
}

/**
 * A ordem em que a tela procura um critério que ranqueie alguém: o custo por
 * lead do CRM primeiro; num período sem lead atribuído, o da Meta; depois volume
 * e clique.
 */
export function preferenciaDeCriterio(temCrm: boolean) {
  return temCrm ? ["custoLeadCrm", "custoPorLead", "leads", "ctrLink"] : ["custoPorLead", "leads", "ctrLink"];
}

/**
 * O primeiro critério da lista que ranqueia alguém. Abre a tela no custo por
 * lead do CRM; num período sem lead atribuído, cai para o da Meta em vez de
 * mostrar um pódio vazio.
 */
export function primeiroQueRanqueia<T extends LinhaMetricas>(itens: T[], ids: string[], ctx: ContextoMetrica): CriterioRanking {
  for (const id of ids) {
    const c = criterio(id);
    if (ranquear(itens, c, ctx).posicoes.length > 0) return c;
  }
  return criterio(ids[0]);
}