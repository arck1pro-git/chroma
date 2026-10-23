// O catálogo das métricas de Meta Ads: rótulo, formato, descrição e se maior é
// melhor, uma vez só. A tabela de campanhas, a gaveta, os números do topo, o
// CSV e o ranking leem daqui (pedido dele, 2026-10-23: "todas as métricas
// possíveis do gerenciador").
//
// Sem servidor: a tela importa direto. Os campos vêm de MetricasAds (o que a
// Meta conta, ver metricasAds em lib/meta-ads-calculos.ts) e de CrmAds (o que
// chegou ao CRM).
//
// As VISÕES são os conjuntos de colunas da tabela, como as do Gerenciador
// ("Desempenho", "Entrega", "Vídeo"...): todas as métricas ficam a um clique
// sem a tabela virar uma planilha de 40 colunas.
import { dividir } from "./meta-ads-calculos";
import type { CrmAds, MetricasAds } from "./meta-ads-tipos";

export type FormatoMetrica = "moeda" | "real" | "inteiro" | "porcento" | "decimal" | "multiplo" | "segundos";
export type GrupoMetrica = "resultado" | "crm" | "entrega" | "cliques" | "video" | "engajamento";
export type LinhaMetricas = { metricas: MetricasAds; crm: CrmAds | null };
/** A moeda da conta: o retorno (valor ganho em real ÷ investido) só existe quando ela é o real. */
export type ContextoMetrica = { moeda: string };

export type DefMetrica = {
  chave: string;
  rotulo: string;
  /** Cabeçalho de coluna, quando o rótulo não cabe. */
  curto: string;
  descricao: string;
  formato: FormatoMetrica;
  /** null: nem mais nem menos é melhor (investido, impressões). */
  melhor: "maior" | "menor" | null;
  grupo: GrupoMetrica;
  /** Depende do CRM: sem acesso ao funil, fica "—". */
  crm?: boolean;
  /** Some da grade quando não há valor: o "resultado" da conta inteira, com objetivos misturados, a Meta não informa. */
  opcional?: boolean;
  valor: (l: LinhaMetricas, ctx: ContextoMetrica) => number | null;
};

const m = (f: (x: MetricasAds) => number | null) => (l: LinhaMetricas) => f(l.metricas);
const doCrm = (f: (c: CrmAds, x: MetricasAds) => number | null) => (l: LinhaMetricas) => (l.crm ? f(l.crm, l.metricas) : null);
const pct = (n: number, d: number) => dividir(n * 100, d);

export const METRICAS: DefMetrica[] = [
  // ── Resultado na Meta ──
  { chave: "gasto", rotulo: "Investido", curto: "Investido", formato: "moeda", melhor: null, grupo: "resultado",
    descricao: "Quanto a Meta cobrou no período.", valor: m((x) => x.gasto) },
  { chave: "leads", rotulo: "Leads na Meta", curto: "Leads Meta", formato: "inteiro", melhor: "maior", grupo: "resultado",
    descricao: "Cadastros que a Meta atribui ao anúncio (formulário e site), pelas regras de atribuição dela.", valor: m((x) => x.leads) },
  { chave: "custoPorLead", rotulo: "Custo por lead na Meta", curto: "CPL Meta", formato: "moeda", melhor: "menor", grupo: "resultado",
    descricao: "Investido ÷ leads que a Meta contou.", valor: m((x) => x.custoPorLead) },
  { chave: "resultados", rotulo: "Resultados", curto: "Resultados", formato: "inteiro", melhor: "maior", grupo: "resultado", opcional: true,
    descricao: "O resultado pelo qual a campanha otimiza (lead, conversa, ThruPlay...), como a Meta conta.", valor: m((x) => x.resultado?.valor ?? null) },
  { chave: "custoResultado", rotulo: "Custo por resultado", curto: "Custo/result.", formato: "moeda", melhor: "menor", grupo: "resultado", opcional: true,
    descricao: "Investido ÷ resultados, como o Gerenciador mostra.", valor: m((x) => x.resultado?.custo ?? null) },
  { chave: "conversas", rotulo: "Conversas iniciadas", curto: "Conversas", formato: "inteiro", melhor: "maior", grupo: "resultado",
    descricao: "Conversas por mensagem (WhatsApp, Direct, Messenger) começadas a partir do anúncio.", valor: m((x) => x.conversas) },
  { chave: "custoPorConversa", rotulo: "Custo por conversa", curto: "Custo/conversa", formato: "moeda", melhor: "menor", grupo: "resultado",
    descricao: "Investido ÷ conversas iniciadas.", valor: m((x) => x.custoPorConversa) },

  // ── Resultado no CRM ──
  { chave: "leadsCrm", rotulo: "Leads no CRM", curto: "Leads CRM", formato: "inteiro", melhor: "maior", grupo: "crm", crm: true,
    descricao: "Pessoas que entraram no CRM no período vindas daqui (UTM ou ID da campanha), cada uma contada uma vez.", valor: doCrm((c) => c.leads) },
  { chave: "custoLeadCrm", rotulo: "Custo por lead no CRM", curto: "CPL CRM", formato: "moeda", melhor: "menor", grupo: "crm", crm: true,
    descricao: "Investido ÷ leads que chegaram ao CRM. O custo real de cada pessoa que a equipe recebe.", valor: doCrm((c, x) => dividir(x.gasto, c.leads)) },
  { chave: "aproveitamento", rotulo: "Leads que chegaram ao CRM", curto: "% no CRM", formato: "porcento", melhor: "maior", grupo: "crm", crm: true,
    descricao: "Leads no CRM ÷ leads na Meta. Muito abaixo de 100% pede olhar a página e a captação.", valor: doCrm((c, x) => pct(c.leads, x.leads)) },
  { chave: "oportunidades", rotulo: "Oportunidades", curto: "Oportunidades", formato: "inteiro", melhor: "maior", grupo: "crm", crm: true,
    descricao: "Oportunidades criadas no período atribuídas a este anúncio.", valor: doCrm((c) => c.oportunidades) },
  { chave: "custoOportunidade", rotulo: "Custo por oportunidade", curto: "Custo/oport.", formato: "moeda", melhor: "menor", grupo: "crm", crm: true,
    descricao: "Investido ÷ oportunidades.", valor: doCrm((c, x) => dividir(x.gasto, c.oportunidades)) },
  { chave: "avancaram", rotulo: "Avançaram no funil", curto: "Avançaram", formato: "inteiro", melhor: "maior", grupo: "crm", crm: true,
    descricao: "Oportunidades que saíram da primeira etapa (ou chegaram à etapa escolhida).", valor: doCrm((c) => c.avancaram) },
  { chave: "ganhas", rotulo: "Vendas", curto: "Ganhas", formato: "inteiro", melhor: "maior", grupo: "crm", crm: true,
    descricao: "Oportunidades ganhas.", valor: doCrm((c) => c.ganhas) },
  { chave: "valorGanho", rotulo: "Valor ganho", curto: "Valor ganho", formato: "real", melhor: "maior", grupo: "crm", crm: true,
    descricao: "Soma do valor das oportunidades ganhas, em real.", valor: doCrm((c) => c.valorGanho) },
  { chave: "retorno", rotulo: "Retorno sobre o investido", curto: "Retorno", formato: "multiplo", melhor: "maior", grupo: "crm", crm: true,
    descricao: "Valor ganho ÷ investido. Só com a conta em real.",
    valor: (l, ctx) => (l.crm && ctx.moeda === "BRL" ? dividir(l.crm.valorGanho, l.metricas.gasto) : null) },

  // ── Entrega ──
  { chave: "impressoes", rotulo: "Impressões", curto: "Impressões", formato: "inteiro", melhor: null, grupo: "entrega",
    descricao: "Vezes que o anúncio apareceu na tela.", valor: m((x) => x.impressoes) },
  { chave: "alcance", rotulo: "Alcance", curto: "Alcance", formato: "inteiro", melhor: "maior", grupo: "entrega",
    descricao: "Pessoas diferentes que viram o anúncio ao menos uma vez.", valor: m((x) => x.alcance) },
  { chave: "frequencia", rotulo: "Frequência", curto: "Frequência", formato: "decimal", melhor: null, grupo: "entrega",
    descricao: "Vezes, em média, que cada pessoa viu. Acima de 3 a 4 o público costuma cansar.", valor: m((x) => x.frequencia) },
  { chave: "cpm", rotulo: "CPM", curto: "CPM", formato: "moeda", melhor: "menor", grupo: "entrega",
    descricao: "Custo por mil impressões: o preço do leilão.", valor: m((x) => x.cpm) },
  { chave: "cpp", rotulo: "Custo por mil alcançadas", curto: "CPM alcance", formato: "moeda", melhor: "menor", grupo: "entrega",
    descricao: "Custo para alcançar mil pessoas diferentes.", valor: m((x) => x.cpp) },

  // ── Cliques ──
  { chave: "cliquesLink", rotulo: "Cliques no link", curto: "Cliques link", formato: "inteiro", melhor: "maior", grupo: "cliques",
    descricao: "Cliques que levam para fora do anúncio (página, formulário, WhatsApp).", valor: m((x) => x.cliquesLink) },
  { chave: "ctrLink", rotulo: "CTR do link", curto: "CTR link", formato: "porcento", melhor: "maior", grupo: "cliques",
    descricao: "Cliques no link ÷ impressões: quanto o anúncio convence a clicar.", valor: m((x) => x.ctrLink) },
  { chave: "cpcLink", rotulo: "CPC do link", curto: "CPC link", formato: "moeda", melhor: "menor", grupo: "cliques",
    descricao: "Investido ÷ cliques no link.", valor: m((x) => x.cpcLink) },
  { chave: "visualizacoesPagina", rotulo: "Visualizações da página", curto: "Visual. página", formato: "inteiro", melhor: "maior", grupo: "cliques",
    descricao: "Cliques que chegaram a carregar a página de destino.", valor: m((x) => x.visualizacoesPagina) },
  { chave: "custoVisualizacaoPagina", rotulo: "Custo por visualização da página", curto: "Custo/visual.", formato: "moeda", melhor: "menor", grupo: "cliques",
    descricao: "Investido ÷ visualizações da página.", valor: m((x) => x.custoVisualizacaoPagina) },
  { chave: "taxaCarregamento", rotulo: "Taxa de carregamento", curto: "Carregamento", formato: "porcento", melhor: "maior", grupo: "cliques",
    descricao: "Visualizações da página ÷ cliques no link. Baixa indica página lenta ou clique acidental.", valor: m((x) => x.taxaCarregamento) },
  { chave: "cliques", rotulo: "Cliques (todos)", curto: "Cliques", formato: "inteiro", melhor: "maior", grupo: "cliques",
    descricao: "Todos os cliques, inclusive curtir, abrir a foto e o perfil.", valor: m((x) => x.cliques) },
  { chave: "ctr", rotulo: "CTR (todos)", curto: "CTR", formato: "porcento", melhor: "maior", grupo: "cliques",
    descricao: "Todos os cliques ÷ impressões.", valor: m((x) => x.ctr) },
  { chave: "cpc", rotulo: "CPC (todos)", curto: "CPC", formato: "moeda", melhor: "menor", grupo: "cliques",
    descricao: "Investido ÷ todos os cliques.", valor: m((x) => x.cpc) },
  { chave: "cliquesSaida", rotulo: "Cliques de saída", curto: "Saída", formato: "inteiro", melhor: "maior", grupo: "cliques",
    descricao: "Cliques que tiram a pessoa do Facebook ou do Instagram.", valor: m((x) => x.cliquesSaida) },

  // ── Vídeo ──
  { chave: "video3s", rotulo: "Reproduções de 3 s", curto: "Vídeo 3 s", formato: "inteiro", melhor: "maior", grupo: "video",
    descricao: "Vezes que o vídeo foi assistido por 3 segundos ou mais.", valor: m((x) => x.video3s) },
  { chave: "taxaGancho", rotulo: "Taxa de gancho", curto: "Gancho", formato: "porcento", melhor: "maior", grupo: "video",
    descricao: "Reproduções de 3 s ÷ impressões: quanto o começo do vídeo segura quem passa.", valor: m((x) => x.taxaGancho) },
  { chave: "thruplays", rotulo: "ThruPlays", curto: "ThruPlays", formato: "inteiro", melhor: "maior", grupo: "video",
    descricao: "Reproduções até o fim, ou por 15 segundos nos vídeos mais longos.", valor: m((x) => x.thruplays) },
  { chave: "taxaRetencao", rotulo: "Taxa de retenção", curto: "Retenção", formato: "porcento", melhor: "maior", grupo: "video",
    descricao: "ThruPlays ÷ reproduções de 3 s: de quem começou, quantos foram até o fim.", valor: m((x) => x.taxaRetencao) },
  { chave: "custoThruplay", rotulo: "Custo por ThruPlay", curto: "Custo/ThruPlay", formato: "moeda", melhor: "menor", grupo: "video",
    descricao: "Investido ÷ ThruPlays.", valor: m((x) => x.custoThruplay) },
  { chave: "videoP25", rotulo: "Assistiram 25%", curto: "25%", formato: "inteiro", melhor: "maior", grupo: "video",
    descricao: "Reproduções que chegaram a um quarto do vídeo.", valor: m((x) => x.videoP25) },
  { chave: "videoP50", rotulo: "Assistiram 50%", curto: "50%", formato: "inteiro", melhor: "maior", grupo: "video",
    descricao: "Reproduções que chegaram à metade.", valor: m((x) => x.videoP50) },
  { chave: "videoP75", rotulo: "Assistiram 75%", curto: "75%", formato: "inteiro", melhor: "maior", grupo: "video",
    descricao: "Reproduções que chegaram a três quartos.", valor: m((x) => x.videoP75) },
  { chave: "videoP95", rotulo: "Assistiram 95%", curto: "95%", formato: "inteiro", melhor: "maior", grupo: "video",
    descricao: "Reproduções que chegaram a 95%.", valor: m((x) => x.videoP95) },
  { chave: "videoP100", rotulo: "Assistiram até o fim", curto: "100%", formato: "inteiro", melhor: "maior", grupo: "video",
    descricao: "Reproduções completas.", valor: m((x) => x.videoP100) },
  { chave: "tempoMedioVideo", rotulo: "Tempo médio assistido", curto: "Tempo médio", formato: "segundos", melhor: "maior", grupo: "video",
    descricao: "Quanto tempo, em média, cada reprodução durou.", valor: m((x) => x.tempoMedioVideo) },

  // ── Engajamento ──
  { chave: "engajamentos", rotulo: "Engajamentos com o post", curto: "Engajamentos", formato: "inteiro", melhor: "maior", grupo: "engajamento",
    descricao: "Toda interação com o post: reação, comentário, compartilhamento, clique, reprodução.", valor: m((x) => x.engajamentos) },
  { chave: "reacoes", rotulo: "Reações", curto: "Reações", formato: "inteiro", melhor: "maior", grupo: "engajamento",
    descricao: "Curtidas e demais reações.", valor: m((x) => x.reacoes) },
  { chave: "comentarios", rotulo: "Comentários", curto: "Comentários", formato: "inteiro", melhor: "maior", grupo: "engajamento",
    descricao: "Comentários no post do anúncio.", valor: m((x) => x.comentarios) },
  { chave: "compartilhamentos", rotulo: "Compartilhamentos", curto: "Compart.", formato: "inteiro", melhor: "maior", grupo: "engajamento",
    descricao: "Vezes que o post foi compartilhado.", valor: m((x) => x.compartilhamentos) },
  { chave: "salvamentos", rotulo: "Salvamentos", curto: "Salvos", formato: "inteiro", melhor: "maior", grupo: "engajamento",
    descricao: "Vezes que alguém salvou o post para ver depois.", valor: m((x) => x.salvamentos) },
  { chave: "visitasPerfil", rotulo: "Visitas ao perfil do Instagram", curto: "Visitas perfil", formato: "inteiro", melhor: "maior", grupo: "engajamento",
    descricao: "Vezes que alguém foi do anúncio ao perfil.", valor: m((x) => x.visitasPerfil) },
];

const PELA_CHAVE = new Map(METRICAS.map((d) => [d.chave, d]));

export function metrica(chave: string): DefMetrica {
  const d = PELA_CHAVE.get(chave);
  if (!d) throw new Error(`Métrica desconhecida: ${chave}`);
  return d;
}

export const GRUPOS: Array<{ id: GrupoMetrica; rotulo: string }> = [
  { id: "resultado", rotulo: "Resultado na Meta" },
  { id: "crm", rotulo: "Resultado no CRM" },
  { id: "entrega", rotulo: "Entrega" },
  { id: "cliques", rotulo: "Cliques" },
  { id: "video", rotulo: "Vídeo" },
  { id: "engajamento", rotulo: "Engajamento" },
];

/** As colunas da tabela, por visão. A primeira é a padrão. */
export const VISOES: Array<{ id: string; rotulo: string; colunas: string[] }> = [
  { id: "desempenho", rotulo: "Desempenho", colunas: ["gasto", "leads", "custoPorLead", "leadsCrm", "custoLeadCrm", "oportunidades", "ganhas"] },
  { id: "funil", rotulo: "Funil do CRM", colunas: ["leadsCrm", "aproveitamento", "oportunidades", "custoOportunidade", "avancaram", "ganhas", "valorGanho", "retorno"] },
  { id: "entrega", rotulo: "Entrega", colunas: ["gasto", "impressoes", "alcance", "frequencia", "cpm", "cpp", "resultados", "custoResultado"] },
  { id: "cliques", rotulo: "Cliques", colunas: ["cliquesLink", "ctrLink", "cpcLink", "visualizacoesPagina", "custoVisualizacaoPagina", "taxaCarregamento", "cliques", "ctr"] },
  { id: "video", rotulo: "Vídeo", colunas: ["video3s", "taxaGancho", "thruplays", "taxaRetencao", "custoThruplay", "videoP25", "videoP50", "videoP100", "tempoMedioVideo"] },
  { id: "engajamento", rotulo: "Engajamento", colunas: ["engajamentos", "reacoes", "comentarios", "compartilhamentos", "salvamentos", "visitasPerfil", "conversas", "custoPorConversa"] },
];

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const moedas = new Map<string, Intl.NumberFormat>();
function moeda(v: number, codigo: string) {
  let f = moedas.get(codigo);
  if (!f) { f = new Intl.NumberFormat("pt-BR", { style: "currency", currency: codigo }); moedas.set(codigo, f); }
  return f.format(v);
}

/** O valor como a tela escreve. null vira "—": sem denominador não há o que mostrar. */
export function formatarMetrica(valor: number | null, formato: FormatoMetrica, moedaDaConta: string): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  switch (formato) {
    case "moeda": return moeda(valor, moedaDaConta);
    case "real": return moeda(valor, "BRL");
    case "inteiro": return inteiro.format(valor);
    case "porcento": return `${decimal.format(valor)}%`;
    case "decimal": return decimal.format(valor);
    case "multiplo": return `${decimal.format(valor)}×`;
    case "segundos": return `${inteiro.format(valor)} s`;
  }
}

/** Variação em % de um período para o outro; null quando não há base (anterior zero ou ausente). */
export function variacao(atual: number | null, anterior: number | null | undefined): number | null {
  if (atual === null || anterior === null || anterior === undefined || anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

/**
 * Gastou, gerou lead ou trouxe gente ao CRM no período. As listas mostram só
 * estes; os outros ficam atrás de um clique (ou da busca).
 */
export function teveResultado(l: LinhaMetricas) {
  return l.metricas.gasto > 0 || l.metricas.leads > 0 || (l.crm?.leads ?? 0) > 0 || (l.crm?.oportunidades ?? 0) > 0;
}

/** O CSV com todas as métricas do catálogo, uma coluna por métrica. */
export function linhasCsv<T extends LinhaMetricas & { id: string; name: string }>(
  linhas: T[],
  ctx: ContextoMetrica,
  extras: (l: T) => Array<string | number | null> = () => [],
  cabecalhosExtras: string[] = [],
): Array<Array<string | number | null>> {
  const cabecalho = ["ID", "Nome", ...cabecalhosExtras, ...METRICAS.map((d) => d.rotulo)];
  return [cabecalho, ...linhas.map((l) => [l.id, l.name, ...extras(l), ...METRICAS.map((d) => {
    const v = d.valor(l, ctx);
    return v === null ? null : Math.round(v * 100) / 100;
  })])];
}