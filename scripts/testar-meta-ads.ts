import assert from "node:assert/strict";
import { campanhaPelosNomes, dividir, leadsPor, metricasAds, origemDaOportunidade, pedidoDeCampanha, resolverOrigem, resumoCrm, situacaoDosLeads, type EntradaCrm, type OportunidadeAds } from "../lib/meta-ads-calculos";
import { acaoAds, executarAcaoAds } from "../lib/meta-ads-gestao";
import { carregarDetalheCampanha, carregarRelatorioAds, consultaAds, serieAds } from "../lib/meta-ads-relatorio";
import { listarMeta } from "../lib/meta";
import type { ObjetoAds } from "../lib/meta-ads-tipos";

async function main() {
  const catalogo: ObjetoAds[] = [{ id: "100", name: "Captação", status: "ACTIVE", effective_status: "ACTIVE" }, { id: "101", name: "Captação", status: "PAUSED", effective_status: "PAUSED" }];
  assert.equal(resolverOrigem({ utm_campaign: "Captação" }, catalogo, "campaign").motivo, "ambiguas");
  assert.equal(resolverOrigem({ campaign_id: "100", utm_campaign: "Captação" }, catalogo, "campaign").id, "100");
  assert.equal(resolverOrigem({ campaign_id: "999", utm_campaign: "Captação" }, catalogo, "campaign").motivo, "semCorrespondencia");
  assert.equal(resolverOrigem(null, catalogo, "campaign").motivo, "semOrigem");
  assert.equal(pedidoDeCampanha({ utm_id: "100", utm_campaign: "Captação" }), null);
  assert.equal(pedidoDeCampanha({ utm_source: "facebook" }), null);
  assert.deepEqual(pedidoDeCampanha({ utm_campaign: " Captação ", adset_id: "{{adset.id}}" }), { nome: "Captação", anuncio: null, conjunto: null, nomeDoConjunto: null, nomeDoAnuncio: null });
  assert.deepEqual(pedidoDeCampanha({ ad_id: "300" }), { nome: null, anuncio: "300", conjunto: null, nomeDoConjunto: null, nomeDoAnuncio: null });
  // Macro não substituída não é pista; nome de conjunto e anúncio é.
  assert.equal(pedidoDeCampanha({ utm_campaign: "{{campaign.name}}", utm_term: "{{adset.name}}", utm_content: "{{ad.name}}" }), null);
  assert.deepEqual(pedidoDeCampanha({ utm_campaign: "Nome antigo", utm_term: "Conjunto A", utm_content: "Anúncio 1" }),
    { nome: "Nome antigo", anuncio: null, conjunto: null, nomeDoConjunto: "Conjunto A", nomeDoAnuncio: "Anúncio 1" });

  // A campanha pelo conjunto e pelo anúncio: só com UMA campanha por pista, e
  // as duas concordando. Conjunto repetido em duas campanhas (campanha
  // duplicada) não é pista; o anúncio decide sozinho.
  const conjuntos = [{ id: "j1", name: "Conjunto A", campaign_id: "100" }, { id: "j2", name: "Conjunto B", campaign_id: "100" }, { id: "j3", name: "Conjunto B", campaign_id: "200" }];
  const anuncios = [{ id: "a1", name: "Anúncio 1", campaign_id: "100" }, { id: "a2", name: "Anúncio 2", campaign_id: "200" }];
  assert.equal(campanhaPelosNomes({ nomeDoConjunto: "Conjunto A", nomeDoAnuncio: "Anúncio 1" }, conjuntos, anuncios), "100");
  assert.equal(campanhaPelosNomes({ nomeDoConjunto: "Conjunto B", nomeDoAnuncio: "Anúncio 2" }, conjuntos, anuncios), "200");
  assert.equal(campanhaPelosNomes({ nomeDoConjunto: "Conjunto B", nomeDoAnuncio: null }, conjuntos, anuncios), null);
  assert.equal(campanhaPelosNomes({ nomeDoConjunto: "Conjunto A", nomeDoAnuncio: "Anúncio 2" }, conjuntos, anuncios), null);
  assert.equal(campanhaPelosNomes({ nomeDoConjunto: "Inexistente", nomeDoAnuncio: null }, conjuntos, anuncios), null);
  const op: OportunidadeAds = { id: "o1", contato_id: "c1", status: "aberta", valor: 100, etapa_id: "e1", etapa_nome: "Entrada", etapa_ordem: 0, funil_id: "f1", funil_nome: "Vendas", primeira_ordem: 0, campos: { campaign_id: "100" }, contato_campos: { campaign_id: "101", adset_id: "20" } };
  assert.deepEqual(origemDaOportunidade(op), { campaign_id: "100" });
  assert.deepEqual(origemDaOportunidade({ ...op, campos: {} }), op.contato_campos);
  const crm = resumoCrm([op, { ...op, id: "o2", status: "ganha", valor: 300, etapa_id: "e2", etapa_nome: "Proposta", etapa_ordem: 2 }, { ...op, id: "o3", contato_id: "c2", status: "perdida", valor: 500 }]);
  assert.equal(crm.leads, 2); assert.equal(crm.oportunidades, 3); assert.equal(crm.valorGanho, 300); assert.equal(crm.valorAberto, 100); assert.equal(crm.avancaram, 1);
  assert.equal(resumoCrm([op], { funil_id: "outro", ordem: 0 }).avancaram, 0);

  // Leads no CRM: a pessoa conta UMA vez por campanha, no dia da primeira
  // entrada — o contato que nasceu e a oportunidade dele são a mesma chegada. E
  // cada pessoa fica com a melhor situação que a atribuição conseguiu.
  const entradas: EntradaCrm[] = [
    { contato_id: "c1", dia: "2026-04-01", campos: null, contato_campos: { campaign_id: "100" } },
    { contato_id: "c1", dia: "2026-04-01", campos: { campaign_id: "100" }, contato_campos: { campaign_id: "100" } },
    { contato_id: "c2", dia: "2026-04-02", campos: null, contato_campos: {} },
    { contato_id: "c2", dia: "2026-04-03", campos: { utm_campaign: "Captação" }, contato_campos: {} },
    { contato_id: "c3", dia: "2026-04-02", campos: null, contato_campos: { utm_campaign: "Google Ads" } },
    { contato_id: "c4", dia: "2026-04-03", campos: { campaign_id: "100" }, contato_campos: {} },
  ];
  const porCampanha = leadsPor(entradas, e => resolverOrigem(origemDaOportunidade(e), catalogo, "campaign").id);
  assert.deepEqual([...porCampanha.get("100")!], [["c1", "2026-04-01"], ["c4", "2026-04-03"]]);
  assert.deepEqual(situacaoDosLeads(entradas, catalogo), { total: 4, atribuidos: 2, semOrigem: 0, semCorrespondencia: 1, ambiguas: 1 });
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
    // Conjuntos e anúncios da gaveta: a campanha não tem nenhum.
    if (caminho === "act_1/adsets" || caminho === "act_1/ads") return Response.json({ data: [] });
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

    // Relatório da conta sem acesso ao CRM: não encosta no banco, soma o
    // investimento pelas campanhas e põe todo dia do período no gráfico.
    const relatorio = await carregarRelatorioAds({ conta: "act_1", inicio: "2026-04-01", fim: "2026-04-03" }, { permitido: false, dono: null });
    assert.equal(relatorio.total.gasto, 50); assert.equal(relatorio.total.leadsMeta, 2);
    assert.equal(relatorio.total.crm, null); assert.equal(relatorio.leadsCrm, null);
    assert.deepEqual(relatorio.diario.map(d => [d.dia, d.leadsMeta]), [["2026-04-01", 0], ["2026-04-02", 2], ["2026-04-03", 0]]);

    // Gaveta: idem, e todo dia do período aparece — inclusive os sem
    // veiculação, que é o que desenha a pausa no gráfico em vez de emendar uma
    // reta entre dois dias distantes.
    assert.equal(serieAds.safeParse({ conta: "act_1", inicio: "2026-04-01", fim: "2026-04-03" }).success, false);
    const serie = await carregarDetalheCampanha({ conta: "act_1", campanha: "100", inicio: "2026-04-01", fim: "2026-04-03" }, { permitido: false, dono: null });
    assert.equal(serie.crm, false);
    assert.equal(serie.campanha.nome, "Captação");
    assert.deepEqual(serie.dias.map(d => d.dia), ["2026-04-01", "2026-04-02", "2026-04-03"]);
    assert.deepEqual(serie.dias[1], { dia: "2026-04-02", gasto: 50, cliques: 10, leadsMeta: 2, leadsCrm: 0, oportunidades: 0, ganhas: 0, valorGanho: 0 });
    assert.equal(serie.dias[0].gasto, 0);
    assert.deepEqual([serie.conjuntos, serie.anuncios], [[], []]);
    await assert.rejects(() => carregarDetalheCampanha({ conta: "act_1", campanha: "999", inicio: "2026-04-01", fim: "2026-04-03" }, { permitido: false, dono: null }));
  } finally { globalThis.fetch = originalFetch; if (originalToken === undefined) delete process.env.META_SYSTEM_USER_TOKEN; else process.env.META_SYSTEM_USER_TOKEN = originalToken; }
  console.log("Meta Ads: atribuição, leads do CRM, coorte, métricas, datas, paginação, permissões, relatório, gaveta da campanha e escritas validadas sem alterar a Meta.");
}
void main();
