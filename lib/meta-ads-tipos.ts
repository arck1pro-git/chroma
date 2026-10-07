export type NivelAds = "campaign" | "adset" | "ad";
export type ObjetoAds = {
  id: string; name: string; status: string; effective_status: string;
  campaign_id?: string; adset_id?: string; objective?: string;
  daily_budget?: string; lifetime_budget?: string; start_time?: string; end_time?: string;
  targeting?: Record<string, unknown>;
  creative?: { id: string; name?: string; title?: string; body?: string; thumbnail_url?: string; image_url?: string; object_story_id?: string };
};
export type InsightAds = {
  campaign_id?: string; adset_id?: string; ad_id?: string; date_start?: string;
  spend?: string; impressions?: string; reach?: string; clicks?: string;
  ctr?: string; cpc?: string; cpm?: string; frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
};
export type MetricasAds = {
  gasto: number; impressoes: number; alcance: number; cliques: number;
  ctr: number | null; cpc: number | null; cpm: number | null; frequencia: number | null;
  leads: number; compras: number; valorCompras: number;
};
/**
 * O resultado no CRM. `leads` são PESSOAS: contatos que entraram no CRM no
 * período (contato novo ou oportunidade nova) atribuídos a este objeto, cada
 * um contado uma vez. O resto conta oportunidades criadas no período.
 */
export type CrmAds = {
  leads: number; oportunidades: number; abertas: number; ganhas: number; perdidas: number;
  avancaram: number; valorGanho: number; valorAberto: number;
  etapas: Array<{ id: string; nome: string; funil: string; ordem: number; total: number }>;
};
export type LinhaAds = ObjetoAds & { nivel: NivelAds; metricas: MetricasAds; crm: CrmAds | null };

/**
 * Os leads do CRM no período, separados pelo que a atribuição conseguiu dizer
 * de cada pessoa. A soma das quatro situações é o `total`.
 */
export type LeadsCrm = {
  /** Pessoas que entraram ou voltaram ao CRM no período, de qualquer origem. */
  total: number;
  /** Ligadas a uma campanha desta conta. */
  atribuidos: number;
  /** Sem UTM nem ID de campanha: WhatsApp direto, cadastro à mão, importação. */
  semOrigem: number;
  /** Com origem que não é campanha desta conta: outra conta, Google, nome que mudou. */
  semCorrespondencia: number;
  /** O nome bate com mais de uma campanha — não se chuta. */
  ambiguas: number;
};

/** Um dia do período: o que a Meta contou e o que chegou ao CRM. */
export type DiaAds = { dia: string; gasto: number; leadsMeta: number; leadsCrm: number };

export type RelatorioAds = {
  conta: { id: string; name: string; currency: string; timezone_name: string };
  periodo: { inicio: string; fim: string };
  permissoes: string[];
  campanhas: LinhaAds[];
  total: { gasto: number; cliques: number; impressoes: number; leadsMeta: number; crm: CrmAds | null };
  diario: DiaAds[];
  leadsCrm: LeadsCrm | null;
  /** Quando os números da Meta saíram de lá (ISO): eles ficam guardados por alguns minutos. */
  atualizadoEm: string;
  avisos: string[];
};
export type RecursoMeta = { id: string; name?: string; status?: string; subtype?: string; approximate_count_lower_bound?: number; creation_time?: string; leadgen_export_csv_url?: string };
export type RecursosAds = { publicos: RecursoMeta[]; pixels: RecursoMeta[]; paginas: RecursoMeta[]; formularios: RecursoMeta[]; avisos: string[] };

// O que a gaveta de UMA campanha carrega quando abre: a série por dia, os
// conjuntos e os anúncios. Nada disso vem no relatório da conta — conjuntos e
// anúncios com criativo e os insights deles eram metade do tempo de abrir a
// tela, para serem vistos só quando alguém abre uma campanha.
export type DiaCampanhaAds = {
  dia: string; gasto: number; cliques: number; leadsMeta: number; leadsCrm: number;
  oportunidades: number; ganhas: number; valorGanho: number;
};
export type DetalheCampanhaAds = {
  campanha: { id: string; nome: string };
  crm: boolean;
  dias: DiaCampanhaAds[];
  conjuntos: LinhaAds[];
  anuncios: LinhaAds[];
  atualizadoEm: string;
};
