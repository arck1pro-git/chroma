import "server-only";
import { z } from "zod";
import { sql } from "./db";
import { contasDeAnuncios, ErroMeta, listarMeta, permissoesMeta } from "./meta";
import { metricasAds, origemDaOportunidade, resolverOrigem, resumoCrm, type OportunidadeAds } from "./meta-ads-calculos";
import type { DiaCampanhaAds, InsightAds, LinhaAds, ObjetoAds, RelatorioAds, SerieCampanhaAds } from "./meta-ads-tipos";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Data inválida.");
const janela = z.object({ conta: z.string().regex(/^act_\d+$/), inicio: data, fim: data,
  funil: z.string().uuid().optional(), etapa: z.string().uuid().optional(),
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

// Oportunidades criadas no período, já com o dia no fuso da conta de anúncios:
// é esse recorte que faz o CRM cair no mesmo eixo dos insights da Meta. Usada
// pelo relatório da conta e pela série de uma campanha — uma consulta só, para
// as duas não divergirem no recorte de data, dono e funil.
async function oportunidadesDoPeriodo(q: { inicio: string; fim: string; funil?: string }, acesso: EscopoCrmAds, fuso: string) {
  const linhas = await sql`SELECT o.id, o.contato_id, o.status, o.valor::float8 AS valor, o.etapa_id, o.funil_id,
      o.campos, c.campos AS contato_campos, e.nome AS etapa_nome, e.ordem AS etapa_ordem, f.nome AS funil_nome,
      to_char(o.data_criacao AT TIME ZONE ${fuso}, 'YYYY-MM-DD') AS dia,
      (SELECT min(e2.ordem) FROM etapas e2 WHERE e2.funil_id=o.funil_id) AS primeira_ordem
    FROM oportunidades o JOIN contatos c ON c.id=o.contato_id JOIN etapas e ON e.id=o.etapa_id JOIN funis f ON f.id=o.funil_id
    WHERE o.data_criacao >= (${q.inicio}::date::timestamp AT TIME ZONE ${fuso})
      AND o.data_criacao < ((${q.fim}::date + 1)::timestamp AT TIME ZONE ${fuso})
      AND (${acesso.dono}::uuid IS NULL OR o.responsavel_id=${acesso.dono}::uuid)
      AND (${q.funil ?? null}::uuid IS NULL OR o.funil_id=${q.funil ?? null}::uuid)`;
  return linhas as unknown as Array<OportunidadeAds & { dia: string }>;
}

export async function contaAutorizada(conta: string) {
  const encontrada = (await contasDeAnuncios()).find(c => c.id === conta);
  if (!encontrada) throw new ErroMeta("Conta não acessível por esta integração.", undefined, 403);
  return encontrada;
}

export async function carregarRelatorioAds(q: ConsultaAds, acesso: EscopoCrmAds): Promise<RelatorioAds> {
  const conta = await contaAutorizada(q.conta);
  const params = { time_range: JSON.stringify({ since: q.inicio, until: q.fim }), limit: "100" };
  const campos = "campaign_id,adset_id,ad_id,spend,impressions,reach,clicks,frequency,actions,action_values";
  const [permissoes, campanhas, conjuntos, anuncios, ic, ij, ia, total, dias] = await Promise.all([
    permissoesMeta(),
    listarMeta<ObjetoAds>(`${q.conta}/campaigns`, { fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time", limit: "100" }),
    listarMeta<ObjetoAds>(`${q.conta}/adsets`, { fields: "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,start_time,end_time,targeting", limit: "100" }),
    listarMeta<ObjetoAds>(`${q.conta}/ads`, { fields: "id,name,status,effective_status,campaign_id,adset_id,creative{id,name,title,body,thumbnail_url,image_url,object_story_id}", limit: "100" }),
    listarMeta<InsightAds>(`${q.conta}/insights`, { ...params, level: "campaign", fields: campos }),
    listarMeta<InsightAds>(`${q.conta}/insights`, { ...params, level: "adset", fields: campos }),
    listarMeta<InsightAds>(`${q.conta}/insights`, { ...params, level: "ad", fields: campos }),
    listarMeta<InsightAds>(`${q.conta}/insights`, { ...params, fields: "spend,impressions,reach,clicks,frequency,actions,action_values" }),
    listarMeta<InsightAds>(`${q.conta}/insights`, { ...params, fields: "date_start,spend,clicks,actions", time_increment: "1" }),
  ]);
  let oportunidades: OportunidadeAds[] = [];
  let funis: RelatorioAds["funis"] = [], etapas: RelatorioAds["etapas"] = [];
  const avisos: string[] = [];
  if (acesso.permitido) {
    const [ops, fs, es] = await Promise.all([
      oportunidadesDoPeriodo(q, acesso, conta.timezone_name),
      sql`SELECT id,nome FROM funis ORDER BY nome`,
      sql`SELECT id,nome,funil_id,ordem FROM etapas ORDER BY funil_id,ordem`,
    ]);
    oportunidades = ops; funis = fs as RelatorioAds["funis"]; etapas = es as RelatorioAds["etapas"];
  } else avisos.push("Seu acesso não permite consultar os resultados do funil. As métricas da Meta continuam disponíveis.");
  const alvo = q.etapa ? etapas.find(e => e.id === q.etapa && (!q.funil || e.funil_id === q.funil)) : undefined;
  if (q.etapa && !alvo) throw new ErroMeta("Etapa inválida para o funil selecionado.", undefined, 400);
  if (acesso.dono) avisos.push("O CRM considera apenas suas oportunidades; o investimento corresponde à conta inteira.");
  if (conta.currency !== "BRL") avisos.push("Valores do CRM em BRL. Retorno e custos que misturam moedas não são calculados.");
  const atribuicao = { total: oportunidades.length, atribuidas: 0, semOrigem: 0, semCorrespondencia: 0, ambiguas: 0, semConjunto: 0, semAnuncio: 0 };
  const porCampanha = new Map<string, OportunidadeAds[]>(), porConjunto = new Map<string, OportunidadeAds[]>(), porAnuncio = new Map<string, OportunidadeAds[]>();
  const todas: OportunidadeAds[] = [];
  const adicionar = (mapa: Map<string, OportunidadeAds[]>, id: string, o: OportunidadeAds) => mapa.set(id, [...(mapa.get(id) ?? []), o]);
  for (const o of oportunidades) {
    const origem = origemDaOportunidade(o), c = resolverOrigem(origem, campanhas, "campaign");
    if (!c.id) { atribuicao[c.motivo!]++; continue; }
    atribuicao.atribuidas++; todas.push(o); adicionar(porCampanha, c.id, o);
    const j = resolverOrigem(origem, conjuntos.filter(j => j.campaign_id === c.id), "adset");
    if (!j.id) { atribuicao.semConjunto++; atribuicao.semAnuncio++; continue; }
    adicionar(porConjunto, j.id, o);
    const a = resolverOrigem(origem, anuncios.filter(a => a.adset_id === j.id && a.campaign_id === c.id), "ad");
    if (!a.id) { atribuicao.semAnuncio++; continue; }
    adicionar(porAnuncio, a.id, o);
  }
  const linhas = (objetos: ObjetoAds[], insights: InsightAds[], nivel: LinhaAds["nivel"], mapa: Map<string, OportunidadeAds[]>): LinhaAds[] => objetos.map(o => ({
    ...o, nivel, metricas: metricasAds(insights.find(i => i[`${nivel}_id`] === o.id)),
    crm: acesso.permitido ? resumoCrm(mapa.get(o.id) ?? [], alvo) : null,
  }));
  return { conta, periodo: { inicio: q.inicio, fim: q.fim }, permissoes,
    campanhas: linhas(campanhas, ic, "campaign", porCampanha), conjuntos: linhas(conjuntos, ij, "adset", porConjunto), anuncios: linhas(anuncios, ia, "ad", porAnuncio),
    total: { metricas: metricasAds(total[0]), crm: acesso.permitido ? resumoCrm(todas, alvo) : null },
    diario: dias.map(d => ({ dia: d.date_start!, gasto: metricasAds(d).gasto, leads: metricasAds(d).leads, cliques: metricasAds(d).cliques })),
    atribuicao: acesso.permitido ? atribuicao : null, funis, etapas, avisos,
  };
}

// Série diária de UMA campanha. Duas fontes no mesmo eixo de dias: insights da
// Meta (gasto, cliques, leads) e oportunidades do CRM atribuídas a esta
// campanha. Só roda quando a gaveta abre — por isso pode pagar duas chamadas.
//
// O filtro `campaign.id` vai na consulta da CONTA, e não em /<campanha>/insights,
// para que o escopo seja o da conta já autorizada: um id de outra conta volta
// vazio em vez de vazar dados. A lista de campanhas vem junto porque a
// atribuição precisa dela inteira — é ela que revela nome ambíguo entre duas
// campanhas, o mesmo critério do relatório.
export async function carregarSerieCampanha(q: SerieConsultaAds, acesso: EscopoCrmAds): Promise<SerieCampanhaAds> {
  const conta = await contaAutorizada(q.conta);
  const [campanhas, insights] = await Promise.all([
    listarMeta<ObjetoAds>(`${q.conta}/campaigns`, { fields: "id,name", limit: "100" }),
    listarMeta<InsightAds>(`${q.conta}/insights`, {
      time_range: JSON.stringify({ since: q.inicio, until: q.fim }), level: "campaign", time_increment: "1", limit: "100",
      filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: [q.campanha] }]),
      fields: "campaign_id,date_start,spend,clicks,actions,action_values",
    }),
  ]);
  const campanha = campanhas.find(c => c.id === q.campanha);
  if (!campanha) throw new ErroMeta("Campanha não encontrada nesta conta.", undefined, 404);

  // Todos os dias do período entram na série, inclusive os sem veiculação: num
  // gráfico de linha, dia ausente vira segmento reto e mente sobre a pausa.
  const dias = new Map<string, DiaCampanhaAds>();
  const doDia = (dia: string) => {
    const atual = dias.get(dia) ?? { dia, gasto: 0, cliques: 0, leads: 0, oportunidades: 0, ganhas: 0, valorGanho: 0 };
    dias.set(dia, atual);
    return atual;
  };
  for (const d = new Date(`${q.inicio}T12:00:00Z`); d.toISOString().slice(0, 10) <= q.fim; d.setUTCDate(d.getUTCDate() + 1)) doDia(d.toISOString().slice(0, 10));
  for (const i of insights) {
    if (!i.date_start) continue;
    const m = metricasAds(i), linha = doDia(i.date_start);
    linha.gasto += m.gasto; linha.cliques += m.cliques; linha.leads += m.leads;
  }
  if (acesso.permitido) {
    for (const o of await oportunidadesDoPeriodo(q, acesso, conta.timezone_name)) {
      if (resolverOrigem(origemDaOportunidade(o), campanhas, "campaign").id !== q.campanha) continue;
      const linha = doDia(o.dia);
      linha.oportunidades++;
      if (o.status === "ganha") { linha.ganhas++; linha.valorGanho += Number(o.valor) || 0; }
    }
  }
  return { campanha: { id: campanha.id, nome: campanha.name }, crm: acesso.permitido, dias: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)) };
}
