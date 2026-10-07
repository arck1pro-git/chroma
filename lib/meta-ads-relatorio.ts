import "server-only";
import { z } from "zod";
import { sql } from "./db";
import { contasDeAnuncios, ErroMeta, listarGuardado, MINUTO, permissoesMeta, type Validade } from "./meta";
import {
  leadsPor, metricasAds, origemDaOportunidade, resolverOrigem, resumoCrm, situacaoDosLeads,
  type EntradaCrm, type OportunidadeAds,
} from "./meta-ads-calculos";
import type { CrmAds, DetalheCampanhaAds, DiaAds, DiaCampanhaAds, InsightAds, LinhaAds, ObjetoAds, RelatorioAds } from "./meta-ads-tipos";

// O relatório de Meta Ads: o que a Meta conta (investimento, cliques, leads) ao
// lado do que chegou ao CRM, por campanha e por dia.
//
// O QUE A TELA ABRE PEDINDO (2026-10-07): só três leituras da Meta — a lista de
// campanhas, os insights por campanha e os insights por dia — em paralelo com
// as duas consultas do CRM. Conjuntos, anúncios e os insights deles saíram
// daqui para a gaveta (carregarDetalheCampanha): eram as leituras mais lentas
// (até 2,3 s cada) e só aparecem quando alguém abre uma campanha.
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

// OS MESMOS campos no relatório e na gaveta: a mesma chave no cache, então
// abrir uma campanha não busca a lista de novo.
const CAMPOS_CAMPANHA = "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time";
const CAMPOS_INSIGHT = "campaign_id,adset_id,ad_id,spend,impressions,reach,clicks,frequency,actions,action_values";

const intervalo = (q: { inicio: string; fim: string }) => ({ time_range: JSON.stringify({ since: q.inicio, until: q.fim }), limit: "100" });

function campanhasDaConta(conta: string, forcar: boolean) {
  return listarGuardado<ObjetoAds>(`${conta}/campaigns`, { fields: CAMPOS_CAMPANHA, limit: "100" }, VALIDADE_INSIGHTS, forcar);
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

async function crmDoPeriodo(q: { inicio: string; fim: string; funil?: string; etapa?: string }, acesso: EscopoCrmAds, fuso: string) {
  const [oportunidades, entradas, etapa] = await Promise.all([
    oportunidadesDoPeriodo(q, acesso, fuso),
    entradasDoPeriodo(q, acesso, fuso),
    q.etapa ? sql`SELECT funil_id, ordem FROM etapas WHERE id = ${q.etapa}::uuid` : Promise.resolve([]),
  ]);
  const alvo = etapa[0] as { funil_id: string; ordem: number } | undefined;
  if (q.etapa && (!alvo || (q.funil && alvo.funil_id !== q.funil))) throw new ErroMeta("Etapa inválida para o funil selecionado.", undefined, 400);
  return { oportunidades, entradas, alvo };
}

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
  const [permissoes, campanhas, insights, porDia, crm] = await Promise.all([
    permissoesMeta(),
    campanhasDaConta(q.conta, forcar),
    listarGuardado<InsightAds>(`${q.conta}/insights`, { ...intervalo(q), level: "campaign", fields: CAMPOS_INSIGHT }, VALIDADE_INSIGHTS, forcar),
    listarGuardado<InsightAds>(`${q.conta}/insights`, { ...intervalo(q), fields: "date_start,spend,clicks,actions", time_increment: "1" }, VALIDADE_INSIGHTS, forcar),
    acesso.permitido ? crmDoPeriodo(q, acesso, conta.timezone_name) : null,
  ]);

  const avisos: string[] = [];
  if (!acesso.permitido) avisos.push("Seu acesso não permite consultar os resultados do funil. As métricas da Meta continuam disponíveis.");
  if (acesso.dono) avisos.push("O CRM considera apenas suas oportunidades; o investimento corresponde à conta inteira.");
  if (conta.currency !== "BRL") avisos.push("Valores do CRM em BRL. Retorno e custos que misturam moedas não são calculados.");

  const campanhaDe = (x: { campos: OportunidadeAds["campos"]; contato_campos: OportunidadeAds["contato_campos"] }) =>
    resolverOrigem(origemDaOportunidade(x), campanhas.valor, "campaign").id;
  const leads = crm ? leadsPor(crm.entradas, campanhaDe) : new Map<string, Map<string, string>>();
  const opsPorCampanha = crm ? agruparPor<OportunidadeAds>(crm.oportunidades, campanhaDe) : new Map<string, OportunidadeAds[]>();

  const linhas: LinhaAds[] = campanhas.valor.map(c => ({
    ...c, nivel: "campaign",
    metricas: metricasAds(insights.valor.find(i => i.campaign_id === c.id)),
    crm: crm ? crmDe(opsPorCampanha.get(c.id) ?? [], leads.get(c.id)?.size ?? 0, crm.alvo) : null,
  }));

  // O dia de cada lead do CRM é o da primeira entrada dele atribuída a alguma
  // campanha desta conta — a mesma pessoa em duas campanhas é um ponto só.
  const primeiroDia = new Map<string, string>();
  for (const contatos of leads.values()) {
    for (const [contato, dia] of contatos) {
      const atual = primeiroDia.get(contato);
      if (!atual || dia < atual) primeiroDia.set(contato, dia);
    }
  }
  const diario = new Map<string, DiaAds>(diasDoPeriodo(q).map(dia => [dia, { dia, gasto: 0, leadsMeta: 0, leadsCrm: 0 }]));
  for (const i of porDia.valor) {
    const d = i.date_start ? diario.get(i.date_start) : undefined;
    if (!d) continue;
    const m = metricasAds(i);
    d.gasto += m.gasto; d.leadsMeta += m.leads;
  }
  for (const dia of primeiroDia.values()) { const d = diario.get(dia); if (d) d.leadsCrm++; }

  const soma = (f: (l: LinhaAds) => number) => linhas.reduce((t, l) => t + f(l), 0);
  return {
    conta, periodo: { inicio: q.inicio, fim: q.fim }, permissoes, campanhas: linhas,
    total: {
      gasto: soma(l => l.metricas.gasto), cliques: soma(l => l.metricas.cliques),
      impressoes: soma(l => l.metricas.impressoes), leadsMeta: soma(l => l.metricas.leads),
      crm: crm ? crmDe([...opsPorCampanha.values()].flat(), primeiroDia.size, crm.alvo) : null,
    },
    diario: [...diario.values()],
    leadsCrm: crm ? situacaoDosLeads(crm.entradas, campanhas.valor) : null,
    atualizadoEm: new Date(Math.min(campanhas.em, insights.em, porDia.em)).toISOString(),
    avisos,
  };
}

// ── A gaveta de uma campanha ────────────────────────────────────────────────
//
// Série por dia, conjuntos e anúncios de UMA campanha — só quando a gaveta
// abre, e guardado como o resto.
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
    listarGuardado<ObjetoAds>(`${q.conta}/ads`, { fields: "id,name,status,effective_status,campaign_id,adset_id,creative{id,name,title,body,thumbnail_url,image_url,object_story_id}", filtering: daCampanha, limit: "100" }, VALIDADE_INSIGHTS, forcar),
    listarGuardado<InsightAds>(`${q.conta}/insights`, { ...intervalo(q), level: "adset", filtering: daCampanha, fields: CAMPOS_INSIGHT }, VALIDADE_INSIGHTS, forcar),
    listarGuardado<InsightAds>(`${q.conta}/insights`, { ...intervalo(q), level: "ad", filtering: daCampanha, fields: CAMPOS_INSIGHT }, VALIDADE_INSIGHTS, forcar),
    acesso.permitido ? crmDoPeriodo(q, acesso, conta.timezone_name) : null,
  ]);
  const campanha = campanhas.valor.find(c => c.id === q.campanha);
  if (!campanha) throw new ErroMeta("Campanha não encontrada nesta conta.", undefined, 404);

  // Do CRM, só o que é desta campanha; dentro dela, conjunto e anúncio.
  type ComOrigem = { campos: OportunidadeAds["campos"]; contato_campos: OportunidadeAds["contato_campos"] };
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
