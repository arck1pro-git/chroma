// As MÉTRICAS e o GASTO de uma campanha de WhatsApp oficial
// (lib/campanhas-metricas.ts e lib/whatsapp-custo.ts) contra o banco DEV,
// pelas funções reais, SEM falar com a Meta: o globalThis.fetch desvia
// graph.facebook.com para uma Graph falsa num servidor node:http local, e
// qualquer outro endereço lança. O token da Meta vira um falso neste processo.
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-campanhas-metricas.ts
//
// O que confere: o funil (entraram, enviados, entregues e lidos casados pelo
// wamid com o status que o webhook gravou, responderam, conversões, falhas,
// descadastros pelos dois caminhos); entregues e lidos só nos blocos de
// template (texto livre não conta); a execução do formato antigo; as falhas
// agrupadas pelo motivo; o custo ok com a conta certa (gasto ÷ entregas, e o
// cost_per_delivered ponderado quando não vem gasto); sem_estatisticas,
// sem_custo, erro e sem_envio; o cache de 1 h; o recorte de 90 dias; mais de
// 10 templates em lotes, com paginação e ids acima de 2^53; e que nada foi
// escrito na Meta (só GET).
//
// MARCA: contatos com whatsapp 5500900773… e campanhas com nome
// "seed-teste-metricas…", pausadas (o motor não as anda). Tudo é apagado no
// finally, só pela marca.
//
// Os imports vão pelo alias "@/": é por ele que o código importa, e o runner
// carregaria uma segunda cópia de cada módulo pelo caminho relativo.
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "@/lib/db";
import { processarWebhookOficial, registrarEnvioOficial } from "@/lib/whatsapp-oficial";
import { metricasDaCampanha } from "@/lib/campanhas-metricas";
import { custoDosTemplates, periodoDoCusto } from "@/lib/whatsapp-custo";
import { NO_INICIO, VERSAO_FLUXO, type FluxoCampanha } from "@/lib/campanhas-fluxo";

const MARCA = "seed-teste-metricas";
const PREFIXO = "5500900773";
const TELEFONE_ID = "990000000000202";
const TELEFONE_EXIBICAO = "5500900778888";
const WABA_OK = "990000000000201";
const WABA_SEM_ESTATISTICAS = "990000000000211";
const WABA_SEM_CUSTO = "990000000000221";
const WABA_ERRO = "990000000000231";
const TOKEN_FALSO = "token-de-teste-metricas";

let passos = 0;
const passo = (nome: string) => {
  passos++;
  console.log(`ok   ${nome}`);
};
const perto = (a: number | null, b: number, msg: string) => {
  // Seis casas: é o arredondamento do dinheiro em lib/campanhas-metricas.ts.
  assert.ok(a !== null && Math.abs(a - b) < 1e-6, `${msg}: veio ${a}, esperado ${b}`);
};

// ── Graph falsa ─────────────────────────────────────────────────────────────

// Ids acima de 2^53: se alguém passar o id por Number, ele chega errado.
const TEMPLATES = Array.from({ length: 12 }, (_, n) => ({
  id: `99000000000${String(n + 10000).padStart(5, "0")}`,
  name: `seed_metricas_${n}`,
  language: "pt_BR",
}));
const indiceDoId = new Map(TEMPLATES.map((t, i) => [t.id, i]));

type Pedido = { metodo: string; caminho: string; params: URLSearchParams; autorizacao: string };
const pedidos: Pedido[] = [];
const analytics = () => pedidos.filter((p) => p.caminho.endsWith("/template_analytics"));

function pontos(id: string, modo: "ok" | "sem_custo") {
  const i = indiceDoId.get(id) ?? -1;
  const base = { template_id: id, start: 1761609600, end: 1761696000, sent: 0, read: 0 };
  if (modo === "sem_custo") return [{ ...base, delivered: 10 }];
  // 0: gasto somado ÷ entregas somadas = 2,2 ÷ 40 = 0,055 (o cpd diário é ignorado).
  if (i === 0)
    return [
      { ...base, delivered: 30, cost: [{ type: "amount_spent", value: 1.5 }, { type: "cost_per_delivered", value: 0.05 }] },
      { ...base, delivered: 10, cost: [{ type: "amount_spent", value: 0.7 }, { type: "cost_per_delivered", value: 0.07 }] },
    ];
  // 1: sem gasto, só o cost_per_delivered, ponderado pelas entregas = 0,15.
  if (i === 1)
    return [
      { ...base, delivered: 20, cost: [{ type: "cost_per_delivered", value: 0.1 }] },
      { ...base, delivered: 20, cost: [{ type: "cost_per_delivered", value: 0.2 }] },
    ];
  // Os outros: 0,01 × (i + 1) por entrega.
  return [{ ...base, delivered: 10, cost: [{ type: "amount_spent", value: 0.1 * (i + 1) }, { type: "cost_per_url_button_click", value: 0.3 }] }];
}

function responder(res: ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(corpo));
}

function graphFalsa(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://graph.local");
  const caminho = url.pathname.replace(/^\/v[\d.]+/, "");
  const metodo = (req.method ?? "GET").toUpperCase();
  pedidos.push({ metodo, caminho, params: url.searchParams, autorizacao: String(req.headers.authorization ?? "") });
  if (metodo !== "GET") return responder(res, 400, { error: { message: `graph falsa só lê: ${metodo} ${caminho}` } });

  if (caminho === "/me/assigned_whatsapp_business_accounts") {
    return responder(res, 200, {
      data: [
        { id: WABA_OK, name: "Teste ok", currency: "BRL" },
        { id: WABA_SEM_ESTATISTICAS, name: "Teste sem estatísticas", currency: "USD" },
        { id: WABA_SEM_CUSTO, name: "Teste sem custo", currency: "USD" },
        { id: WABA_ERRO, name: "Teste erro", currency: "EUR" },
      ],
    });
  }
  const [, waba, aresta] = caminho.split("/");
  if (aresta === "message_templates") return responder(res, 200, { data: TEMPLATES });
  if (!aresta && url.searchParams.get("fields") === "is_enabled_for_insights") {
    return responder(res, 200, { id: waba, is_enabled_for_insights: waba !== WABA_SEM_ESTATISTICAS });
  }
  if (aresta === "template_analytics") {
    if (waba === WABA_SEM_ESTATISTICAS) return responder(res, 400, { error: { message: "(#100) Invalid parameter", code: 100 } });
    if (waba === WABA_ERRO) return responder(res, 500, { error: { message: "Falha interna falsa", code: 2 } });
    const ids = (url.searchParams.get("template_ids") ?? "").match(/\d+/g) ?? [];
    const modo = waba === WABA_SEM_CUSTO ? "sem_custo" : "ok";
    // Duas páginas quando há mais de um id: a primeira só com o primeiro.
    const depois = url.searchParams.get("after");
    const daPagina = ids.length < 2 ? ids : depois === "pagina2" ? ids.slice(1) : ids.slice(0, 1);
    const paging =
      ids.length >= 2 && depois !== "pagina2"
        ? { cursors: { before: "pagina1", after: "pagina2" }, next: `https://graph.facebook.com/v26.0${caminho}?after=pagina2` }
        : { cursors: { before: "pagina1", after: "fim" } };
    return responder(res, 200, {
      data: [{ granularity: "DAILY", product_type: "cloud_api", data_points: daPagina.flatMap((id) => pontos(id, modo)) }],
      paging,
    });
  }
  return responder(res, 404, { error: { message: `graph falsa não conhece ${metodo} ${caminho}` } });
}

let enderecoGraph = "";
const fetchOriginal = globalThis.fetch;
async function fetchDesviado(entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  if (url.hostname === "graph.facebook.com") return fetchOriginal(`${enderecoGraph}${url.pathname}${url.search}`, init);
  throw new Error(`rede bloqueada no teste: ${url.hostname}`);
}

// ── Cenário ─────────────────────────────────────────────────────────────────

const envio = (template: string, proximo: string | null) => ({
  tipo: "enviar_template" as const,
  template_nome: template,
  template_idioma: "pt_BR",
  variaveis: { cabecalho: [], corpo: [] },
  proximo,
});

const FLUXO: FluxoCampanha = {
  versao: VERSAO_FLUXO,
  inicio: "t1",
  blocos: {
    t1: envio("seed_metricas_0", "ag"),
    ag: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [], outra: "tx", sem_resposta: null },
    tx: { tipo: "enviar_texto", texto: "Obrigado!", proximo: "t2" },
    t2: envio("seed_metricas_1", "cv"),
    cv: { tipo: "registrar_conversao", proximo: null },
  },
  posicoes: { [NO_INICIO]: { x: 0, y: 0 } },
};

async function campanha(nome: string, definicao: unknown, ativadaHaDias: number) {
  const [c] = await sql`
    INSERT INTO campanhas_whatsapp (nome, segmento_nome, template_nome, template_idioma, waba_id, telefone_id, telefone_exibicao, status, definicao, ativada_em)
    VALUES (${`${MARCA} ${nome}`}, ${MARCA}, 'seed_metricas_0', 'pt_BR', ${WABA_OK}, ${TELEFONE_ID}, ${TELEFONE_EXIBICAO},
            'pausada', ${sql.json(definicao as never)}, now() - make_interval(days => ${ativadaHaDias}::int))
    RETURNING id`;
  return c.id as string;
}

let contatos = 0;
async function contato() {
  const n = ++contatos;
  const [c] = await sql`INSERT INTO contatos (nome, whatsapp) VALUES (${`${MARCA} ${n}`}, ${`${PREFIXO}${String(n).padStart(3, "0")}`}) RETURNING id`;
  return c.id as string;
}

type Execucao = {
  estado?: string;
  wamid?: string | null;
  enviado?: boolean;
  respondeu?: boolean;
  conversao?: boolean;
  erro?: string | null;
  saida?: string | null;
  bloco?: string | null;
};

async function execucao(campanhaId: string, contatoId: string, e: Execucao = {}) {
  const [x] = await sql`
    INSERT INTO campanha_whatsapp_execucoes
      (campanha_id, contato_id, estado, bloco_atual, mensagem_id_meta, enviado_em, respondeu_em, conversao, erro, resposta_saida)
    VALUES (${campanhaId}::uuid, ${contatoId}::uuid, ${e.estado ?? "concluida"}, ${e.bloco ?? null}, ${e.wamid ?? null},
            CASE WHEN ${!!e.enviado}::boolean THEN now() END, CASE WHEN ${!!e.respondeu}::boolean THEN now() END,
            ${!!e.conversao}, ${e.erro ?? null}, ${e.saida ?? null})
    RETURNING id`;
  return x.id as string;
}

async function evento(campanhaId: string, execucaoId: string, tipo: string, detalhe: Record<string, unknown>) {
  await sql`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
            VALUES (${campanhaId}::uuid, ${execucaoId}::uuid, ${tipo}, ${sql.json(detalhe as never)})`;
}

/** O envio de um bloco como o motor deixa: evento com o wamid e a linha na conversa (status 'enviado'). */
async function enviou(campanhaId: string, execucaoId: string, contatoId: string, bloco: string, tipo: string, wamid: string) {
  await evento(campanhaId, execucaoId, "bloco", { bloco, tipo, saida: "proximo", ok: true, wamid });
  await registrarEnvioOficial({ contatoId, numeroCanal: TELEFONE_EXIBICAO, texto: `${MARCA} ${bloco}`, wamid, enviadaPor: "automacao" });
}

async function limpar() {
  await sql`DELETE FROM campanhas_whatsapp WHERE nome LIKE ${MARCA + "%"}`;
  await sql`DELETE FROM contatos WHERE whatsapp LIKE ${PREFIXO + "%"} AND nome LIKE ${MARCA + "%"}`;
}

const w = (n: string) => `wamid.${MARCA}.${n}`;

// ── Partes ──────────────────────────────────────────────────────────────────

function partePeriodo() {
  assert.deepEqual(periodoDoCusto(new Date("2026-10-20T15:00:00Z"), new Date("2026-10-28T02:00:00Z")), {
    start: "2026-10-20",
    end: "2026-10-29",
  });
  // 2026-10-28 − 89 dias = 2026-07-31: o período nunca passa de 90 dias.
  assert.deepEqual(periodoDoCusto(new Date("2026-01-01T00:00:00Z"), new Date("2026-10-28T23:59:00Z")), {
    start: "2026-07-31",
    end: "2026-10-29",
  });
  passo("período: do início da campanha até amanhã (UTC), recortado em 90 dias");
}

async function parteCampanha() {
  const id = await campanha("principal", FLUXO, 200);
  const c = await Promise.all(Array.from({ length: 10 }, () => contato()));

  // e1: template lido, respondeu, converteu; e mais um texto livre lido (não conta).
  const e1 = await execucao(id, c[0], { wamid: w("1"), enviado: true, respondeu: true, conversao: true });
  await enviou(id, e1, c[0], "t1", "enviar_template", w("1"));
  await enviou(id, e1, c[0], "tx", "enviar_texto", w("texto"));
  // e2: entregue e respondeu.
  const e2 = await execucao(id, c[1], { wamid: w("2"), enviado: true, respondeu: true });
  await enviou(id, e2, c[1], "t1", "enviar_template", w("2"));
  // e3: só enviado, aguardando no "ag".
  const e3 = await execucao(id, c[2], { estado: "aguardando_resposta", bloco: "ag", wamid: w("3"), enviado: true });
  await enviou(id, e3, c[2], "t1", "enviar_template", w("3"));
  // e4: a Meta aceitou e depois não entregou (o webhook a faz falhar com o motivo).
  const e4 = await execucao(id, c[3], { estado: "aguardando_resposta", bloco: "ag", wamid: w("4"), enviado: true });
  await enviou(id, e4, c[3], "t1", "enviar_template", w("4"));
  // e5, e6: o motor recusou antes da Meta, com o mesmo motivo.
  await execucao(id, c[4], { estado: "falhou", bloco: "t1", erro: "Contato sem nome." });
  await execucao(id, c[5], { estado: "falhou", bloco: "t1", erro: "Contato sem nome." });
  // e7: entregue e saiu pelo descadastro no Aguardar.
  const e7 = await execucao(id, c[6], { wamid: w("5"), enviado: true, respondeu: true, saida: "descadastro" });
  await enviou(id, e7, c[6], "t1", "enviar_template", w("5"));
  // e8: encerrada pelo "sair" mandado a outra campanha do número.
  const e8 = await execucao(id, c[7], { estado: "concluida" });
  await evento(id, e8, "descadastro", { bloco: null });
  // e9: inscrita, na fila.
  await execucao(id, c[8], { estado: "na_fila" });
  // e10: os dois templates — t1 entregue, t2 lido.
  const e10 = await execucao(id, c[9], { wamid: w("6"), enviado: true });
  await enviou(id, e10, c[9], "t1", "enviar_template", w("7"));
  await enviou(id, e10, c[9], "t2", "enviar_template", w("6"));

  // Os status pelo caminho real do webhook da Meta.
  const st = (n: string, status: string, extra: Record<string, unknown> = {}) => ({ id: w(n), status, ...extra });
  await processarWebhookOficial({
    statuses: [
      st("1", "delivered"), st("1", "read"),
      st("2", "delivered"),
      st("4", "failed", { errors: [{ code: 131026, title: "Message undeliverable" }] }),
      st("5", "delivered"),
      st("7", "delivered"),
      st("6", "delivered"), st("6", "read"),
      st("texto", "read"),
    ],
  });

  const m = await metricasDaCampanha(id);
  assert.ok(m, "a campanha existe");
  console.log("     funil:", JSON.stringify(m.funil));
  assert.deepEqual(m.funil, {
    entraram: 10,
    enviados: 6,
    // Cinco mensagens entregues, quatro contatos (e10 recebeu os dois templates).
    entregues: 4,
    lidos: 2,
    responderam: 3,
    conversoes: 1,
    falhas: 3,
    descadastros: 2,
  });
  passo("funil: entregues e lidos pelo wamid (texto livre fora), falha do webhook, descadastro pelos dois caminhos");

  console.log("     porBloco:", JSON.stringify(m.porBloco));
  assert.deepEqual(m.porBloco.t1, { agora: 1, passaram: 6, entregues: 4, lidos: 1 });
  assert.deepEqual(m.porBloco.t2, { agora: 0, passaram: 1, entregues: 1, lidos: 1 });
  assert.equal(m.porBloco.ag.entregues, null, "Aguardar não tem entregues");
  assert.equal(m.porBloco.ag.agora, 1, "e3 aguardando (e4 falhou pelo webhook)");
  assert.equal(m.porBloco.tx.entregues, null, "texto livre não tem entregues");
  passo("porBloco: agora e passaram do canvas; entregues e lidos só nos blocos de template");

  console.log("     falhasPorMotivo:", JSON.stringify(m.falhasPorMotivo));
  assert.deepEqual(m.falhasPorMotivo, [
    { motivo: "Contato sem nome.", n: 2 },
    { motivo: "Message undeliverable (131026)", n: 1 },
  ]);
  passo("falhasPorMotivo: o erro das execuções 'falhou', do mais comum ao menos");

  // Custo: t1 = seed_metricas_0 (0,055) × 4 entregues; t2 = seed_metricas_1 (0,15) × 1.
  console.log("     custo:", JSON.stringify(m.custo));
  assert.equal(m.custo.situacao, "ok");
  assert.equal(m.custo.moeda, "BRL");
  assert.equal(m.custo.aviso, null);
  const [a, b] = m.custo.porTemplate;
  assert.equal(a.template, "seed_metricas_0");
  assert.equal(a.entregues, 4);
  perto(a.custoPorEntrega, 0.055, "custo por entrega com gasto");
  perto(a.total, 0.22, "total do template 0");
  assert.equal(b.template, "seed_metricas_1");
  assert.equal(b.entregues, 1);
  perto(b.custoPorEntrega, 0.15, "cost_per_delivered ponderado");
  perto(m.custo.total, 0.37, "total");
  perto(m.custo.porResposta, 0.37 / 3, "por resposta");
  perto(m.custo.porConversao, 0.37, "por conversão");
  passo("custo ok: gasto ÷ entregas da Meta × entregues da campanha, por resposta e por conversão, moeda da conta");

  const pedidosDoCusto = analytics();
  assert.equal(pedidosDoCusto.length, 2, "um pedido de 2 ids, em duas páginas");
  const primeiro = pedidosDoCusto[0].params;
  assert.equal(primeiro.get("granularity"), "DAILY");
  assert.equal(primeiro.get("metric_types"), '["COST","DELIVERED"]');
  assert.equal(primeiro.get("template_ids"), `[${TEMPLATES[0].id},${TEMPLATES[1].id}]`, "ids inteiros, sem passar por Number");
  const hoje = new Date();
  const limite = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()) - 89 * 86_400_000).toISOString().slice(0, 10);
  assert.equal(primeiro.get("start"), limite, "ativada há 200 dias: recortada em 90");
  assert.equal(pedidosDoCusto[1].params.get("after"), "pagina2", "seguiu a paginação");
  console.log(`     pedido: GET /${WABA_OK}/template_analytics?${primeiro.toString()}`);
  passo("90 dias: o start é hoje − 89 dias (UTC) para a campanha de 200 dias; paginação seguida");

  const antes = pedidos.length;
  const deNovo = await metricasDaCampanha(id);
  assert.equal(pedidos.length, antes, "nenhuma ida à Graph na segunda leitura");
  assert.equal(deNovo?.custo.atualizadoEm, m.custo.atualizadoEm);
  passo("cache: a segunda leitura não vai à Meta e mantém o atualizadoEm");

  // As outras situações, pela mesma campanha em outras contas.
  const naConta = async (waba: string) => {
    await sql`UPDATE campanhas_whatsapp SET waba_id = ${waba} WHERE id = ${id}::uuid`;
    const r = await metricasDaCampanha(id);
    assert.ok(r);
    console.log(`     ${waba}:`, JSON.stringify({ situacao: r.custo.situacao, moeda: r.custo.moeda, total: r.custo.total, aviso: r.custo.aviso }));
    return r.custo;
  };
  const semEstatisticas = await naConta(WABA_SEM_ESTATISTICAS);
  assert.equal(semEstatisticas.situacao, "sem_estatisticas");
  assert.equal(semEstatisticas.total, null);
  assert.equal(semEstatisticas.moeda, "USD");
  assert.ok(semEstatisticas.porTemplate.every((p) => p.custoPorEntrega === null && p.total === null));
  assert.ok(pedidos.some((p) => p.caminho === `/${WABA_SEM_ESTATISTICAS}` && p.params.get("fields") === "is_enabled_for_insights"));
  passo("sem_estatisticas: a Graph recusa e a conta diz is_enabled_for_insights = false (só lido)");

  const semCusto = await naConta(WABA_SEM_CUSTO);
  assert.equal(semCusto.situacao, "sem_custo");
  assert.equal(semCusto.total, null);
  assert.match(semCusto.aviso ?? "", /não informa o custo/);
  passo("sem_custo: pontos sem cost (linha de crédito de parceiro)");

  const comErro = await naConta(WABA_ERRO);
  assert.equal(comErro.situacao, "erro");
  assert.equal(comErro.total, null);
  assert.match(comErro.aviso ?? "", /Falha interna falsa/);
  const errosAntes = analytics().filter((p) => p.caminho.startsWith(`/${WABA_ERRO}/`)).length;
  await naConta(WABA_ERRO);
  assert.equal(analytics().filter((p) => p.caminho.startsWith(`/${WABA_ERRO}/`)).length, errosAntes + 1, "falha não fica guardada");
  passo("erro: a Graph falha, a métrica sai com situação erro e aviso; a falha não fica no cache");

  await sql`UPDATE campanhas_whatsapp SET waba_id = ${WABA_OK} WHERE id = ${id}::uuid`;
}

async function parteFormatoAntigo() {
  // Definição do formato de antes (sem versão): o template vem das colunas, e o envio é o bloco "envio".
  const id = await campanha("antiga", { espera_minutos: 60, ao_responder: [], ao_expirar: [] }, 3);
  const c = await contato();
  const e = await execucao(id, c, { estado: "expirou", wamid: w("antiga"), enviado: true });
  await evento(id, e, "mensagem_enviada", {});
  await registrarEnvioOficial({ contatoId: c, numeroCanal: TELEFONE_EXIBICAO, texto: `${MARCA} antiga`, wamid: w("antiga"), enviadaPor: "automacao" });
  await processarWebhookOficial({ statuses: [{ id: w("antiga"), status: "delivered" }] });
  const m = await metricasDaCampanha(id);
  assert.ok(m);
  assert.equal(m.funil.entregues, 1);
  assert.deepEqual(m.porBloco.envio, { agora: 0, passaram: 1, entregues: 1, lidos: 0 });
  assert.equal(m.custo.situacao, "ok");
  assert.equal(m.custo.porTemplate.length, 1);
  perto(m.custo.total, 0.055, "total da antiga");
  passo("formato antigo: o wamid da execução conta no bloco 'envio' e no gasto do template das colunas");
}

async function parteSemEnvio() {
  const id = await campanha("sem envio", FLUXO, 1);
  await execucao(id, await contato(), { estado: "na_fila" });
  const antes = pedidos.length;
  const m = await metricasDaCampanha(id);
  assert.ok(m);
  assert.equal(m.custo.situacao, "sem_envio");
  assert.equal(m.custo.total, null);
  assert.equal(pedidos.length, antes, "sem entrega não vai à Meta");
  assert.equal(await metricasDaCampanha("00000000-0000-0000-0000-000000000000"), null, "campanha que não existe");
  passo("sem_envio: nada entregue, nada pedido à Meta; campanha inexistente devolve null");
}

async function parteLotes() {
  const antes = analytics().length;
  const r = await custoDosTemplates({
    wabaId: WABA_OK,
    templates: TEMPLATES.map((t) => ({ nome: t.name, idioma: t.language })),
    desde: new Date(Date.now() - 5 * 86_400_000),
  });
  const novos = analytics().slice(antes).filter((p) => !p.params.get("after"));
  const tamanhos = novos.map((p) => (p.params.get("template_ids") ?? "").match(/\d+/g)?.length ?? 0);
  console.log("     lotes:", JSON.stringify(tamanhos));
  assert.deepEqual(tamanhos, [10, 2]);
  const pedidosIds = new Set(novos.flatMap((p) => (p.params.get("template_ids") ?? "").match(/\d+/g) ?? []));
  assert.deepEqual([...pedidosIds].sort(), TEMPLATES.map((t) => t.id).sort(), "os 12 ids, inteiros");
  assert.equal(r.situacao, "ok");
  for (let i = 2; i < TEMPLATES.length; i++) perto(r.custoPorEntrega.get(`${TEMPLATES[i].name}|pt_BR`) ?? null, 0.01 * (i + 1), `template ${i}`);
  perto(r.custoPorEntrega.get("seed_metricas_0|pt_BR") ?? null, 0.055, "template 0");
  passo("mais de 10 templates: lotes de 10 e 2, cada um com a sua paginação");
}

// ── Roda ────────────────────────────────────────────────────────────────────

async function principal() {
  const servidor = createServer(graphFalsa);
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  enderecoGraph = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  process.env.META_SYSTEM_USER_TOKEN = TOKEN_FALSO;
  globalThis.fetch = fetchDesviado as typeof fetch;
  try {
    await limpar();
    partePeriodo();
    await parteCampanha();
    await parteFormatoAntigo();
    await parteSemEnvio();
    await parteLotes();
    assert.ok(pedidos.every((p) => p.metodo === "GET"), "nada escrito na Meta");
    assert.ok(pedidos.every((p) => p.autorizacao === `Bearer ${TOKEN_FALSO}`), "só o token falso saiu");
    passo("só leituras (GET) e só com o token falso");
    console.log(`\nOK: ${passos} partes conferidas (${pedidos.length} pedidos à Graph falsa, ${analytics().length} ao template_analytics).`);
  } finally {
    globalThis.fetch = fetchOriginal;
    await limpar();
    const [sobra] = await sql`
      SELECT (SELECT count(*)::int FROM campanhas_whatsapp WHERE nome LIKE ${MARCA + "%"}) AS campanhas,
             (SELECT count(*)::int FROM contatos WHERE whatsapp LIKE ${PREFIXO + "%"}) AS contatos`;
    console.log(`limpeza: ${sobra.campanhas} campanhas e ${sobra.contatos} contatos da marca restantes`);
    await new Promise<void>((ok) => servidor.close(() => ok()));
    await sql.end();
  }
}

principal().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
