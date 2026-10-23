export type NivelAds = "campaign" | "adset" | "ad";
export type ObjetoAds = {
  id: string; name: string; status: string; effective_status: string;
  campaign_id?: string; adset_id?: string; objective?: string;
  daily_budget?: string; lifetime_budget?: string; start_time?: string; end_time?: string;
  targeting?: Record<string, unknown>;
  creative?: {
    id: string; name?: string; title?: string; body?: string; thumbnail_url?: string; image_url?: string; object_story_id?: string;
    /** O que junta anúncios na mesma peça (pecaDoAnuncio em lib/meta-ads-calculos.ts). */
    video_id?: string; image_hash?: string; object_type?: string;
    instagram_permalink_url?: string;
    /**
     * Criativo DINÂMICO: sem vídeo, imagem, texto nem título no topo; as
     * variações (feed, story) vêm aqui, e a primeira de cada é a que vale.
     */
    asset_feed_spec?: {
      images?: Array<{ hash?: string }>; videos?: Array<{ video_id?: string }>;
      bodies?: Array<{ text?: string }>; titles?: Array<{ text?: string }>;
    };
    /** O post montado do anúncio: a última fonte de vídeo, imagem, texto e título; com `child_attachments`, é carrossel. */
    object_story_spec?: {
      link_data?: { image_hash?: string; message?: string; name?: string; child_attachments?: Array<{ name?: string }> };
      video_data?: { video_id?: string; message?: string; title?: string };
    };
  };
};
/** Uma ação contada pela Meta ("lead", "video_view", "link_click"...). */
export type AcaoMeta = { action_type: string; value: string };
/** `results` e `cost_per_result`: o resultado pelo qual a campanha otimiza ("actions:lead"). */
export type ResultadoMeta = { indicator: string; values?: Array<{ value: string }> };
export type InsightAds = {
  campaign_id?: string; adset_id?: string; ad_id?: string; date_start?: string;
  /** Só na leitura por anúncio: o nome de quem a Meta não devolve mais na lista de anúncios. */
  ad_name?: string;
  spend?: string; impressions?: string; reach?: string; clicks?: string; unique_clicks?: string;
  ctr?: string; cpc?: string; cpm?: string; cpp?: string; frequency?: string;
  inline_link_clicks?: string; outbound_clicks?: AcaoMeta[];
  actions?: AcaoMeta[];
  action_values?: AcaoMeta[];
  video_thruplay_watched_actions?: AcaoMeta[];
  video_p25_watched_actions?: AcaoMeta[]; video_p50_watched_actions?: AcaoMeta[]; video_p75_watched_actions?: AcaoMeta[];
  video_p95_watched_actions?: AcaoMeta[]; video_p100_watched_actions?: AcaoMeta[];
  video_avg_time_watched_actions?: AcaoMeta[];
  instagram_profile_visits?: string;
  /** Só no nível de anúncio, e só com volume (abaixo de ~500 impressões vem UNKNOWN). */
  quality_ranking?: string; engagement_rate_ranking?: string; conversion_rate_ranking?: string;
  results?: ResultadoMeta[]; cost_per_result?: ResultadoMeta[];
};
/**
 * Tudo o que o Gerenciador de Anúncios mostra de um objeto no período, já em
 * número. Contagens são 0 quando a Meta não manda; razões são null quando o
 * denominador é zero (custo por lead sem lead não é zero, é "não há").
 *
 * Os nomes das ações da Meta que viram cada campo estão em metricasAds
 * (lib/meta-ads-calculos.ts); o rótulo, o formato e a descrição de cada um, em
 * lib/meta-ads-metricas.ts.
 */
export type MetricasAds = {
  // Entrega
  gasto: number; impressoes: number; alcance: number;
  frequencia: number | null; cpm: number | null; /** Custo por mil pessoas alcançadas. */ cpp: number | null;
  // Cliques. `cliques` são TODOS (curtir, abrir foto, perfil); o que leva para fora é o clique no link.
  cliques: number; cliquesUnicos: number; ctr: number | null; cpc: number | null;
  cliquesLink: number; ctrLink: number | null; cpcLink: number | null; cliquesSaida: number;
  /** Visualizações da página de destino (o clique que carregou a página). */
  visualizacoesPagina: number; custoVisualizacaoPagina: number | null;
  /** Visualizações da página ÷ cliques no link, em %: quanto do clique virou página aberta. */
  taxaCarregamento: number | null;
  // Resultados
  leads: number; custoPorLead: number | null;
  /** Conversas iniciadas por mensagem (7 dias). */
  conversas: number; custoPorConversa: number | null;
  compras: number; valorCompras: number;
  /** O resultado pelo qual o objeto otimiza, como a Meta conta. null quando ela não informa. */
  resultado: { tipo: string; valor: number; custo: number | null } | null;
  // Vídeo. `video3s` é a reprodução de 3 segundos (a "visualização" da Meta).
  video3s: number; thruplays: number;
  videoP25: number; videoP50: number; videoP75: number; videoP95: number; videoP100: number;
  /** Tempo médio assistido, em segundos. */
  tempoMedioVideo: number | null;
  /** Reproduções de 3 s ÷ impressões, em %: quanto o começo segura quem passa. */
  taxaGancho: number | null;
  /** ThruPlays ÷ reproduções de 3 s, em %: quem começou e foi até o fim (ou 15 s). */
  taxaRetencao: number | null;
  custoThruplay: number | null;
  // Engajamento
  engajamentos: number; reacoes: number; comentarios: number; compartilhamentos: number;
  salvamentos: number; visitasPerfil: number;
  /** Os três diagnósticos de relevância da Meta. Só anúncio, e só com volume. */
  qualidade: { qualidade: string; engajamento: string; conversao: string } | null;
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
export type DiaAds = { dia: string; gasto: number; impressoes: number; cliquesLink: number; leadsMeta: number; leadsCrm: number };

/** O período imediatamente anterior, do mesmo tamanho: a base das setas de variação da tela. */
export type PeriodoAnteriorAds = { periodo: { inicio: string; fim: string }; metricas: MetricasAds; crm: CrmAds | null };

export type RelatorioAds = {
  conta: { id: string; name: string; currency: string; timezone_name: string };
  periodo: { inicio: string; fim: string };
  permissoes: string[];
  campanhas: LinhaAds[];
  /**
   * `metricas` é a leitura da CONTA na Meta, não a soma das campanhas: alcance
   * e frequência não somam (a mesma pessoa vista por duas campanhas é uma só).
   * Os outros campos ficam por compatibilidade e batem com a soma.
   */
  total: { gasto: number; cliques: number; impressoes: number; leadsMeta: number; crm: CrmAds | null; metricas: MetricasAds };
  anterior: PeriodoAnteriorAds | null;
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

// ── Criativos da conta ──────────────────────────────────────────────────────
//
// O ranking de criativos é por PEÇA, não por anúncio: o mesmo vídeo publicado
// em três campanhas são três anúncios e um criativo. A peça é o vídeo
// (`video_id`), a imagem (`image_hash`) ou, sem nenhum dos dois (carrossel,
// catálogo), o próprio criativo.

export type TipoCriativoAds = "video" | "imagem" | "outro";

/** Um anúncio de uma peça, com o que ele rendeu sozinho. */
export type AnuncioDaPecaAds = {
  id: string; nome: string; effective_status: string;
  campanha: { id: string; nome: string };
  conjunto: { id: string; nome: string } | null;
  metricas: MetricasAds;
};

export type CriativoAds = {
  /** video_id, image_hash ou id do criativo — o que junta os anúncios da mesma peça. */
  chave: string;
  /** O nome do anúncio que mais investiu com a peça. */
  nome: string;
  tipo: TipoCriativoAds;
  /** Miniatura de até 480 px, da Meta (o link expira em alguns dias: não guardar). */
  miniatura: string | null;
  titulo: string | null;
  texto: string | null;
  /** Link do post no Instagram, quando há. */
  instagram: string | null;
  /** Algum anúncio da peça está em veiculação. */
  ativo: boolean;
  anuncios: AnuncioDaPecaAds[];
  /**
   * A soma dos anúncios da peça, com as razões recalculadas. Alcance é a soma
   * (a Meta não deduplica entre anúncios), então a frequência é aproximada; a
   * qualidade é a do anúncio com mais impressões.
   */
  metricas: MetricasAds;
  /** Leads contados uma vez por peça, mesmo vindos por dois anúncios dela. */
  crm: CrmAds | null;
};

export type CriativosAds = {
  periodo: { inicio: string; fim: string };
  crm: boolean;
  /** Só peças que veicularam no período. */
  criativos: CriativoAds[];
  atualizadoEm: string;
};
