import "server-only";
import { z } from "zod";
import { sql } from "./db";
import { contasDeAnuncios, ErroMeta, lembrar, listarGuardado, MINUTO, permissoesMeta, type Validade } from "./meta";
import {
  anuncioDaOrigem, leadsPor, metricasAds, origemDaOportunidade, pecaDoAnuncio, resolverOrigem, resumoCrm,
  situacaoDosLeads, somarMetricas, textosDoCriativo,
  type EntradaCrm, type OportunidadeAds,
} from "./meta-ads-calculos";
import type {
  AnuncioDaPecaAds, CriativoAds, CriativosAds, CrmAds, DetalheCampanhaAds, DiaAds, DiaCampanhaAds, InsightAds, LinhaAds,
  ObjetoAds, PeriodoAnteriorAds, RelatorioAds,
} from "./meta-ads-tipos";

// O relatório de Meta Ads: o que a Meta conta (investimento, cliques, leads) ao
// lado do que chegou ao CRM, por campanha, por dia e por criativo.
//
// O QUE A TELA ABRE PEDINDO (2026-10-07, ampliado em 2026-10-23): a lista de
// campanhas e os insights por campanha, por dia e da conta — no período e no
// anterior —, em paralelo com as consultas do CRM. Conjuntos, anúncios e os
// insights deles ficam fora: a gaveta de uma campanha (carregarDetalheCampanha)
// e o ranking de criativos (carregarCriativosAds) pedem à parte — a gaveta
// quando abre, os criativos logo depois do relatório (o pódio da visão geral
// precisa deles), reaproveitando o CRM que ele acabou de ler (crmDoPeriodo).
//
// TODAS AS MÉTRICAS DO GERENCIADOR (2026-10-23): os campos pedidos à Meta são os
// que metricasAds lê (CAMPOS_METRICAS). Os diagnósticos de qualidade só existem
// por anúncio, e só a leitura por anúncio os pede.
//
// O TOTAL É A LEITURA DA CONTA (2026-10-23), não a soma das campanhas: alcance e
// frequência só a Meta deduplica — quem viu duas campanhas é uma pessoa só.
// `total.gasto`, `cliques`, `impressoes` e `leadsMeta` seguem a soma das
// campanhas, como antes — e só batem com a conta quando toda campanha que gastou
// está na lista de /campaigns (arquivada não está).
//
// O PERÍODO ANTERIOR (2026-10-23) é o do mesmo tamanho que termina na véspera do
// início, a base das setas de variação: a leitura da conta e o CRM dele,
// atribuído pela lista de campanhas de AGORA. Se só ele falhar (Meta ou banco),
// sai `anterior: null` com o erro no log, e a tela abre sem as setas.
//
// "LEAD NO CRM" É PESSOA, contada uma vez: o contato que nasceu no período, ou
// o contato antigo que voltou com uma oportunidade nova. A origem é a da
// oportunidade, quando ela tem campanha, e a do contato na falta dela — o
// mesmo critério do filtro de campanhas do Dashboard.

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Data inválida.");
const janela = z.object({ conta: z.string().regex(/^act_\d+$/), inicio: data, fim: data,
  funil: z.string().uuid().optional(), etapa: z.string().uuid().optional(),
  // "1" = o botão Atualizar: ignora o que está guardado e vai à Meta.
  atualizar: z.literal("1").optional(),
});
const periodoValido = (v: { inicio: string; fim: string }) => v.fim >= v.inicio && (Date.parse(v.fim) - Date.parse(v.inicio)) / 86400000 <= 365;
const periodoInvalido = "Escolha um período de até 366 dias, em ordem crescente.";
export const consultaAds = janela.refine(periodoValido, periodoInvalido);
// A gaveta de uma campanha usa a MESMA janela do painel — conta, período e
// filtro de funil — e só acrescenta qual campanha abrir.
export const serieAds = janela.extend({ campanha: z.string().regex(/^\d+$/, "Campanha inválida.") }).refine(periodoValido, periodoInvalido);
export type ConsultaAds = z.infer<typeof consultaAds>;
export type SerieConsultaAds = z.infer<typeof serieAds>;
export type EscopoCrmAds = { permitido: boolean; dono: string | null };

// A Meta recalcula os insights de tempos em tempos, e o número de agora há
// pouco serve: 5 minutos fresco, e até 30 a tela abre com o guardado enquanto
// busca o novo por trás (ver `lembrar` em lib/meta.ts).
const VALIDADE_INSIGHTS: Validade = { fresco: 5 * MINUTO, velho: 30 * MINUTO };

// OS MESMOS campos no relatório, na gaveta e nos criativos: a mesma chave no
// cache, então abrir uma campanha não busca a lista de novo.
const CAMPOS_CAMPANHA = "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time";
// O que metricasAds lê (lib/meta-ads-calculos.ts). Sem ids: serve também à leitura da conta.
const CAMPOS_METRICAS = [
  "spend", "impressions", "reach", "frequency", "clicks", "unique_clicks", "inline_link_clicks", "outbound_clicks",
  "actions", "action_values", "results",
  "video_thruplay_watched_actions", "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions",
  "video_p95_watched_actions", "video_p100_watched_actions", "video_avg_time_watched_actions",
  "instagram_profile_visits",
].join(",");
const CAMPOS_INSIGHT = `campaign_id,adset_id,ad_id,${CAMPOS_METRICAS}`;
// Por anúncio: os diagnósticos de qualidade e o nome (o do anúncio que a lista de anúncios não devolve mais).
const CAMPOS_INSIGHT_ANUNCIO = `${CAMPOS_INSIGHT},ad_name,quality_ranking,engagement_rate_ranking,conversion_rate_ranking`;
// O criativo com a miniatura em 480 px: a padrão da Meta é 64 px, borrada num
// cartão. O criativo dinâmico não traz vídeo, imagem, texto nem título no topo:
// vêm do asset_feed_spec, e o object_story_spec é a última fonte (pecaDoAnuncio
// e textosDoCriativo em lib/meta-ads-calculos.ts).
const CAMPOS_CRIATIVO = `creative.thumbnail_width(480).thumbnail_height(480){${[
  "id", "name", "title", "body", "thumbnail_url", "image_url", "object_story_id", "video_id", "image_hash", "object_type",
  "instagram_permalink_url",
  "asset_feed_spec{images{hash},videos{video_id},bodies{text},titles{text}}",
  "object_story_spec{link_data{image_hash,message,name,child_attachments{name}},video_data{video_id,message,title}}",
].join(",")}}`;

const intervalo = (q: { inicio: string; fim: string }) => ({ time_range: JSON.stringify({ since: q.inicio, until: q.fim }), limit: "100" });

function campanhasDaConta(conta: string, forcar: boolean) {
  return listarGuardado<ObjetoAds>(`${conta}/campaigns`, { fields: CAMPOS_CAMPANHA, limit: "100" }, VALIDADE_INSIGHTS, forcar);
}

/** A conta inteira no período, numa linha só: alcance e frequência já deduplicados pela Meta. */
function insightsDaConta(conta: string, periodo: { inicio: string; fim: string }, forcar: boolean) {
  return listarGuardado<InsightAds>(`${conta}/insights`, { ...intervalo(periodo), fields: CAMPOS_METRICAS }, VALIDADE_INSIGHTS, forcar);
}

const DIA = 86_400_000;
const diaIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** O período do mesmo tamanho que termina na véspera do início: 01 a 03/04 → 29 a 31/03. */
function periodoAnterior(q: { inicio: string; fim: string }) {
  const inicio = Date.parse(q.inicio), dias = (Date.parse(q.fim) - inicio) / DIA + 1;
  return { inicio: diaIso(inicio - dias * DIA), fim: diaIso(inicio - DIA) };
}

// ── CRM ─────────────────────────────────────────────────────────────────────

const inicioDoPeriodo = (q: { inicio: string }, fuso: string) => sql`(${q.inicio}::date::timestamp AT TIME ZONE ${fuso})`;
const fimDoPeriodo = (q: { fim: string }, fuso: string) => sql`((${q.fim}::date + 1)::timestamp AT TIME ZONE ${fuso})`;

// Oportunidades criadas no período, já com o dia no fuso da conta de anúncios:
// é esse recorte que faz o CRM cair no mesmo eixo dos insights da Meta.
async function oportunidadesDoPeriodo(q: { inicio: string; fim: string; funil?: string }, acesso: EscopoCrmAds, fuso: string) {
  const linhas = await sql`SELECT o.id, o.contato_id, o.status, o.valor::float8 AS valor, o.etapa_id, o.funil_id,
      o.campos, c.campos AS contato_campos, e.nome AS etapa_nome, e.ordem AS etapa_ordem, f.nome AS funil_nome,
      to_char(o.data_criacao AT TIME ZONE ${fuso}, 'YYYY-MM-DD') AS dia,
      (SELECT min(e2.ordem) FROM etapas e2 WHERE e2.funil_id=o.funil_id) AS primeira_ordem
    FROM oportunidades o JOIN contatos c ON c.id=o.contato_id JOIN etapas e ON e.id=o.etapa_id JOIN funis f ON f.id=o.funil_id
    WHERE o.data_criacao >= ${inicioDoPeriodo(q, fuso)}
      AND o.data_criacao < ${fimDoPeriodo(q, fuso)}
      AND (${acesso.dono}::uuid IS NULL OR o.responsavel_id=${acesso.dono}::uuid)
      AND (${q.funil ?? null}::uuid IS NULL OR o.funil_id=${q.funil ?? null}::uuid)`;
  return linhas as unknown as Array<OportunidadeAds & { dia: string }>;
}

// As ENTRADAS no CRM do período, em ordem de chegada: cada contato que nasceu e
// cada oportunidade nova. É delas que sai "leads no CRM".
//
// O contato só entra para quem vê o CRM inteiro e sem filtro de funil: contato
// não tem dono nem funil, e com escopo "próprio" o que é da pessoa é a
// oportunidade.
async function entradasDoPeriodo(q: { inicio: string; fim: string; funil?: string }, acesso: EscopoCrmAds, fuso: string) {
  const comContatos = !acesso.dono && !q.funil;
  const linhas = await sql`
    SELECT x.contato_id, x.campos, x.contato_campos, to_char(x.em AT TIME ZONE ${fuso}, 'YYYY-MM-DD') AS dia
      FROM (
        SELECT c.id AS contato_id, NULL::jsonb AS campos, c.campos AS contato_campos, c.data_criacao AS em
          FROM contatos c
         WHERE ${comContatos}::boolean
           AND c.data_criacao >= ${inicioDoPeriodo(q, fuso)}
           AND c.data_criacao < ${fimDoPeriodo(q, fuso)}
        UNION ALL
        SELECT o.contato_id, o.campos, c.campos, o.data_criacao
          FROM oportunidades o JOIN contatos c ON c.id = o.contato_id
         WHERE o.data_criacao >= ${inicioDoPeriodo(q, fuso)}
           AND o.data_criacao < ${fimDoPeriodo(q, fuso)}
           AND (${acesso.dono}::uuid IS NULL OR o.responsavel_id = ${acesso.dono}::uuid)
           AND (${q.funil ?? null}::uuid IS NULL OR o.funil_id = ${q.funil ?? null}::uuid)
      ) x
     ORDER BY x.em`;
  return linhas as unknown as EntradaCrm[];
}

// O CRM do período GUARDADO POR UM MINUTO (revisão de 2026-10-23): a tela abre
// o relatório e, logo depois, os criativos, e os dois liam as mesmas linhas.
// `entradasDoPeriodo` traz todo contato criado na janela — e uma importação
// (a do SprintHub foi um dia com milhares de contatos) cabe inteira numa janela
// de 30 ou 90 dias. Um minuto de atraso num lead que acabou de entrar não muda
// a leitura de uma campanha; ler duas vezes a mesma base, sim. `forcar` é o
// Atualizar do relatório.
const VALIDADE_CRM: Validade = { fresco: MINUTO, velho: MINUTO };
function crmDoPeriodo(q: { inicio: string; fim: string; funil?: string; etapa?: string }, acesso: EscopoCrmAds, fuso: string, forcar = false) {
  const chave = `crm-ads:${q.inicio}:${q.fim}:${q.funil ?? ""}:${q.etapa ?? ""}:${acesso.dono ?? ""}:${fuso}`;
  return lembrar(chave, VALIDADE_CRM, () => lerCrmDoPeriodo(q, acesso, fuso), forcar).then(r => r.valor);
}

async function lerCrmDoPeriodo(q: { inicio: string; fim: string; funil?: string; etapa?: string }, acesso: EscopoCrmAds, fuso: string) {
  const [oportunidades, entradas, etapa] = await Promise.all([
    oportunidadesDoPeriodo(q, acesso, fuso),
    entradasDoPeriodo(q, acesso, fuso),
    q.etapa ? sql`SELECT funil_id, ordem FROM etapas WHERE id = ${q.etapa}::uuid` : Promise.resolve([]),
  ]);
  const alvo = etapa[0] as { funil_id: string; ordem: number } | undefined;
  if (q.etapa && (!alvo || (q.funil && alvo.funil_id !== q.funil))) throw new ErroMeta("Etapa inválida para o funil selecionado.", undefined, 400);
  return { oportunidades, entradas, alvo };
}
type CrmDoPeriodo = Awaited<ReturnType<typeof lerCrmDoPeriodo>>;
type ComOrigem = { campos: OportunidadeAds["campos"]; contato_campos: OportunidadeAds["contato_campos"] };

/** O resumo do CRM de um objeto: as oportunidades dele, com `leads` contado pelas entradas. */
function crmDe(oportunidades: OportunidadeAds[], leads: number, alvo?: { funil_id: string; ordem: number }): CrmAds {
  return { ...resumoCrm(oportunidades, alvo), leads };
}

function agruparPor<T>(itens: T[], chave: (item: T) => string | null) {
  const mapa = new Map<string, T[]>();
  for (const item of itens) {
    const k = chave(item);
    if (k) mapa.set(k, [...(mapa.get(k) ?? []), item]);
  }
  return mapa;
}

/**
 * O CRM do período distribuído pelo que `resolver` disser de cada entrada e
 * oportunidade (a campanha, a peça). `de(id)` é o resumo de um objeto; `total`,
 * o de todos juntos, com a pessoa que veio por dois objetos contada uma vez, no
 * dia da primeira entrada atribuída (`primeiroDia`).
 */
function atribuirCrm(crm: CrmDoPeriodo, resolver: (x: ComOrigem) => string | null) {
  const leads = leadsPor(crm.entradas, resolver);
  const ops = agruparPor<OportunidadeAds>(crm.oportunidades, resolver);
  const primeiroDia = new Map<string, string>();
  for (const contatos of leads.values()) {
    for (const [contato, dia] of contatos) {
      const atual = primeiroDia.get(contato);
      if (!atual || dia < atual) primeiroDia.set(contato, dia);
    }
  }
  return {
    de: (id: string) => crmDe(ops.get(id) ?? [], leads.get(id)?.size ?? 0, crm.alvo),
    total: crmDe([...ops.values()].flat(), primeiroDia.size, crm.alvo),
    primeiroDia,
  };
}

/** Todos os dias do período, inclusive os sem veiculação: num gráfico de linha, dia ausente vira reta e mente sobre a pausa. */
function diasDoPeriodo(q: { inicio: string; fim: string }) {
  const dias: string[] = [];
  for (const d = new Date(`${q.inicio}T12:00:00Z`); d.toISOString().slice(0, 10) <= q.fim; d.setUTCDate(d.getUTCDate() + 1)) dias.push(d.toISOString().slice(0, 10));
  return dias;
}

export async function contaAutorizada(conta: string) {
  const encontrada = (await contasDeAnuncios()).find(c => c.id === conta);
  if (!encontrada) throw new ErroMeta("Conta não acessível por esta integração.", undefined, 403);
  return encontrada;
}

// ── O relatório da conta ────────────────────────────────────────────────────

export async function carregarRelatorioAds(q: ConsultaAds, acesso: EscopoCrmAds): Promise<RelatorioAds> {
  const forcar = q.atualizar === "1";
  const conta = await contaAutorizada(q.conta);
  const antes = periodoAnterior(q);
  const [permissoes, campanhas, insights, daConta, porDia, crm, anteriorBruto] = await Promise.all([
    permissoesMeta(),
    campanhasDaConta(q.conta, forcar),
    listarGuardado<InsightAds>(`${q.conta}/insights`, { ...intervalo(q), level: "campaign", fields: CAMPOS_INSIGHT }, VALIDADE_INSIGHTS, forcar),
    insightsDaConta(q.conta, q, forcar),
    listarGuardado<InsightAds>(`${q.conta}/insights`, { ...intervalo(q), fields: "date_start,spend,clicks,impressions,inline_link_clicks,actions", time_increment: "1" }, VALIDADE_INSIGHTS, forcar),
    acesso.permitido ? crmDoPeriodo(q, acesso, conta.timezone_name, forcar) : null,
    // O anterior falha sozinho: sem ele a tela perde as setas, não os números.
    Promise.all([
      insightsDaConta(q.conta, antes, forcar),
      acesso.permitido ? crmDoPeriodo({ ...antes, funil: q.funil, etapa: q.etapa }, acesso, conta.timezone_name) : null,
    ]).catch((e: unknown) => {
      console.error(`[meta-ads] período anterior (${antes.inicio} a ${antes.fim}) não carregou; o relatório segue sem ele:`, e);
      return null;
    }),
  ]);

  const avisos: string[] = [];
  if (!acesso.permitido) avisos.push("Seu acesso não permite consultar os resultados do funil. As métricas da Meta continuam disponíveis.");
  if (acesso.dono) avisos.push("O CRM considera apenas suas oportunidades; o investimento corresponde à conta inteira.");
  if (conta.currency !== "BRL") avisos.push("Valores do CRM em BRL. Retorno e custos que misturam moedas não são calculados.");

  const campanhaDe = (x: ComOrigem) => resolverOrigem(origemDaOportunidade(x), campanhas.valor, "campaign").id;
  const atribuido = crm ? atribuirCrm(crm, campanhaDe) : null;

  const linhas: LinhaAds[] = campanhas.valor.map(c => ({
    ...c, nivel: "campaign",
    metricas: metricasAds(insights.valor.find(i => i.campaign_id === c.id)),
    crm: atribuido ? atribuido.de(c.id) : null,
  }));

  const diario = new Map<string, DiaAds>(diasDoPeriodo(q).map(dia => [dia, { dia, gasto: 0, impressoes: 0, cliquesLink: 0, leadsMeta: 0, leadsCrm: 0 }]));
  for (const i of porDia.valor) {
    const d = i.date_start ? diario.get(i.date_start) : undefined;
    if (!d) continue;
    const m = metricasAds(i);
    d.gasto += m.gasto; d.impressoes += m.impressoes; d.cliquesLink += m.cliquesLink; d.leadsMeta += m.leads;
  }
  // O dia de cada lead do CRM é o da primeira entrada dele atribuída a alguma
  // campanha desta conta — a mesma pessoa em duas campanhas é um ponto só.
  for (const dia of atribuido?.primeiroDia.values() ?? []) { const d = diario.get(dia); if (d) d.leadsCrm++; }

  const anterior: PeriodoAnteriorAds | null = anteriorBruto ? {
    periodo: antes,
    metricas: metricasAds(anteriorBruto[0].valor[0]),
    crm: anteriorBruto[1] ? atribuirCrm(anteriorBruto[1], campanhaDe).total : null,
  } : null;

  const soma = (f: (l: LinhaAds) => number) => linhas.reduce((t, l) => t + f(l), 0);
  return {
    conta, periodo: { inicio: q.inicio, fim: q.fim }, permissoes, campanhas: linhas,
    total: {
      gasto: soma(l => l.metricas.gasto), cliques: soma(l => l.metricas.cliques),
      impressoes: soma(l => l.metricas.impressoes), leadsMeta: soma(l => l.metricas.leads),
      crm: atribuido?.total ?? null,
      metricas: metricasAds(daConta.valor[0]),
    },
    anterior,
    diario: [...diario.values()],
    leadsCrm: crm ? situacaoDosLeads(crm.entradas, campanhas.valor) : null,
    atualizadoEm: new Date(Math.min(campanhas.em, insights.em, daConta.em, porDia.em)).toISOString(),
    avisos,
  };
}

// ── A gaveta de uma campanha ────────────────────────────────────────────────
//
// Série por dia, conjuntos e anúncios de UMA campanha — só quando a gaveta
// abre, e guardado como o resto. Os anúncios trazem o criativo com a miniatura
// de 480 px e os diagnósticos de qualidade (2026-10-23).
//
// O filtro `campaign.id` vai nas leituras da CONTA, e não em /<campanha>/…,
// para que o escopo seja o da conta já autorizada: um id de outra conta volta
// vazio em vez de vazar dados. A lista de campanhas vem inteira porque a
// atribuição precisa dela — é ela que revela nome ambíguo entre duas
// campanhas, o mesmo critério do relatório.
export async function carregarDetalheCampanha(q: SerieConsultaAds, acesso: EscopoCrmAds): Promise<DetalheCampanhaAds> {
  const forcar = q.atualizar === "1";
  const conta = await contaAutorizada(q.conta);
  const daCampanha = JSON.stringify([{ field: "campaign.id", operator: "IN", value: [q.campanha] }]);
  const [campanhas, porDia, conjuntos, anuncios, iConjuntos, iAnuncios, crm] = await Promise.all([
    campanhasDaConta(q.conta, forcar),
    listarGuardado<InsightAds>(`${q.conta}/insights`, { ...intervalo(q), level: "campaign", time_increment: "1", filtering: daCampanha, fields: "campaign_id,date_start,spend,clicks,actions" }, VALIDADE_INSIGHTS, forcar),
    listarGuardado<ObjetoAds>(`${q.conta}/adsets`, { fields: "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,start_time,end_time,targeting", filtering: daCampanha, limit: "100" }, VALIDADE_INSIGHTS, forcar),
    listarGuardado<ObjetoAds>(`${q.conta}/ads`, { fields: `id,name,status,effective_status,campaign_id,adset_id,${CAMPOS_CRIATIVO}`, filtering: daCampanha, limit: "100" }, VALIDADE_INSIGHTS, forcar),
    listarGuardado<InsightAds>(`${q.conta}/insights`, { ...intervalo(q), level: "adset", filtering: daCampanha, fields: CAMPOS_INSIGHT }, VALIDADE_INSIGHTS, forcar),
    listarGuardado<InsightAds>(`${q.conta}/insights`, { ...intervalo(q), level: "ad", filtering: daCampanha, fields: CAMPOS_INSIGHT_ANUNCIO }, VALIDADE_INSIGHTS, forcar),
    acesso.permitido ? crmDoPeriodo(q, acesso, conta.timezone_name) : null,
  ]);
  const campanha = campanhas.valor.find(c => c.id === q.campanha);
  if (!campanha) throw new ErroMeta("Campanha não encontrada nesta conta.", undefined, 404);

  // Do CRM, só o que é desta campanha; dentro dela, conjunto e anúncio.
  const desta = (x: ComOrigem) => resolverOrigem(origemDaOportunidade(x), campanhas.valor, "campaign").id === q.campanha;
  const conjuntoDe = (x: ComOrigem) => resolverOrigem(origemDaOportunidade(x), conjuntos.valor, "adset").id;
  const anuncioDe = (x: ComOrigem) => {
    const j = conjuntoDe(x);
    return j ? resolverOrigem(origemDaOportunidade(x), anuncios.valor.filter(a => a.adset_id === j), "ad").id : null;
  };
  const entradas = crm ? crm.entradas.filter(desta) : [];
  const ops = crm ? crm.oportunidades.filter(desta) : [];

  const linhas = (objetos: ObjetoAds[], insights: InsightAds[], nivel: "adset" | "ad", resolver: (x: ComOrigem) => string | null): LinhaAds[] => {
    const leads = leadsPor(entradas, resolver), porObjeto = agruparPor<OportunidadeAds>(ops, resolver);
    return objetos.map(o => ({
      ...o, nivel, metricas: metricasAds(insights.find(i => i[`${nivel}_id`] === o.id)),
      crm: crm ? crmDe(porObjeto.get(o.id) ?? [], leads.get(o.id)?.size ?? 0, crm.alvo) : null,
    }));
  };

  const dias = new Map<string, DiaCampanhaAds>(diasDoPeriodo(q).map(dia => [dia, { dia, gasto: 0, cliques: 0, leadsMeta: 0, leadsCrm: 0, oportunidades: 0, ganhas: 0, valorGanho: 0 }]));
  for (const i of porDia.valor) {
    const d = i.date_start ? dias.get(i.date_start) : undefined;
    if (!d) continue;
    const m = metricasAds(i);
    d.gasto += m.gasto; d.cliques += m.cliques; d.leadsMeta += m.leads;
  }
  for (const dia of (leadsPor(entradas, () => q.campanha).get(q.campanha) ?? new Map()).values()) {
    const d = dias.get(dia); if (d) d.leadsCrm++;
  }
  for (const o of ops as Array<OportunidadeAds & { dia: string }>) {
    const d = dias.get(o.dia); if (!d) continue;
    d.oportunidades++;
    if (o.status === "ganha") { d.ganhas++; d.valorGanho += Number(o.valor) || 0; }
  }

  return {
    campanha: { id: campanha.id, nome: campanha.name }, crm: Boolean(crm),
    dias: [...dias.values()],
    conjuntos: linhas(conjuntos.valor, iConjuntos.valor, "adset", conjuntoDe),
    anuncios: linhas(anuncios.valor, iAnuncios.valor, "ad", anuncioDe),
    atualizadoEm: new Date(Math.min(campanhas.em, porDia.em, conjuntos.em, anuncios.em, iConjuntos.em, iAnuncios.em)).toISOString(),
  };
}

// ── Os criativos da conta ───────────────────────────────────────────────────
//
// O ranking de criativos (2026-10-23) é por PEÇA: o mesmo vídeo em três
// campanhas são três anúncios e um criativo (pecaDoAnuncio). A base são os
// insights por anúncio da conta inteira, então só entra o que veiculou no
// período; os anúncios são buscados depois, por id, só pelo criativo — a lista
// de anúncios da conta traz os que nunca rodaram e os de anos atrás. Lotes de
// 50 ids, em ordem, para o mesmo período dar a mesma chave guardada. Anúncio
// que a Meta não devolve (apagado) entra como peça própria, sem miniatura.
//
// O lead do CRM vai à campanha, ao conjunto dentro dela e ao anúncio dentro do
// conjunto (anuncioDaOrigem), e daí à peça; a pessoa que veio por dois anúncios
// da mesma peça conta uma vez. O anúncio procurado está entre os que
// veicularam: lead de anúncio parado no período não entra em peça nenhuma.
//
// Escopo: tudo pelas leituras da conta já autorizada (`act_X/...`), como na gaveta.

const LOTE_ANUNCIOS = 50;
type AnuncioDaConta = Pick<ObjetoAds, "id" | "name" | "effective_status" | "campaign_id" | "adset_id" | "creative">;
type ConjuntoDaConta = Pick<ObjetoAds, "id" | "name" | "campaign_id">;

export async function carregarCriativosAds(q: ConsultaAds, acesso: EscopoCrmAds): Promise<CriativosAds> {
  const forcar = q.atualizar === "1";
  const conta = await contaAutorizada(q.conta);
  // As campanhas e o CRM, o relatório acabou de ler (e de forçar, no Atualizar):
  // aqui vêm do guardado.
  const [porAnuncio, campanhas, conjuntos, crm] = await Promise.all([
    listarGuardado<InsightAds>(`${q.conta}/insights`, { ...intervalo(q), level: "ad", fields: CAMPOS_INSIGHT_ANUNCIO }, VALIDADE_INSIGHTS, forcar),
    campanhasDaConta(q.conta, false),
    listarGuardado<ConjuntoDaConta>(`${q.conta}/adsets`, { fields: "id,name,campaign_id", limit: "100" }, VALIDADE_INSIGHTS, forcar),
    acesso.permitido ? crmDoPeriodo(q, acesso, conta.timezone_name) : null,
  ]);

  const ids = [...new Set(porAnuncio.valor.flatMap(i => (i.ad_id ? [i.ad_id] : [])))].sort();
  const lotes = await Promise.all(Array.from({ length: Math.ceil(ids.length / LOTE_ANUNCIOS) }, (_, n) =>
    listarGuardado<AnuncioDaConta>(`${q.conta}/ads`, {
      fields: `id,name,effective_status,campaign_id,adset_id,${CAMPOS_CRIATIVO}`, limit: String(LOTE_ANUNCIOS),
      filtering: JSON.stringify([{ field: "id", operator: "IN", value: ids.slice(n * LOTE_ANUNCIOS, (n + 1) * LOTE_ANUNCIOS) }]),
    }, VALIDADE_INSIGHTS, forcar)));
  const anuncios = new Map(lotes.flatMap(l => l.valor).map(a => [a.id, a]));
  const nomeDaCampanha = new Map(campanhas.valor.map(c => [c.id, c.name]));
  const conjuntoPorId = new Map(conjuntos.valor.map(j => [j.id, j]));

  // Cada anúncio que veiculou, com o que rendeu e a peça a que pertence.
  const veicularam = porAnuncio.valor.flatMap(i => {
    if (!i.ad_id) return [];
    const a = anuncios.get(i.ad_id);
    const campanhaId = a?.campaign_id ?? i.campaign_id ?? "";
    const conjunto = conjuntoPorId.get(a?.adset_id ?? i.adset_id ?? "");
    const anuncio: AnuncioDaPecaAds = {
      id: i.ad_id, nome: a?.name ?? i.ad_name ?? i.ad_id, effective_status: a?.effective_status ?? "UNKNOWN",
      campanha: { id: campanhaId, nome: nomeDaCampanha.get(campanhaId) ?? campanhaId },
      conjunto: conjunto ? { id: conjunto.id, nome: conjunto.name } : null,
      metricas: metricasAds(i),
    };
    return [{ anuncio, criativo: a?.creative, ...pecaDoAnuncio(i.ad_id, a?.creative) }];
  });

  const pecaDoId = new Map(veicularam.map(v => [v.anuncio.id, v.chave]));
  const listaAnuncios = [...anuncios.values()];
  const atribuido = crm ? atribuirCrm(crm, x => {
    const id = anuncioDaOrigem(origemDaOportunidade(x), campanhas.valor, conjuntos.valor, listaAnuncios);
    return id ? pecaDoId.get(id) ?? null : null;
  }) : null;

  const criativos: CriativoAds[] = [...agruparPor(veicularam, v => v.chave)].map(([chave, daPeca]) => {
    const ordenados = [...daPeca].sort((a, b) => b.anuncio.metricas.gasto - a.anuncio.metricas.gasto);
    // A cara da peça é a do anúncio que mais investiu entre os que vieram com criativo.
    const principal = ordenados.find(v => v.criativo) ?? ordenados[0];
    const c = principal.criativo;
    return {
      chave, tipo: principal.tipo, nome: principal.anuncio.nome,
      miniatura: c?.thumbnail_url || c?.image_url || null, ...textosDoCriativo(c),
      instagram: c?.instagram_permalink_url || null,
      ativo: ordenados.some(v => v.anuncio.effective_status === "ACTIVE"),
      anuncios: ordenados.map(v => v.anuncio),
      metricas: somarMetricas(ordenados.map(v => v.anuncio.metricas)),
      crm: atribuido ? atribuido.de(chave) : null,
    };
  }).sort((a, b) => b.metricas.gasto - a.metricas.gasto);

  return {
    periodo: { inicio: q.inicio, fim: q.fim }, crm: Boolean(crm), criativos,
    atualizadoEm: new Date(Math.min(porAnuncio.em, campanhas.em, conjuntos.em, ...lotes.map(l => l.em))).toISOString(),
  };
}
