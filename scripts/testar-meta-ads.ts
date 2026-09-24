import assert from "node:assert/strict";
import { dividir, metricasAds, origemDaOportunidade, resolverOrigem, resumoCrm, type OportunidadeAds } from "../lib/meta-ads-calculos";
import { acaoAds, executarAcaoAds } from "../lib/meta-ads-gestao";
import { carregarSerieCampanha, consultaAds, serieAds } from "../lib/meta-ads-relatorio";
import { listarMeta } from "../lib/meta";
import type { ObjetoAds } from "../lib/meta-ads-tipos";

async function main() {
  const catalogo: ObjetoAds[] = [{ id: "100", name: "Captação", status: "ACTIVE", effective_status: "ACTIVE" }, { id: "101", name: "Captação", status: "PAUSED", effective_status: "PAUSED" }];
  assert.equal(resolverOrigem({ utm_campaign: "Captação" }, catalogo, "campaign").motivo, "ambiguas");
  assert.equal(resolverOrigem({ campaign_id: "100", utm_campaign: "Captação" }, catalogo, "campaign").id, "100");
  assert.equal(resolverOrigem({ campaign_id: "999", utm_campaign: "Captação" }, catalogo, "campaign").motivo, "semCorrespondencia");
  assert.equal(resolverOrigem(null, catalogo, "campaign").motivo, "semOrigem");
  const op: OportunidadeAds = { id: "o1", contato_id: "c1", status: "aberta", valor: 100, etapa_id: "e1", etapa_nome: "Entrada", etapa_ordem: 0, funil_id: "f1", funil_nome: "Vendas", primeira_ordem: 0, campos: { campaign_id: "100" }, contato_campos: { campaign_id: "101", adset_id: "20" } };
  assert.deepEqual(origemDaOportunidade(op), { campaign_id: "100" });
  assert.deepEqual(origemDaOportunidade({ ...op, campos: {} }), op.contato_campos);
  const crm = resumoCrm([op, { ...op, id: "o2", status: "ganha", valor: 300, etapa_id: "e2", etapa_nome: "Proposta", etapa_ordem: 2 }, { ...op, id: "o3", contato_id: "c2", status: "perdida", valor: 500 }]);
  assert.equal(crm.leads, 2); assert.equal(crm.oportunidades, 3); assert.equal(crm.valorGanho, 300); assert.equal(crm.valorAberto, 100); assert.equal(crm.avancaram, 1);
  assert.equal(resumoCrm([op], { funil_id: "outro", ordem: 0 }).avancaram, 0);
  assert.equal(dividir(100, 0), null);
  const m = metricasAds({ spend: "100", clicks: "20", impressions: "1000", actions: [{ action_type: "lead", value: "3" }, { action_type: "onsite_conversion.lead_grouped", value: "3" }] });
  assert.equal(m.leads, 3); assert.equal(m.cpc, 5); assert.equal(m.ctr, 2); assert.equal(metricasAds().cpc, null);
  assert.equal(consultaAds.safeParse({ conta: "act_1", inicio: "2026-02-30", fim: "2026-03-01" }).success, false);
  assert.equal(consultaAds.safeParse({ conta: "act_1", inicio: "2026-04-02", fim: "2026-04-01" }).success, false);
  assert.equal(acaoAds.safeParse({ conta: "act_1", acao: "editar", id: "100", nivel: "campaign", status: "DELETED", confirmar: true }).success, false);
  assert.equal(acaoAds.safeParse({ conta: "act_1", acao: "editar", id: "100", nivel: "campaign", status: "ACTIVE" }).success, false);

  const originalFetch = globalThis.fetch;
  const originalToken = process.env.META_SYSTEM_USER_TOKEN;
  process.env.META_SYSTEM_USER_TOKEN = "teste-local";
  const escritas: Array<{ caminho: string; body: Record<string, unknown> }> = [];
  let contaObjeto = "1", gestao = true;
  globalThis.fetch = async (entrada, init) => {
    const url = new URL(String(entrada)); const caminho = url.pathname.replace(/^\/v[^/]+\//, "");
    if (init?.method === "POST") { escritas.push({ caminho, body: JSON.parse(String(init.body)) }); return Response.json({ success: true, id: "123" }); }
    if (caminho === "me/adaccounts") return Response.json({ data: [{ id: "act_1", currency: "BRL" }] });
    if (caminho === "me/permissions") return Response.json({ data: gestao ? [{ permission: "ads_management", status: "granted" }] : [] });
    if (caminho === "100") return Response.json({ id: "100", account_id: contaObjeto, daily_budget: "1000" });
    if (caminho === "act_1/campaigns") return Response.json({ data: [{ id: "100", name: "Captação" }] });
    if (caminho === "act_1/insights") return Response.json({ data: [{ campaign_id: "100", date_start: "2026-04-02", spend: "50", clicks: "10", actions: [{ action_type: "lead", value: "2" }] }] });
    if (caminho === "paginas") return Response.json(url.searchParams.has("after") ? { data: [{ id: "2" }] } : { data: [{ id: "1" }], paging: { next: "https://graph.facebook.com/ignored", cursors: { after: "cursor" } } });
    throw new Error(`Consulta inesperada no teste: ${caminho}`);
  };
  try {
    assert.equal((await listarMeta("paginas", {})).length, 2);
    const entrada = { conta: "act_1", confirmar: true as const, id: "100", nivel: "campaign" as const };
    await executarAcaoAds({ ...entrada, acao: "editar", orcamento: 1500, tipoOrcamento: "daily_budget" });
    assert.deepEqual(escritas.pop()?.body, { daily_budget: 1500 });
    await executarAcaoAds({ ...entrada, acao: "duplicar" });
    assert.deepEqual(escritas.pop()?.body, { status_option: "PAUSED", deep_copy: true });
    await executarAcaoAds({ conta: "act_1", confirmar: true, acao: "criar_campanha", nome: "Teste", objetivo: "OUTCOME_LEADS", categorias: [] });
    assert.equal(escritas.pop()?.body.status, "PAUSED");
    await assert.rejects(() => executarAcaoAds({ ...entrada, acao: "editar", orcamento: 1500, tipoOrcamento: "lifetime_budget" }));
    contaObjeto = "2";
    await assert.rejects(() => executarAcaoAds({ ...entrada, acao: "editar", status: "ACTIVE" }));
    contaObjeto = "1"; gestao = false;
    await assert.rejects(() => executarAcaoAds({ ...entrada, acao: "editar", status: "ACTIVE" }));
    assert.equal(escritas.length, 0);

    // Série da gaveta: sem acesso ao CRM não encosta no banco, e todo dia do
    // período aparece — inclusive os sem veiculação, que é o que desenha a
    // pausa no gráfico em vez de emendar uma reta entre dois dias distantes.
    assert.equal(serieAds.safeParse({ conta: "act_1", inicio: "2026-04-01", fim: "2026-04-03" }).success, false);
    const serie = await carregarSerieCampanha({ conta: "act_1", campanha: "100", inicio: "2026-04-01", fim: "2026-04-03" }, { permitido: false, dono: null });
    assert.equal(serie.crm, false);
    assert.equal(serie.campanha.nome, "Captação");
    assert.deepEqual(serie.dias.map(d => d.dia), ["2026-04-01", "2026-04-02", "2026-04-03"]);
    assert.deepEqual(serie.dias[1], { dia: "2026-04-02", gasto: 50, cliques: 10, leads: 2, oportunidades: 0, ganhas: 0, valorGanho: 0 });
    assert.equal(serie.dias[0].gasto, 0);
    await assert.rejects(() => carregarSerieCampanha({ conta: "act_1", campanha: "999", inicio: "2026-04-01", fim: "2026-04-03" }, { permitido: false, dono: null }));
  } finally { globalThis.fetch = originalFetch; if (originalToken === undefined) delete process.env.META_SYSTEM_USER_TOKEN; else process.env.META_SYSTEM_USER_TOKEN = originalToken; }
  console.log("Meta Ads: atribuição, coorte, métricas, datas, paginação, permissões, série diária da campanha e escritas validadas sem alterar a Meta.");
}
void main();
