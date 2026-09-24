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
export type CrmAds = {
  leads: number; oportunidades: number; abertas: number; ganhas: number; perdidas: number;
  avancaram: number; valorGanho: number; valorAberto: number;
  etapas: Array<{ id: string; nome: string; funil: string; ordem: number; total: number }>;
};
export type LinhaAds = ObjetoAds & { nivel: NivelAds; metricas: MetricasAds; crm: CrmAds | null };
export type RelatorioAds = {
  conta: { id: string; name: string; currency: string; timezone_name: string };
  periodo: { inicio: string; fim: string };
  permissoes: string[]; campanhas: LinhaAds[]; conjuntos: LinhaAds[]; anuncios: LinhaAds[];
  total: { metricas: MetricasAds; crm: CrmAds | null };
  diario: Array<{ dia: string; gasto: number; leads: number; cliques: number }>;
  atribuicao: { total: number; atribuidas: number; semOrigem: number; semCorrespondencia: number; ambiguas: number; semConjunto: number; semAnuncio: number } | null;
  funis: Array<{ id: string; nome: string }>;
  etapas: Array<{ id: string; nome: string; funil_id: string; ordem: number }>;
  avisos: string[];
};
export type RecursoMeta = { id: string; name?: string; status?: string; subtype?: string; approximate_count_lower_bound?: number; creation_time?: string; leadgen_export_csv_url?: string };
export type RecursosAds = { publicos: RecursoMeta[]; pixels: RecursoMeta[]; paginas: RecursoMeta[]; formularios: RecursoMeta[]; avisos: string[] };
// Série diária de UMA campanha, carregada só quando a gaveta abre: o relatório
// da conta não traz insights por dia por campanha porque isso multiplicaria as
// páginas da Meta (campanhas × dias) em toda carga do painel.
export type DiaCampanhaAds = { dia: string; gasto: number; cliques: number; leads: number; oportunidades: number; ganhas: number; valorGanho: number };
export type SerieCampanhaAds = { campanha: { id: string; nome: string }; crm: boolean; dias: DiaCampanhaAds[] };
