import assert from "node:assert/strict";
import {
  anuncioDaOrigem, campanhaPelosNomes, dividir, idDaMeta, leadsPor, metricasAds, origemDaOportunidade, pecaDoAnuncio, pedidoDeCampanha,
  resolverOrigem, resumoCrm, situacaoDosLeads, somarMetricas, textosDoCriativo, type EntradaCrm, type OportunidadeAds,
} from "../lib/meta-ads-calculos";
import { acaoAds, executarAcaoAds } from "../lib/meta-ads-gestao";
import { formatarMetrica, variacao } from "../lib/meta-ads-metricas";
import { criterio, primeiroQueRanqueia, ranquear } from "../lib/meta-ads-ranking";
import { carregarCriativosAds, carregarDetalheCampanha, carregarRelatorioAds, consultaAds, serieAds } from "../lib/meta-ads-relatorio";
import { listarMeta } from "../lib/meta";
import type { CrmAds, InsightAds, ObjetoAds } from "../lib/meta-ads-tipos";

// Todos os testes rodam sem banco (acesso ao CRM `permitido: false`) e sem a
// Meta: `globalThis.fetch` é trocado por uma resposta local.

const perto = (atual: number | null, esperado: number) => assert.ok(atual !== null && Math.abs(atual - esperado) < 1e-9, `${atual} ≠ ${esperado}`);
const acoes = (pares: Record<string, number>) => Object.entries(pares).map(([action_type, v]) => ({ action_type, value: String(v) }));
const doVideo = (v: number) => [{ action_type: "video_view", value: String(v) }];

function testarCalculos() {
  // ── Mapeamento de uma linha da Meta ──
  const completo: InsightAds = {
    spend: "200", impressions: "10000", reach: "5000", frequency: "2", clicks: "300", unique_clicks: "250",
    inline_link_clicks: "100", outbound_clicks: [{ action_type: "outbound_click", value: "90" }],
    actions: acoes({
      lead: 10, onsite_web_lead: 6, "offsite_conversion.fb_pixel_lead": 4, link_click: 999, landing_page_view: 80,
      video_view: 2000, post_engagement: 2500, post_reaction: 50, comment: 5, post: 3, "onsite_conversion.post_save": 7,
      "onsite_conversion.messaging_conversation_started_7d": 4,
    }),
    video_thruplay_watched_actions: doVideo(500), video_p25_watched_actions: doVideo(1500), video_p50_watched_actions: doVideo(1000),
    video_p75_watched_actions: doVideo(700), video_p95_watched_actions: doVideo(450), video_p100_watched_actions: doVideo(400),
    video_avg_time_watched_actions: doVideo(10), instagram_profile_visits: "12",
    results: [{ indicator: "actions:lead", values: [{ value: "10" }] }],
    quality_ranking: "ABOVE_AVERAGE", engagement_rate_ranking: "AVERAGE", conversion_rate_ranking: "BELOW_AVERAGE_35",
  };
  const m = metricasAds(completo);
  // Lead é o agregado: onsite_web_lead e offsite_* não somam de novo.
  assert.equal(m.leads, 10); assert.equal(m.custoPorLead, 20);
  assert.equal(m.cpm, 20); assert.equal(m.cpp, 40); assert.equal(m.frequencia, 2);
  assert.equal(m.cliques, 300); assert.equal(m.cliquesUnicos, 250); assert.equal(m.ctr, 3); perto(m.cpc, 200 / 300);
  // inline_link_clicks vale sobre a ação link_click.
  assert.equal(m.cliquesLink, 100); assert.equal(m.ctrLink, 1); assert.equal(m.cpcLink, 2); assert.equal(m.cliquesSaida, 90);
  assert.equal(m.visualizacoesPagina, 80); assert.equal(m.custoVisualizacaoPagina, 2.5); assert.equal(m.taxaCarregamento, 80);
  assert.equal(m.conversas, 4); assert.equal(m.custoPorConversa, 50);
  assert.equal(m.video3s, 2000); assert.equal(m.taxaGancho, 20); assert.equal(m.thruplays, 500); assert.equal(m.taxaRetencao, 25);
  assert.equal(m.custoThruplay, 0.4); assert.equal(m.tempoMedioVideo, 10);
  assert.deepEqual([m.videoP25, m.videoP50, m.videoP75, m.videoP95, m.videoP100], [1500, 1000, 700, 450, 400]);
  assert.deepEqual([m.engajamentos, m.reacoes, m.comentarios, m.compartilhamentos, m.salvamentos, m.visitasPerfil], [2500, 50, 5, 3, 7, 12]);
  assert.deepEqual(m.resultado, { tipo: "lead", valor: 10, custo: 20 });
  assert.deepEqual(m.qualidade, { qualidade: "ABOVE_AVERAGE", engajamento: "AVERAGE", conversao: "BELOW_AVERAGE_35" });

  // Anúncio de imagem: sem gancho (null, não 0%); clique no link pela ação;
  // indicador sem `values` é zero resultado, com custo null.
  const imagem = metricasAds({ spend: "50", impressions: "2000", actions: acoes({ link_click: 20 }), results: [{ indicator: "actions:lead" }] });
  assert.equal(imagem.taxaGancho, null); assert.equal(imagem.taxaRetencao, null); assert.equal(imagem.tempoMedioVideo, null);
  assert.equal(imagem.cliquesLink, 20); assert.equal(imagem.frequencia, null); assert.equal(imagem.qualidade, null);
  assert.deepEqual(imagem.resultado, { tipo: "lead", valor: 0, custo: null });
  assert.equal(metricasAds({ spend: "1" }).resultado, null);
  assert.deepEqual(metricasAds({ quality_ranking: "AVERAGE" }).qualidade, { qualidade: "AVERAGE", engajamento: "UNKNOWN", conversao: "UNKNOWN" });
  const vazio = metricasAds();
  assert.equal(vazio.gasto, 0); assert.equal(vazio.cpc, null); assert.equal(vazio.custoPorLead, null); assert.equal(vazio.resultado, null);

  // ── Soma ──
  // A soma de um só é ele mesmo: as razões saem da mesma fórmula.
  assert.deepEqual(somarMetricas([m]), m);
  const a = metricasAds({ spend: "100", impressions: "4000", reach: "3000", actions: acoes({ lead: 4, video_view: 1000 }),
    video_thruplay_watched_actions: doVideo(200), video_avg_time_watched_actions: doVideo(8),
    results: [{ indicator: "actions:lead", values: [{ value: "4" }] }], quality_ranking: "AVERAGE" });
  const b = metricasAds({ spend: "50", impressions: "1000", reach: "900", actions: acoes({ lead: 1, video_view: 500 }),
    video_thruplay_watched_actions: doVideo(100), video_avg_time_watched_actions: doVideo(14),
    results: [{ indicator: "actions:lead", values: [{ value: "1" }] }], quality_ranking: "ABOVE_AVERAGE" });
  const s = somarMetricas([a, b]);
  assert.equal(s.gasto, 150); assert.equal(s.impressoes, 5000); assert.equal(s.alcance, 3900); perto(s.frequencia, 5000 / 3900);
  assert.equal(s.leads, 5); assert.equal(s.custoPorLead, 30); assert.equal(s.cpm, 30);
  assert.equal(s.video3s, 1500); assert.equal(s.taxaGancho, 30); assert.equal(s.thruplays, 300); assert.equal(s.taxaRetencao, 20);
  assert.equal(s.tempoMedioVideo, 10); // (8 × 1000 + 14 × 500) ÷ 1500
  assert.deepEqual(s.resultado, { tipo: "lead", valor: 5, custo: 30 });
  assert.deepEqual(s.qualidade, a.qualidade); // a do que teve mais impressões
  const conversa = metricasAds({ spend: "10", results: [{ indicator: "actions:onsite_conversion.messaging_conversation_started_7d", values: [{ value: "2" }] }] });
  assert.equal(somarMetricas([a, conversa]).resultado, null);
  assert.equal(somarMetricas([a, metricasAds({ spend: "10" })]).resultado, null);
  const nada = somarMetricas([]);
  assert.equal(nada.gasto, 0); assert.equal(nada.custoPorLead, null); assert.equal(nada.resultado, null); assert.equal(nada.tempoMedioVideo, null);

  // ── Peça e anúncio de um lead ──
  assert.deepEqual(pecaDoAnuncio("1", { id: "c1", video_id: "V1", image_hash: "H1" }), { chave: "V1", tipo: "video" });
  assert.deepEqual(pecaDoAnuncio("1", { id: "c1", image_hash: "H1" }), { chave: "H1", tipo: "imagem" });
  assert.deepEqual(pecaDoAnuncio("1", { id: "c1", object_type: "PHOTO" }), { chave: "c1", tipo: "imagem" });
  assert.deepEqual(pecaDoAnuncio("1", { id: "c1", object_type: "SHARE" }), { chave: "c1", tipo: "outro" });
  assert.deepEqual(pecaDoAnuncio("1"), { chave: "1", tipo: "outro" });
  // Criativo dinâmico: nada no topo, tudo no asset_feed_spec — a peça é o
  // primeiro hash (ou vídeo), e texto e título são as primeiras variações.
  const dinamicoImagem = { id: "cd1", object_type: "SHARE", object_story_spec: { link_data: {} },
    asset_feed_spec: { images: [{ hash: "HF1" }, { hash: "HF2" }], bodies: [{ text: "Texto dinâmico" }, { text: "Outro texto" }], titles: [{ text: "Título dinâmico" }] } };
  assert.deepEqual(pecaDoAnuncio("1", dinamicoImagem), { chave: "HF1", tipo: "imagem" });
  assert.deepEqual(textosDoCriativo(dinamicoImagem), { titulo: "Título dinâmico", texto: "Texto dinâmico" });
  // Vídeo dinâmico: o vídeo vale sobre a imagem (a capa), até a do topo.
  const dinamicoVideo = { id: "cd2", object_type: "SHARE", image_hash: "CAPA",
    asset_feed_spec: { videos: [{ video_id: "VF1" }], images: [{ hash: "CAPA" }], bodies: [{ text: "Texto do vídeo" }] } };
  assert.deepEqual(pecaDoAnuncio("1", dinamicoVideo), { chave: "VF1", tipo: "video" });
  assert.deepEqual(textosDoCriativo(dinamicoVideo), { titulo: null, texto: "Texto do vídeo" });
  // A última fonte é o post montado (object_story_spec).
  const doPostVideo = { id: "cp1", object_story_spec: { video_data: { video_id: "VS1", message: "Mensagem", title: "Título do vídeo" } } };
  assert.deepEqual(pecaDoAnuncio("1", doPostVideo), { chave: "VS1", tipo: "video" });
  assert.deepEqual(textosDoCriativo(doPostVideo), { titulo: "Título do vídeo", texto: "Mensagem" });
  const doPostImagem = { id: "cp2", object_story_spec: { link_data: { image_hash: "HS1", message: "Mensagem do link", name: "Nome do link" } } };
  assert.deepEqual(pecaDoAnuncio("1", doPostImagem), { chave: "HS1", tipo: "imagem" });
  assert.deepEqual(textosDoCriativo(doPostImagem), { titulo: "Nome do link", texto: "Mensagem do link" });
  // Carrossel fica "outro", pelo criativo, mesmo com imagem no link.
  assert.deepEqual(pecaDoAnuncio("1", { id: "cc1", object_story_spec: { link_data: { image_hash: "X", child_attachments: [{ name: "a" }, { name: "b" }] } } }), { chave: "cc1", tipo: "outro" });
  // O topo vale sobre o asset_feed_spec; texto vazio não conta.
  const topo = { id: "ct1", video_id: "V0", title: "", body: "Corpo", asset_feed_spec: { videos: [{ video_id: "VF" }], titles: [{ text: "Título do feed" }], bodies: [{ text: "Corpo do feed" }] } };
  assert.deepEqual(pecaDoAnuncio("1", topo), { chave: "V0", tipo: "video" });
  assert.deepEqual(textosDoCriativo(topo), { titulo: "Título do feed", texto: "Corpo" });
  assert.deepEqual(textosDoCriativo(), { titulo: null, texto: null });

  const campanhas = [{ id: "100", name: "Captação" }, { id: "200", name: "Topo" }];
  // IDs da Meta são números (idDaMeta): conjuntos 11 e 12, anúncios 21 a 23.
  const conjuntos = [{ id: "11", name: "Conjunto A", campaign_id: "100" }, { id: "12", name: "Conjunto A", campaign_id: "200" }];
  const anuncios = [{ id: "21", name: "Anúncio 1", adset_id: "11" }, { id: "22", name: "Anúncio 1", adset_id: "12" }, { id: "23", name: "Anúncio 2", adset_id: "11" }];
  // O mesmo nome de conjunto e de anúncio em duas campanhas: a campanha decide.
  assert.equal(anuncioDaOrigem({ utm_campaign: "Captação", utm_term: "Conjunto A", utm_content: "Anúncio 1" }, campanhas, conjuntos, anuncios), "21");
  assert.equal(anuncioDaOrigem({ utm_campaign: "Topo", utm_term: "Conjunto A", utm_content: "Anúncio 1" }, campanhas, conjuntos, anuncios), "22");
  assert.equal(anuncioDaOrigem({ campaign_id: "100", adset_id: "11", ad_id: "23" }, campanhas, conjuntos, anuncios), "23");
  assert.equal(anuncioDaOrigem({ utm_term: "Conjunto A", utm_content: "Anúncio 1" }, campanhas, conjuntos, anuncios), null);
  assert.equal(anuncioDaOrigem({ utm_campaign: "Captação", utm_term: "Outro", utm_content: "Anúncio 1" }, campanhas, conjuntos, anuncios), null);
  // Parâmetros automáticos: os três IDs nos utm_*, com o utm_id que não é ID de campanha.
  assert.equal(anuncioDaOrigem({ utm_campaign: "100", utm_term: "11", utm_content: "23", utm_id: "11_v2_s04" }, campanhas, conjuntos, anuncios), "23");
  // A pessoa que veio por dois anúncios da mesma peça é um lead da peça.
  const pecaDe: Record<string, string> = { 21: "V1", 23: "V1", 22: "V2" };
  const entradasPeca: EntradaCrm[] = [
    { contato_id: "c1", dia: "2026-04-01", campos: null, contato_campos: { campaign_id: "100", adset_id: "11", ad_id: "21" } },
    { contato_id: "c1", dia: "2026-04-02", campos: { campaign_id: "100", adset_id: "11", ad_id: "23" }, contato_campos: {} },
    { contato_id: "c2", dia: "2026-04-02", campos: { campaign_id: "200", adset_id: "12", ad_id: "22" }, contato_campos: {} },
  ];
  const porPeca = leadsPor(entradasPeca, e => pecaDe[anuncioDaOrigem(origemDaOportunidade(e), campanhas, conjuntos, anuncios) ?? ""] ?? null);
  assert.deepEqual([...porPeca.get("V1")!], [["c1", "2026-04-01"]]);
  assert.equal(porPeca.get("V2")?.size, 1);
}

function testarRankingEFormato() {
  const crmCom = (leads: number, oportunidades = 0): CrmAds => ({ leads, oportunidades, abertas: 0, ganhas: 0, perdidas: 0, avancaram: 0, valorGanho: 0, valorAberto: 0, etapas: [] });
  const linha = (id: string, gasto: number, leadsCrm: number | null, extra: InsightAds = {}) =>
    ({ id, metricas: metricasAds({ spend: String(gasto), ...extra }), crm: leadsCrm === null ? null : crmCom(leadsCrm) });
  const ctx = { moeda: "BRL" };
  const itens = [linha("A", 300, 10), linha("B", 100, 2), linha("C", 200, 5), linha("D", 600, 20), linha("E", 0, 0)];
  // Menor custo por lead no CRM: B fica fora (2 leads, mínimo 3); A e D empatam
  // em R$ 30 e D, que investiu mais, vem antes. E não investiu nem apareceu: não
  // conta como fora do mínimo.
  const r = ranquear(itens, criterio("custoLeadCrm"), ctx);
  assert.deepEqual(r.posicoes.map(p => [p.item.id, p.valor, p.posicao]), [["D", 30, 1], ["A", 30, 2], ["C", 40, 3]]);
  assert.equal(r.foraDoMinimo, 1);
  // Custo só ranqueia quem gastou: gasto 0 com 5 leads no CRM (clique antigo)
  // sairia com custo zero no pódio. Fica fora do custo e segue nos "mais leads".
  // Só entra em foraDoMinimo se teve impressões: parado no período inteiro
  // (gasto 0, 0 impressões) some sem ser contado.
  const semGasto = [...itens, linha("P", 0, 5, { impressions: "200" }), linha("Q", 0, 5)];
  const porCusto = ranquear(semGasto, criterio("custoLeadCrm"), ctx);
  assert.deepEqual(porCusto.posicoes.map(p => p.item.id), ["D", "A", "C"]);
  assert.equal(porCusto.foraDoMinimo, 2); // B (2 leads) e P (gasto 0, com impressões); Q não conta
  assert.deepEqual(ranquear(semGasto, criterio("leadsCrm"), ctx).posicoes.map(p => p.item.id), ["D", "A", "C", "P", "Q", "B"]);
  // Maior é melhor: CTR do link, só com 1.000 impressões.
  const porCtr = ranquear([
    linha("X", 10, null, { impressions: "2000", inline_link_clicks: "20" }),
    linha("Y", 10, null, { impressions: "1000", inline_link_clicks: "30" }),
    linha("Z", 10, null, { impressions: "500", inline_link_clicks: "50" }),
  ], criterio("ctrLink"), ctx);
  assert.deepEqual(porCtr.posicoes.map(p => p.item.id), ["Y", "X"]); assert.equal(porCtr.foraDoMinimo, 1);
  // Sem lead no CRM, abre no custo por lead da Meta; sem nada, no primeiro da lista.
  const soMeta = [linha("M", 90, 0, { actions: acoes({ lead: 3 }) })];
  assert.equal(primeiroQueRanqueia(soMeta, ["custoLeadCrm", "custoPorLead"], ctx).id, "custoPorLead");
  assert.equal(primeiroQueRanqueia([linha("N", 90, 0)], ["custoLeadCrm", "custoPorLead"], ctx).id, "custoLeadCrm");

  const texto = (s: string) => s.replace(/\s/g, " "); // o Intl separa "R$" com espaço inquebrável
  assert.equal(formatarMetrica(null, "moeda", "BRL"), "—");
  assert.equal(formatarMetrica(Infinity, "inteiro", "BRL"), "—");
  assert.equal(texto(formatarMetrica(1234.5, "moeda", "BRL")), "R$ 1.234,50");
  assert.equal(texto(formatarMetrica(10, "real", "USD")), "R$ 10,00");
  assert.equal(formatarMetrica(1234, "inteiro", "BRL"), "1.234");
  assert.equal(formatarMetrica(12.5, "porcento", "BRL"), "12,5%");
  assert.equal(formatarMetrica(3, "porcento", "BRL"), "3,0%");
  assert.equal(formatarMetrica(2.5, "multiplo", "BRL"), "2,5×");
  assert.equal(formatarMetrica(9.6, "segundos", "BRL"), "10 s");
  assert.equal(variacao(120, 100), 20); assert.equal(variacao(80, 100), -20);
  assert.equal(variacao(5, 0), null); assert.equal(variacao(null, 5), null);
  assert.equal(variacao(5, null), null); assert.equal(variacao(5, undefined), null);
}

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
  // Parâmetros automáticos da Meta (conta ARCK1PRO, 2026-10-26): utm_campaign/term/content
  // são IDs, e o utm_id "<conjunto>_v2_…" não é ID de campanha — não pode mandar.
  const automaticos = { utm_campaign: "100", utm_term: "200", utm_content: "300", utm_id: "200_v2_s04_i97938797" };
  assert.equal(idDaMeta(automaticos, ["campaign_id", "campanha_id", "utm_id"]), null);
  assert.equal(idDaMeta({ campaign_id: "{{campaign.id}}", utm_id: " 100 " }, ["campaign_id", "utm_id"]), "100");
  assert.equal(resolverOrigem(automaticos, catalogo, "campaign").id, "100");
  assert.equal(resolverOrigem({ utm_id: "200_v2_s04" }, catalogo, "campaign").motivo, "semOrigem");
  assert.deepEqual(pedidoDeCampanha(automaticos), { nome: "100", anuncio: "300", conjunto: "200", nomeDoConjunto: "200", nomeDoAnuncio: "300" });
  assert.equal(origemDaOportunidade({ campos: { utm_id: "200_v2_s04" }, contato_campos: automaticos }), automaticos);

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

  testarCalculos();
  testarRankingEFormato();

  // ── A Meta simulada ──
  // Insights por anúncio da conta (o ranking de criativos): a1 e a2 são o mesmo
  // vídeo em duas campanhas; a3 é uma imagem; a9 veiculou e foi apagado (a
  // lista de anúncios não o devolve).
  const porAnuncio: InsightAds[] = [
    { ad_id: "a1", campaign_id: "100", adset_id: "j1", spend: "100", impressions: "4000", reach: "3000",
      actions: acoes({ lead: 4, video_view: 1000 }), video_thruplay_watched_actions: doVideo(200),
      results: [{ indicator: "actions:lead", values: [{ value: "4" }] }], quality_ranking: "AVERAGE" },
    { ad_id: "a2", campaign_id: "200", adset_id: "j2", spend: "50", impressions: "1000", reach: "900",
      actions: acoes({ lead: 1, video_view: 500 }), video_thruplay_watched_actions: doVideo(100),
      results: [{ indicator: "actions:lead", values: [{ value: "1" }] }], quality_ranking: "ABOVE_AVERAGE" },
    { ad_id: "a3", campaign_id: "100", adset_id: "j1", spend: "30", impressions: "3000", reach: "2500", actions: acoes({ lead: 1 }) },
    { ad_id: "a9", ad_name: "Anúncio apagado", campaign_id: "100", adset_id: "j1", spend: "5", impressions: "100" },
    // Criativos dinâmicos: a4 e a6 começam pela mesma imagem; a5 é vídeo.
    { ad_id: "a4", campaign_id: "100", adset_id: "j1", spend: "20", impressions: "2000" },
    { ad_id: "a5", campaign_id: "200", adset_id: "j2", spend: "10", impressions: "900", actions: acoes({ video_view: 300 }) },
    { ad_id: "a6", campaign_id: "200", adset_id: "j2", spend: "8", impressions: "700" },
  ];
  const anunciosDaConta = [
    { id: "a1", name: "Vídeo fachada - Captação", effective_status: "PAUSED", campaign_id: "100", adset_id: "j1",
      creative: { id: "cr1", video_id: "V1", thumbnail_url: "https://exemplo.test/a1.jpg", title: "Título a1", body: "Texto a1", instagram_permalink_url: "https://instagram.test/p/a1" } },
    { id: "a2", name: "Vídeo fachada - Topo", effective_status: "ACTIVE", campaign_id: "200", adset_id: "j2",
      creative: { id: "cr2", video_id: "V1", thumbnail_url: "https://exemplo.test/a2.jpg" } },
    { id: "a3", name: "Imagem planta", effective_status: "ACTIVE", campaign_id: "100", adset_id: "j1",
      creative: { id: "cr3", image_hash: "H1", image_url: "https://exemplo.test/a3.jpg" } },
    { id: "a4", name: "Dinâmico planta", effective_status: "ACTIVE", campaign_id: "100", adset_id: "j1",
      creative: { id: "cr4", object_type: "SHARE", thumbnail_url: "https://exemplo.test/a4.jpg",
        asset_feed_spec: { images: [{ hash: "HF1" }, { hash: "HF2" }], bodies: [{ text: "Texto dinâmico a4" }], titles: [{ text: "Título dinâmico a4" }] } } },
    { id: "a5", name: "Dinâmico vídeo", effective_status: "PAUSED", campaign_id: "200", adset_id: "j2",
      creative: { id: "cr5", object_type: "SHARE", asset_feed_spec: { videos: [{ video_id: "VF1" }], images: [{ hash: "CAPA" }], bodies: [{ text: "Texto do vídeo a5" }] } } },
    { id: "a6", name: "Dinâmico planta - Topo", effective_status: "PAUSED", campaign_id: "200", adset_id: "j2",
      creative: { id: "cr6", object_type: "SHARE", asset_feed_spec: { images: [{ hash: "HF1" }, { hash: "HF3" }], bodies: [{ text: "Texto dinâmico a6" }] } } },
  ];
  // Um período com 51 anúncios, para ver os lotes de 50.
  const muitos: InsightAds[] = Array.from({ length: 51 }, (_, n) => ({ ad_id: `n${String(n).padStart(2, "0")}`, campaign_id: "100", spend: "1" }));

  const originalFetch = globalThis.fetch;
  const originalToken = process.env.META_SYSTEM_USER_TOKEN;
  process.env.META_SYSTEM_USER_TOKEN = "teste-local";
  const escritas: Array<{ caminho: string; body: Record<string, unknown> }> = [];
  const leituras: Array<{ caminho: string; params: URLSearchParams }> = [];
  let contaObjeto = "1", gestao = true;
  globalThis.fetch = async (entrada, init) => {
    const url = new URL(String(entrada)); const caminho = url.pathname.replace(/^\/v[^/]+\//, "");
    if (init?.method === "POST") { escritas.push({ caminho, body: JSON.parse(String(init.body)) }); return Response.json({ success: true, id: "123" }); }
    leituras.push({ caminho, params: url.searchParams });
    const filtro = JSON.parse(url.searchParams.get("filtering") ?? "[]") as Array<{ field: string; value: string[] }>;
    if (caminho === "me/adaccounts") return Response.json({ data: [{ id: "act_1", currency: "BRL" }] });
    if (caminho === "me/permissions") return Response.json({ data: gestao ? [{ permission: "ads_management", status: "granted" }] : [] });
    if (caminho === "100") return Response.json({ id: "100", account_id: contaObjeto, daily_budget: "1000" });
    if (caminho === "act_1/campaigns") return Response.json({ data: [{ id: "100", name: "Captação" }, { id: "200", name: "Topo" }] });
    // Conjuntos e anúncios da gaveta (filtro por campanha): a campanha não tem
    // nenhum. Sem filtro, os conjuntos da conta; por id, os anúncios pedidos.
    if (caminho === "act_1/adsets") return Response.json({ data: filtro.length ? [] : [{ id: "j1", name: "Conjunto A", campaign_id: "100" }, { id: "j2", name: "Conjunto B", campaign_id: "200" }] });
    if (caminho === "act_1/ads") return Response.json({ data: filtro[0]?.field === "id" ? anunciosDaConta.filter(a => filtro[0].value.includes(a.id)) : [] });
    if (caminho === "act_1/insights") {
      const nivel = url.searchParams.get("level");
      const { since } = JSON.parse(url.searchParams.get("time_range") ?? "{}") as { since?: string };
      if (since === "2026-04-29") return Response.json({ error: { message: "Meta indisponível no teste." } }, { status: 500 });
      if (url.searchParams.has("time_increment")) return Response.json({ data: [{ campaign_id: "100", date_start: "2026-04-02", spend: "50", clicks: "10", impressions: "1000", inline_link_clicks: "8", actions: acoes({ lead: 2 }) }] });
      // A conta: a única leitura que traz alcance e frequência deduplicados.
      if (!nivel) return Response.json({ data: [since === "2026-03-29"
        ? { spend: "40", impressions: "800", reach: "600", actions: acoes({ lead: 4 }) }
        : { spend: "50", impressions: "1000", reach: "700", frequency: "1.43", clicks: "10", inline_link_clicks: "8", actions: acoes({ lead: 2, landing_page_view: 6 }) }] });
      if (nivel === "campaign") return Response.json({ data: [{ campaign_id: "100", spend: "50", clicks: "10", impressions: "1000", actions: acoes({ lead: 2 }) }] });
      if (nivel === "ad" && !filtro.length) return Response.json({ data: since === "2026-06-01" ? muitos : porAnuncio });
      return Response.json({ data: [] });
    }
    if (caminho === "paginas") return Response.json(url.searchParams.has("after") ? { data: [{ id: "2" }] } : { data: [{ id: "1" }], paging: { next: "https://graph.facebook.com/ignored", cursors: { after: "cursor" } } });
    throw new Error(`Consulta inesperada no teste: ${caminho}`);
  };
  const semCrm = { permitido: false, dono: null };
  const camposDe = (f: (l: { caminho: string; params: URLSearchParams }) => boolean) =>
    leituras.filter(f).map(l => (l.params.get("fields") ?? "").split(","));
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
    const relatorio = await carregarRelatorioAds({ conta: "act_1", inicio: "2026-04-01", fim: "2026-04-03" }, semCrm);
    assert.equal(relatorio.total.gasto, 50); assert.equal(relatorio.total.leadsMeta, 2);
    assert.equal(relatorio.total.crm, null); assert.equal(relatorio.leadsCrm, null);
    assert.deepEqual(relatorio.diario.map(d => [d.dia, d.leadsMeta]), [["2026-04-01", 0], ["2026-04-02", 2], ["2026-04-03", 0]]);
    assert.deepEqual(relatorio.diario[1], { dia: "2026-04-02", gasto: 50, impressoes: 1000, cliquesLink: 8, leadsMeta: 2, leadsCrm: 0 });
    // O total das métricas é a leitura da CONTA (as campanhas nem trazem alcance).
    assert.equal(relatorio.total.metricas.alcance, 700); assert.equal(relatorio.total.metricas.frequencia, 1.43);
    assert.equal(relatorio.total.metricas.visualizacoesPagina, 6); assert.equal(relatorio.total.metricas.custoPorLead, 25);
    // O anterior: mesmo tamanho, terminando na véspera.
    assert.deepEqual(relatorio.anterior?.periodo, { inicio: "2026-03-29", fim: "2026-03-31" });
    assert.equal(relatorio.anterior?.metricas.gasto, 40); assert.equal(relatorio.anterior?.metricas.leads, 4);
    assert.equal(relatorio.anterior?.crm, null);
    // Os campos pedidos: os de métrica em toda leitura; qualidade nunca fora do anúncio; a conta sem ids.
    const daConta = camposDe(l => l.caminho === "act_1/insights" && !l.params.get("level") && !l.params.has("time_increment"));
    assert.ok(daConta.length >= 2 && daConta.every(f => f.includes("results") && f.includes("video_thruplay_watched_actions") && !f.includes("campaign_id")));
    assert.ok(camposDe(l => l.params.get("level") === "campaign").every(f => f.includes("unique_clicks") && !f.includes("quality_ranking")));
    assert.ok(camposDe(l => l.params.has("time_increment") && !l.params.get("level")).every(f => f.includes("impressions") && f.includes("inline_link_clicks")));

    // Se só o anterior falhar, o relatório sai sem ele (erro no log, não na tela).
    const erroOriginal = console.error; const logados: unknown[][] = [];
    console.error = (...args: unknown[]) => { logados.push(args); };
    const semAnterior = await carregarRelatorioAds({ conta: "act_1", inicio: "2026-05-01", fim: "2026-05-02" }, semCrm)
      .finally(() => { console.error = erroOriginal; });
    assert.equal(semAnterior.anterior, null); assert.equal(semAnterior.total.metricas.gasto, 50);
    assert.equal(logados.length, 1); assert.match(String(logados[0][0]), /2026-04-29 a 2026-04-30/);

    // Gaveta: idem, e todo dia do período aparece — inclusive os sem
    // veiculação, que é o que desenha a pausa no gráfico em vez de emendar uma
    // reta entre dois dias distantes.
    assert.equal(serieAds.safeParse({ conta: "act_1", inicio: "2026-04-01", fim: "2026-04-03" }).success, false);
    const serie = await carregarDetalheCampanha({ conta: "act_1", campanha: "100", inicio: "2026-04-01", fim: "2026-04-03" }, semCrm);
    assert.equal(serie.crm, false);
    assert.equal(serie.campanha.nome, "Captação");
    assert.deepEqual(serie.dias.map(d => d.dia), ["2026-04-01", "2026-04-02", "2026-04-03"]);
    assert.deepEqual(serie.dias[1], { dia: "2026-04-02", gasto: 50, cliques: 10, leadsMeta: 2, leadsCrm: 0, oportunidades: 0, ganhas: 0, valorGanho: 0 });
    assert.equal(serie.dias[0].gasto, 0);
    assert.deepEqual([serie.conjuntos, serie.anuncios], [[], []]);
    await assert.rejects(() => carregarDetalheCampanha({ conta: "act_1", campanha: "999", inicio: "2026-04-01", fim: "2026-04-03" }, semCrm));
    // Na gaveta, o anúncio traz o criativo de 480 px, e só a leitura por anúncio pede a qualidade.
    const daCampanha = (l: { params: URLSearchParams }) => (l.params.get("filtering") ?? "").includes("campaign.id");
    assert.ok(camposDe(l => l.caminho === "act_1/ads" && daCampanha(l)).every(f => f.join(",").includes("thumbnail_width(480)") && f.join(",").includes("video_id")));
    assert.ok(camposDe(l => l.params.get("level") === "ad" && daCampanha(l)).every(f => f.includes("quality_ranking")));
    assert.ok(camposDe(l => l.params.get("level") === "adset").every(f => !f.includes("quality_ranking")));

    // Criativos: a1 e a2 (o mesmo vídeo) viram uma peça com as métricas somadas.
    const r = await carregarCriativosAds({ conta: "act_1", inicio: "2026-04-01", fim: "2026-04-03" }, semCrm);
    assert.equal(r.crm, false); assert.deepEqual(r.periodo, { inicio: "2026-04-01", fim: "2026-04-03" });
    assert.deepEqual(r.criativos.map(c => [c.chave, c.tipo]), [["V1", "video"], ["H1", "imagem"], ["HF1", "imagem"], ["VF1", "video"], ["a9", "outro"]]);
    const [video, imagem, dinamico, videoDinamico, apagado] = r.criativos;
    // O dinâmico de imagem junta a4 e a6 pelo primeiro hash; título e texto do asset_feed_spec do que mais investiu.
    assert.deepEqual(dinamico.anuncios.map(x => x.id), ["a4", "a6"]); assert.equal(dinamico.metricas.gasto, 28);
    assert.deepEqual([dinamico.nome, dinamico.titulo, dinamico.texto, dinamico.miniatura], ["Dinâmico planta", "Título dinâmico a4", "Texto dinâmico a4", "https://exemplo.test/a4.jpg"]);
    assert.deepEqual([videoDinamico.titulo, videoDinamico.texto, videoDinamico.ativo], [null, "Texto do vídeo a5", false]);
    assert.equal(videoDinamico.metricas.taxaGancho, 300 * 100 / 900);
    assert.deepEqual(video.anuncios.map(x => x.id), ["a1", "a2"]);
    assert.equal(video.nome, "Vídeo fachada - Captação"); // o anúncio que mais investiu
    assert.deepEqual([video.miniatura, video.titulo, video.texto, video.instagram], ["https://exemplo.test/a1.jpg", "Título a1", "Texto a1", "https://instagram.test/p/a1"]);
    assert.equal(video.ativo, true); // a2 está ativo
    assert.equal(video.metricas.gasto, 150); assert.equal(video.metricas.leads, 5); assert.equal(video.metricas.custoPorLead, 30);
    assert.equal(video.metricas.alcance, 3900); assert.equal(video.metricas.taxaRetencao, 20);
    assert.deepEqual(video.metricas.resultado, { tipo: "lead", valor: 5, custo: 30 });
    assert.equal(video.metricas.qualidade?.qualidade, "AVERAGE");
    assert.deepEqual(video.anuncios[1].campanha, { id: "200", nome: "Topo" });
    assert.deepEqual(video.anuncios[1].conjunto, { id: "j2", nome: "Conjunto B" });
    assert.equal(video.anuncios[1].metricas.gasto, 50); assert.equal(video.crm, null);
    assert.equal(imagem.miniatura, "https://exemplo.test/a3.jpg"); // sem thumbnail, a imagem
    assert.equal(imagem.metricas.taxaGancho, null);
    assert.deepEqual([apagado.nome, apagado.miniatura, apagado.ativo, apagado.anuncios[0].effective_status], ["Anúncio apagado", null, false, "UNKNOWN"]);
    const porId = leituras.filter(l => l.caminho === "act_1/ads" && !daCampanha(l));
    assert.deepEqual(porId.map(l => JSON.parse(l.params.get("filtering")!)[0].value), [["a1", "a2", "a3", "a4", "a5", "a6", "a9"]]);
    assert.ok(porId.every(l => (l.params.get("fields") ?? "").includes("asset_feed_spec{images{hash},videos{video_id},bodies{text},titles{text}}")
      && (l.params.get("fields") ?? "").includes("object_story_spec{link_data{image_hash,message,name,child_attachments{name}},video_data{video_id,message,title}}")));
    assert.ok(camposDe(l => l.params.get("level") === "ad" && !daCampanha(l)).every(f => f.includes("quality_ranking") && f.includes("ad_name")));

    // 51 anúncios: dois lotes, 50 + 1.
    const antesDosLotes = leituras.length;
    const grande = await carregarCriativosAds({ conta: "act_1", inicio: "2026-06-01", fim: "2026-06-02" }, semCrm);
    assert.equal(grande.criativos.length, 51);
    const lotes = leituras.slice(antesDosLotes).filter(l => l.caminho === "act_1/ads").map(l => JSON.parse(l.params.get("filtering")!)[0].value.length);
    assert.deepEqual(lotes, [50, 1]);
  } finally { globalThis.fetch = originalFetch; if (originalToken === undefined) delete process.env.META_SYSTEM_USER_TOKEN; else process.env.META_SYSTEM_USER_TOKEN = originalToken; }
  console.log("Meta Ads: atribuição, leads do CRM, coorte, métricas (mapeamento e soma), ranking, formato, datas, paginação, permissões, relatório (conta e período anterior), gaveta da campanha, criativos por peça e escritas validadas sem alterar a Meta.");
}
void main();
