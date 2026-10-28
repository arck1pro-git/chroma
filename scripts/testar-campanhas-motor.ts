// O MOTOR das campanhas de WhatsApp em blocos (lib/campanhas-whatsapp.ts)
// contra o banco DEV, pelas funções reais, SEM falar com ninguém: o
// globalThis.fetch vira uma Graph e uma uazapi falsas, e qualquer outro
// endereço lança.
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-campanhas-motor.ts
//
// O que confere: a forma da entrada (ids, protótipo) e a permissão; reserva
// única com duas rodadas ao mesmo tempo; o laço de passos (26 blocos seguidos
// falham); o "Esperar"; o envio do template (payload `cw:` nos botões) e a
// trava de ambiente; envio interrompido não é reenviado; a resposta por payload,
// por citação (inclusive de um envio anterior) e sem citação; citação que não
// casa não cai na regra sem citação; reentrega, reação e resposta antiga
// ignoradas; descadastro; prazo vencido; a IA ligada pelo fluxo; avisos à
// equipe agrupados por pessoa; uma campanha aguardando por contato e número;
// execução do formato antigo aguardando (nem reenvio, nem recomeço); campanha
// antiga gravada como string segue com os padrões; edição com bloco apagado;
// extração do webhook (botão, citação, reentrega).
//
// Das revisões de 2026-10-28: o filtro da IA calada (puro); mídia como
// resposta; clique em botão de template anterior vale como texto; citação do
// texto livre; execução em andamento segura a fila de outra campanha no mesmo
// número; duas rodadas de campanhas diferentes com o mesmo contato (a trava do
// par contato+número); a entrada do Aguardar; descadastro em todas as
// execuções do número; resposta durante a pausa e retomada; retomar inscreve
// quem entrou na pausa e confere a definição; inscrição sem teto (300
// contatos); id aposentado; IA já escolhida não é trocada; resposta adiantada.
//
// TRAVA DE AMBIENTE: com WHATSAPP_SO_PARA ativa (o .env do dev), os números de
// teste não passam — e o teste NÃO a contorna. Nesse caso o envio do template
// é conferido pela recusa (a execução falha com "bloqueado" e nada chega à
// Graph) e os avisos pela contagem de tentativas por pessoa. As respostas usam
// execuções semeadas no estado de quem já recebeu o template.
//
// MARCA: contatos com whatsapp 5500900771…, campanhas, tags, segmentos, IAs e
// usuários com nome "seed-teste-campanha…". Tudo é apagado no finally, só pela
// marca. Não roda se houver no DEV campanha ativa de verdade com aviso pendente
// ou execução presa (as rodadas globais mexeriam nelas).
//
// Os imports vão pelo alias "@/": é por ele que o código importa, e o runner
// carregaria uma segunda cópia de cada módulo pelo caminho relativo.
import assert from "node:assert/strict";
import { sql } from "@/lib/db";
import { conferirDestino } from "@/lib/destino-permitido";
import { instanciasParaAviso } from "@/lib/aviso-equipe-whatsapp";
import { instanciasPorId } from "@/lib/uazapi";
import { processarWebhookOficial, type MensagemRecebida } from "@/lib/whatsapp-oficial";
import {
  avancarExecucao,
  contatosNosSegmentos,
  enviarAvisosPendentes,
  inscreverDosSegmentos,
  metricasDasCampanhas,
  processarExpirados,
  processarFila,
  recuperarPresas,
  registrarResposta,
  retomarCampanha,
  salvarEdicao,
} from "@/lib/campanhas-whatsapp";
import { conferirFluxo, faltasDePermissao, lerDefinicao, lerFluxoDaEntrada } from "@/lib/campanhas-fluxo-entrada";
import { campanhaFalaAntesDeEsperar, iaResponde } from "@/lib/campanhas-fluxo-envios";
import { NO_INICIO, VERSAO_FLUXO, type BlocoCampanha, type FluxoCampanha } from "@/lib/campanhas-fluxo";

const MARCA = "seed-teste-campanha";
const WABA = "990000000000001";
const TELEFONE_ID = "990000000000002";
const OUTRO_TELEFONE_ID = "990000000000003";
const TELEFONE_EXIBICAO = "5500900779999";
const PREFIXO = "5500900771";
const numero = (n: number) => `${PREFIXO}0${String(n).padStart(2, "0")}`;
/** Só vai no detalhe do evento de edição (sem chave estrangeira). */
const QUEM_EDITA = "00000000-0000-0000-0000-000000000000";

let passos = 0;
const passo = (nome: string) => {
  passos++;
  console.log(`ok   ${nome}`);
};

// ── Rede falsa ──────────────────────────────────────────────────────────────

const TEMPLATE = {
  id: "9900",
  name: "convite",
  language: "pt_BR",
  status: "APPROVED",
  category: "MARKETING",
  components: [
    { type: "BODY", text: "Olá {{1}}, temos novidades para você.", example: { body_text: [["Ana"]] } },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero saber mais" }, { type: "QUICK_REPLY", text: "Não tenho interesse" }] },
  ],
};

const graph: Array<{ metodo: string; caminho: string; corpo: Record<string, unknown> | null }> = [];
const uazapi: Array<{ corpo: Record<string, unknown> }> = [];
let hostUazapi = "";
let wamids = 0;
const enviosMeta = () => graph.filter((g) => g.metodo === "POST" && g.caminho.endsWith("/messages"));

const fetchOriginal = globalThis.fetch;
async function fetchFalso(entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  const metodo = (init?.method ?? "GET").toUpperCase();
  const corpo = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  if (url.hostname === "graph.facebook.com") {
    const caminho = url.pathname.replace(/^\/v[\d.]+/, "");
    graph.push({ metodo, caminho, corpo });
    if (metodo === "GET" && caminho === `/${WABA}/message_templates`)
      return Response.json({ data: [TEMPLATE, { ...TEMPLATE, id: "9901", name: "convite_pendente", status: "PENDING" }] });
    if (metodo === "GET" && caminho === `/${WABA}/phone_numbers`)
      return Response.json({ data: [{ id: TELEFONE_ID, display_phone_number: TELEFONE_EXIBICAO, verified_name: "Teste" }] });
    if (metodo === "POST" && caminho === `/${TELEFONE_ID}/messages`) return Response.json({ messages: [{ id: `wamid.TESTE.${++wamids}` }] });
    return Response.json({ error: { message: `graph falsa não conhece ${metodo} ${caminho}` } }, { status: 404 });
  }
  if (hostUazapi && url.host === hostUazapi) {
    uazapi.push({ corpo: corpo ?? {} });
    return Response.json({ messageid: `uaz-${uazapi.length}` });
  }
  throw new Error(`rede bloqueada no teste: ${url.hostname}`);
}

// ── Cenário ─────────────────────────────────────────────────────────────────

const fluxo = (inicio: string, blocos: Record<string, BlocoCampanha>): FluxoCampanha => ({
  versao: VERSAO_FLUXO,
  inicio,
  blocos,
  posicoes: { [NO_INICIO]: { x: 0, y: 0 } },
});

async function campanha(nome: string, definicao: unknown, opcoes: { status?: string; telefoneId?: string; comoTexto?: boolean } = {}) {
  const [c] = await sql`
    INSERT INTO campanhas_whatsapp (nome, segmento_nome, template_nome, template_idioma, waba_id, telefone_id, telefone_exibicao, status, definicao)
    VALUES (${`${MARCA} ${nome}`}, ${MARCA}, 'convite', 'pt_BR', ${WABA}, ${opcoes.telefoneId ?? TELEFONE_ID}, ${TELEFONE_EXIBICAO},
            ${opcoes.status ?? "ativa"}, ${sql.json(definicao as never)})
    RETURNING id`;
  // Como a campanha ativada antes de 2026-10-27: a definição gravada como STRING JSON.
  if (opcoes.comoTexto) await sql`UPDATE campanhas_whatsapp SET definicao = to_jsonb(${JSON.stringify(definicao)}::text) WHERE id = ${c.id}`;
  return c.id as string;
}

let contatos = 0;
async function contato(nome = `${MARCA} Ana`) {
  const n = ++contatos;
  const [c] = await sql`INSERT INTO contatos (nome, whatsapp) VALUES (${nome}, ${numero(n)}) RETURNING id, whatsapp`;
  return { id: c.id as string, whatsapp: c.whatsapp as string };
}

async function inscrever(
  campanhaId: string,
  contatoId: string,
  c: { estado?: string; bloco?: string | null; wamid?: string | null; enviadoHaMin?: number | null; prazoEmMin?: number | null } = {},
) {
  const [e] = await sql`
    INSERT INTO campanha_whatsapp_execucoes (campanha_id, contato_id, estado, bloco_atual, mensagem_id_meta, enviado_em, prazo_resposta)
    VALUES (${campanhaId}::uuid, ${contatoId}::uuid, ${c.estado ?? "na_fila"}, ${c.bloco ?? null}, ${c.wamid ?? null},
            CASE WHEN ${c.enviadoHaMin ?? null}::int IS NULL THEN NULL ELSE now() - make_interval(mins => ${c.enviadoHaMin ?? 0}::int) END,
            CASE WHEN ${c.prazoEmMin ?? null}::int IS NULL THEN NULL ELSE now() + make_interval(mins => ${c.prazoEmMin ?? 0}::int) END)
    RETURNING id`;
  return e.id as string;
}

/** Uma execução no estado de quem já recebeu o template e está no "Aguardar" (o envio real depende da trava). */
async function aguardando(campanhaId: string, contatoId: string, wamids: string[], c: { enviadoHaMin?: number; prazoEmMin?: number } = {}) {
  const id = await inscrever(campanhaId, contatoId, {
    estado: "aguardando_resposta",
    bloco: "aguardar",
    wamid: wamids[wamids.length - 1],
    enviadoHaMin: c.enviadoHaMin ?? 1,
    prazoEmMin: c.prazoEmMin ?? 60,
  });
  for (const w of wamids) await evento(campanhaId, id, "bloco", { bloco: "envio", tipo: "enviar_template", saida: "proximo", ok: true, wamid: w });
  await evento(campanhaId, id, "bloco", { bloco: "aguardar", tipo: "aguardar_resposta", ok: true });
  return id;
}

async function evento(campanhaId: string, execucaoId: string, tipo: string, detalhe: Record<string, unknown>) {
  await sql`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
            VALUES (${campanhaId}::uuid, ${execucaoId}::uuid, ${tipo}, ${sql.json(detalhe as never)})`;
}

async function execucao(id: string) {
  const [e] = await sql`SELECT * FROM campanha_whatsapp_execucoes WHERE id = ${id}::uuid`;
  return e as Record<string, unknown> & { estado: string; bloco_atual: string | null; resposta_saida: string | null; erro: string | null };
}

async function eventos(id: string) {
  return (await sql`SELECT tipo, detalhe FROM campanha_whatsapp_eventos WHERE execucao_id = ${id}::uuid ORDER BY id`) as Array<{
    tipo: string;
    detalhe: Record<string, unknown>;
  }>;
}

async function temTag(contatoId: string, tagId: string) {
  const [r] = await sql`SELECT 1 FROM contato_tags WHERE contato_id = ${contatoId}::uuid AND tag_id = ${tagId}::uuid`;
  return !!r;
}

const msg = (p: Partial<MensagemRecebida> & { numero: string; id: string }): MensagemRecebida => ({
  nova: true,
  tipo: "text",
  texto: "",
  botaoTexto: null,
  botaoPayload: null,
  contextoId: null,
  phoneNumberId: TELEFONE_ID,
  timestamp: Math.floor(Date.now() / 1000),
  ...p,
});

const tag = (tagId: string, proximo: string | null, acao: "adicionar" | "remover" = "adicionar"): BlocoCampanha => ({
  tipo: "mudar_tag",
  acao,
  tagId,
  proximo,
});
const envio = (proximo: string | null, template = "convite"): BlocoCampanha => ({
  tipo: "enviar_template",
  template_nome: template,
  template_idioma: "pt_BR",
  variaveis: { cabecalho: [], corpo: ["{{primeiro_nome}}"] },
  proximo,
});

async function limpar() {
  await sql`DELETE FROM oportunidades WHERE contato_id IN (SELECT id FROM contatos WHERE whatsapp LIKE ${PREFIXO + "%"})`;
  await sql`DELETE FROM campanhas_whatsapp WHERE nome LIKE ${MARCA + "%"}`;
  await sql`DELETE FROM contatos WHERE whatsapp LIKE ${PREFIXO + "%"}`;
  await sql`DELETE FROM tags WHERE nome LIKE ${MARCA + "%"}`;
  await sql`DELETE FROM segmentos WHERE nome LIKE ${MARCA + "%"}`;
  await sql`DELETE FROM usuarios WHERE nome LIKE ${MARCA + "%"}`;
  await sql`DELETE FROM ias WHERE nome LIKE ${MARCA + "%"}`;
}

// ── Partes ──────────────────────────────────────────────────────────────────

type Ids = { tagA: string; tagB: string; tagC: string; tagD: string; segmento: string; funil: string; etapa1: string; etapa2: string; ia: string };

function parteEntrada(ids: Ids) {
  const valido = fluxo("t", { t: tag(ids.tagA, null) });
  assert.equal(lerFluxoDaEntrada(valido).ok, true);
  const comConstrutor = { ...valido, inicio: "constructor", blocos: { constructor: tag(ids.tagA, null) } };
  const r = lerFluxoDaEntrada(comConstrutor);
  assert.equal(r.ok, false, "id 'constructor' é recusado");
  const proto = JSON.parse(`{"versao":2,"inicio":"t","blocos":{"t":${JSON.stringify(tag(ids.tagA, "__proto__"))}},"posicoes":{}}`);
  assert.equal(lerFluxoDaEntrada(proto).ok, false, "destino '__proto__' é recusado");
  assert.equal(lerFluxoDaEntrada({ ...valido, blocos: { t: { ...tag(ids.tagA, null), tagId: "nao-e-uuid" } } }).ok, false, "tag não uuid");
  assert.equal(lerFluxoDaEntrada({ ...valido, blocos: { t: { tipo: "esperar", minutos: 7.5, proximo: null } } }).ok, false, "prazo não inteiro");
  passo("entrada: id no padrão, nada do Object.prototype, uuid e minuto inteiro");

  const mover = fluxo("m", { m: { tipo: "mover_oportunidade", funilId: ids.funil, etapaId: ids.etapa1, proximo: null } });
  const soCampanhas = { modulos: new Map([["campanhas", "todos"]]), permissoes: { campanhas: { criar: true, editar: true, excluir: false } } };
  assert.equal(faltasDePermissao(mover, soCampanhas as never).length, 1, "só Campanhas não move card");
  const inicioProprio = { modulos: new Map([["inicio", "proprio"]]), permissoes: { inicio: { criar: true, editar: true, excluir: false } } };
  assert.equal(faltasDePermissao(mover, inicioProprio as never).length, 1, "escopo próprio não move card de colega");
  const inicioTodos = { modulos: new Map([["inicio", "todos"]]), permissoes: { inicio: { criar: true, editar: true, excluir: false } } };
  assert.equal(faltasDePermissao(mover, inicioTodos as never).length, 0);
  passo("permissão: o fluxo exige da sessão o que os blocos fazem");
}

async function parteRodada(ids: Ids) {
  const f = fluxo("tag", {
    tag: tag(ids.tagA, "seg"),
    seg: { tipo: "mudar_segmento", acao: "adicionar", segmentoId: ids.segmento, proximo: "conv" },
    conv: { tipo: "registrar_conversao", proximo: "criar" },
    criar: { tipo: "criar_oportunidade", funilId: ids.funil, etapaId: ids.etapa1, nome: "{{nome}} pela campanha", proximo: "mover" },
    mover: { tipo: "mover_oportunidade", funilId: ids.funil, etapaId: ids.etapa2, proximo: "tira" },
    tira: tag(ids.tagA, null, "remover"),
  });
  const c = await campanha("rodada", f);
  const pessoas = [await contato(), await contato(), await contato()];
  const execs = await Promise.all(pessoas.map((p) => inscrever(c, p.id)));
  // Duas rodadas ao mesmo tempo: cada execução anda uma vez só.
  await Promise.all([processarFila(50, c), processarFila(50, c)]);
  for (const [i, id] of execs.entries()) {
    const e = await execucao(id);
    assert.equal(e.estado, "concluida", "execução concluída");
    assert.equal(e.conversao, true);
    const blocos = (await eventos(id)).filter((x) => x.tipo === "bloco").map((x) => x.detalhe.bloco);
    assert.deepEqual(blocos, ["tag", "seg", "conv", "criar", "mover", "tira"], "cada bloco uma vez, em ordem");
    assert.ok((await eventos(id)).filter((x) => x.tipo === "bloco").every((x) => x.detalhe.ok === true));
    assert.equal(await temTag(pessoas[i].id, ids.tagA), false, "tag posta e tirada");
    const [s] = await sql`SELECT 1 FROM contato_segmentos WHERE contato_id = ${pessoas[i].id}::uuid AND segmento_id = ${ids.segmento}::uuid`;
    assert.ok(s, "segmento posto");
    const [op] = await sql`SELECT nome, etapa_id FROM oportunidades WHERE contato_id = ${pessoas[i].id}::uuid`;
    assert.equal(op.etapa_id, ids.etapa2, "oportunidade criada e movida");
    assert.equal(op.nome, `${MARCA} Ana pela campanha`);
    const [h] = await sql`SELECT descricao FROM historico WHERE contato_id = ${pessoas[i].id}::uuid AND descricao LIKE 'Movida de%'`;
    assert.match(h.descricao, /pela campanha "seed-teste-campanha rodada"/);
  }
  passo("rodada: reserva única com duas rodadas juntas; tag, segmento, conversão, criar e mover");

  // 26 blocos imediatos seguidos: o 26º não roda e a execução falha.
  const cadeia: Record<string, BlocoCampanha> = {};
  for (let i = 1; i <= 26; i++) cadeia[`c${i}`] = { tipo: "registrar_conversao", proximo: i < 26 ? `c${i + 1}` : null };
  const c2 = await campanha("laço", fluxo("c1", cadeia));
  const id2 = await inscrever(c2, (await contato()).id);
  await processarFila(5, c2);
  const e2 = await execucao(id2);
  assert.equal(e2.estado, "falhou");
  assert.match(e2.erro ?? "", /Passou de 25 blocos/);
  const ev2 = (await eventos(id2)).filter((x) => x.tipo === "bloco");
  assert.equal(ev2.filter((x) => x.detalhe.ok === true).length, 25);
  assert.equal(ev2.at(-1)?.detalhe.bloco, "c26");
  await processarFila(5, c2);
  assert.equal((await eventos(id2)).filter((x) => x.tipo === "bloco").length, 26, "falhou e não continua na rodada seguinte");
  passo("laço de passos: 25 blocos por rodada, o estouro falha e não continua");

  // Esperar: estaciona, não anda antes da hora, anda depois.
  const c3 = await campanha("esperar", fluxo("t", { t: tag(ids.tagB, "e"), e: { tipo: "esperar", minutos: 5, proximo: "fim" }, fim: { tipo: "registrar_conversao", proximo: null } }));
  const p3 = await contato();
  const id3 = await inscrever(c3, p3.id);
  await processarFila(5, c3);
  let e3 = await execucao(id3);
  assert.equal(e3.estado, "em_andamento");
  assert.equal(e3.bloco_atual, "e");
  await processarFila(5, c3);
  assert.equal((await execucao(id3)).estado, "em_andamento", "não anda antes do prazo");
  await sql`UPDATE campanha_whatsapp_execucoes SET prazo_resposta = now() - interval '1 second' WHERE id = ${id3}::uuid`;
  await processarFila(5, c3);
  e3 = await execucao(id3);
  assert.equal(e3.estado, "concluida");
  assert.equal(e3.conversao, true);
  const ev3 = (await eventos(id3)).filter((x) => x.tipo === "bloco").map((x) => `${x.detalhe.bloco}:${x.detalhe.saida ?? "-"}`);
  assert.deepEqual(ev3, ["t:proximo", "e:-", "e:proximo", "fim:proximo"]);
  passo("esperar: estaciona no bloco, respeita o prazo e segue uma vez");
}

async function parteEnvio(ids: Ids, travaAtiva: boolean) {
  const f = fluxo("envio", {
    envio: envio("aguardar"),
    aguardar: {
      tipo: "aguardar_resposta",
      prazo_minutos: 60,
      botoes: { "Quero saber mais": "tq", "Não tenho interesse": null },
      palavras: [{ contem: "preço", proximo: "tp" }],
      outra: "to",
      sem_resposta: "ts",
    },
    tq: tag(ids.tagA, null),
    tp: tag(ids.tagB, null),
    to: tag(ids.tagC, null),
    ts: tag(ids.tagD, null),
  });
  const c = await campanha("envio", f);
  const p = await contato();
  const id = await inscrever(c, p.id);
  const antes = enviosMeta().length;
  await processarFila(5, c);
  const e = await execucao(id);
  if (travaAtiva) {
    assert.equal(e.estado, "falhou");
    assert.match(e.erro ?? "", /bloqueado/);
    assert.equal(enviosMeta().length, antes, "nada chegou à Graph");
    const ev = await eventos(id);
    assert.ok(ev.some((x) => x.tipo === "enviando"));
    assert.ok(ev.some((x) => x.tipo === "bloco" && x.detalhe.bloco === "envio" && x.detalhe.ok === false));
    passo("envio: a trava de ambiente recusa e a execução falha com o motivo (envio real não exercitado)");
  } else {
    assert.equal(e.estado, "aguardando_resposta");
    assert.equal(e.bloco_atual, "aguardar");
    const enviado = enviosMeta().at(-1)!;
    const componentes = (enviado.corpo?.template as { components: Array<Record<string, unknown>> }).components;
    const botoes = componentes.filter((x) => x.type === "button");
    assert.deepEqual(botoes.map((b) => b.index), ["0", "1"]);
    assert.ok(botoes.every((b) => JSON.stringify(b.parameters) === JSON.stringify([{ type: "payload", payload: `cw:${id}:envio` }])));
    assert.equal(e.mensagem_id_meta, `wamid.TESTE.${wamids}`);
    const [m] = await sql`SELECT enviada_por FROM mensagens WHERE id_externo = ${e.mensagem_id_meta as string}`;
    assert.equal(m.enviada_por, "automacao", "o template entrou na conversa");
    passo("envio: template com payload cw: nos botões, wamid gravado e conversa registrada");
  }

  // Envio que começou e não voltou: não reenvia.
  const p2 = await contato();
  const id2 = await inscrever(c, p2.id, { estado: "em_andamento", bloco: "envio", prazoEmMin: -1 });
  await evento(c, id2, "enviando", { bloco: "envio" });
  const antes2 = enviosMeta().length;
  await processarFila(5, c);
  const e2 = await execucao(id2);
  assert.equal(e2.estado, "falhou");
  assert.match(e2.erro ?? "", /não reenviado/);
  assert.equal(enviosMeta().length, antes2);
  passo("envio interrompido sem confirmação: falha em vez de reenviar");

  // Template que a Meta não tem aprovado.
  const c3 = await campanha("sem template", fluxo("envio", { envio: envio(null, "nao_existe") }));
  const id3 = await inscrever(c3, (await contato()).id);
  await processarFila(5, c3);
  assert.match((await execucao(id3)).erro ?? "", /não está aprovado/);
  passo("template fora da lista aprovada da Meta: falha sem enviar");

  return c;
}

async function parteRespostas(ids: Ids, c: string) {
  // (a) payload do botão
  const a = await contato();
  const ea = await aguardando(c, a.id, ["wamid.A"]);
  const b = await contato();
  const eb = await aguardando(c, b.id, ["wamid.B1", "wamid.B2"]);
  const clique = (de: string, extra: Partial<MensagemRecebida> = {}) =>
    msg({ numero: de, id: `wamid.in.${Math.random()}`, tipo: "button", texto: "Quero saber mais", botaoTexto: "Quero saber mais", botaoPayload: `cw:${ea}:envio`, contextoId: "wamid.A", ...extra });
  assert.equal((await registrarResposta(clique(b.whatsapp))).consumida, false, "payload de outro contato");
  assert.equal((await registrarResposta(clique(a.whatsapp, { phoneNumberId: OUTRO_TELEFONE_ID }))).consumida, false, "payload em outro número");
  const ra = await registrarResposta(clique(a.whatsapp, { id: "wamid.in.a" }));
  assert.deepEqual(ra, { consumida: true, execucaoId: ea, continuar: true, calaIa: false }, "o botão leva só a uma tag: a IA não fica calada");
  let x = await execucao(ea);
  assert.equal(x.estado, "em_andamento");
  assert.equal(x.resposta_saida, "botao:Quero saber mais");
  assert.equal(x.resposta_id, "wamid.in.a");
  assert.equal((await avancarExecucao(ea)).ligouIa, false);
  assert.equal((await execucao(ea)).estado, "concluida");
  assert.equal(await temTag(a.id, ids.tagA), true);
  passo("resposta pelo payload do botão: só do contato e do número certos; segue pela saída do botão");

  // (b) citação de um envio ANTERIOR da execução (está só nos eventos)
  const rb = await registrarResposta(msg({ numero: b.whatsapp, id: "wamid.in.b", texto: "Qual o PREÇO?", contextoId: "wamid.B1" }));
  assert.equal(rb.consumida, true);
  x = await execucao(eb);
  assert.equal(x.resposta_saida, "palavra:0");
  await avancarExecucao(eb);
  assert.equal(await temTag(b.id, ids.tagB), true);
  passo("resposta citando um envio da execução: casa pelo wamid dos eventos; palavra escolhe a saída");

  // (d) citação que não casa: não cai na regra sem citação
  const cc = await contato();
  const ec = await aguardando(c, cc.id, ["wamid.C"]);
  assert.equal((await registrarResposta(msg({ numero: cc.whatsapp, id: "wamid.in.c0", texto: "oi", contextoId: "wamid.de-outra-conversa" }))).consumida, false);
  assert.equal((await execucao(ec)).estado, "aguardando_resposta");
  // (c) sem citação
  assert.equal((await registrarResposta(msg({ numero: cc.whatsapp, id: "wamid.in.c", texto: "bom dia" }))).consumida, true);
  assert.equal((await execucao(ec)).resposta_saida, "outra");
  await avancarExecucao(ec);
  assert.equal(await temTag(cc.id, ids.tagC), true);
  passo("citação que não casa é ignorada; sem citação vale a aguardando do contato no número");

  // Reentrega, reação, resposta anterior ao envio, campanha pausada.
  const d = await contato();
  const ed = await aguardando(c, d.id, ["wamid.D"]);
  assert.equal((await registrarResposta(msg({ numero: d.whatsapp, id: "wamid.in.a", texto: "oi" }))).consumida, false, "mesmo id de mensagem");
  assert.equal((await registrarResposta(msg({ numero: d.whatsapp, id: "wamid.in.d0", texto: "oi", nova: false }))).consumida, false, "reentrega");
  assert.equal((await registrarResposta(msg({ numero: d.whatsapp, id: "wamid.in.d1", tipo: "reaction" }))).consumida, false, "reação");
  const antiga = Math.floor(Date.now() / 1000) - 3600;
  assert.equal((await registrarResposta(msg({ numero: d.whatsapp, id: "wamid.in.d2", texto: "oi", timestamp: antiga }))).consumida, false, "antes do envio");
  assert.equal((await execucao(ed)).estado, "aguardando_resposta");
  const pausada = await campanha("pausada", lerDefinicao((await sql`SELECT definicao FROM campanhas_whatsapp WHERE id = ${c}::uuid`)[0].definicao), { status: "pausada" });
  const g = await contato();
  const eg = await aguardando(pausada, g.id, ["wamid.G"]);
  const rg = await registrarResposta(msg({ numero: g.whatsapp, id: "wamid.in.g", texto: "oi" }));
  assert.deepEqual(rg, { consumida: true, execucaoId: eg, continuar: false, calaIa: false }, "na pausa grava a saída e não anda");
  assert.equal((await execucao(eg)).estado, "em_andamento");
  passo("reentrega, mesmo id, reação e resposta antiga não andam o fluxo; na pausa, a saída fica gravada");

  // Descadastro
  const r = await registrarResposta(msg({ numero: d.whatsapp, id: "wamid.in.d3", texto: "  Parar. " }));
  assert.deepEqual(r, { consumida: true, execucaoId: ed, continuar: false, calaIa: false });
  x = await execucao(ed);
  assert.equal(x.estado, "concluida");
  assert.equal(x.resposta_saida, "descadastro");
  passo("descadastro encerra o fluxo do contato");

  // Prazo vencido: sai por "sem resposta".
  const k = await contato();
  const ek = await aguardando(c, k.id, ["wamid.K"], { prazoEmMin: -1 });
  const r2 = await processarExpirados(50, c);
  assert.equal(r2.expirados, 1);
  x = await execucao(ek);
  assert.equal(x.resposta_saida, "sem_resposta");
  assert.equal(x.estado, "em_andamento");
  await processarFila(5, c);
  assert.equal((await execucao(ek)).estado, "concluida");
  assert.equal(await temTag(k.id, ids.tagD), true);
  passo("prazo vencido: saída 'sem resposta' atômica e a rodada segue");

  // Webhook: extração (botão + citação), reentrega e a resposta pela mensagem extraída.
  const j = await contato();
  const ej = await aguardando(c, j.id, ["wamid.J"]);
  const valor = {
    metadata: { display_phone_number: TELEFONE_EXIBICAO, phone_number_id: TELEFONE_ID },
    contacts: [{ wa_id: j.whatsapp, profile: { name: "Ana" } }],
    messages: [{
      from: j.whatsapp, id: "wamid.in.web", timestamp: String(Math.floor(Date.now() / 1000)), type: "button",
      button: { text: "Não tenho interesse", payload: `cw:${ej}:envio` }, context: { id: "wamid.J" },
    }],
  };
  const w1 = await processarWebhookOficial(valor);
  assert.equal(w1.mensagens.length, 1);
  assert.deepEqual(
    { ...w1.mensagens[0], timestamp: null },
    { numero: j.whatsapp, id: "wamid.in.web", nova: true, tipo: "button", texto: "Não tenho interesse", botaoTexto: "Não tenho interesse",
      botaoPayload: `cw:${ej}:envio`, contextoId: "wamid.J", phoneNumberId: TELEFONE_ID, timestamp: null },
  );
  const w2 = await processarWebhookOficial(valor);
  assert.equal(w2.mensagens[0].nova, false, "reentrega da Meta vem como não nova");
  assert.equal((await registrarResposta(w2.mensagens[0])).consumida, false);
  assert.equal((await registrarResposta(w1.mensagens[0])).consumida, true);
  x = await execucao(ej);
  assert.equal(x.estado, "concluida", "botão sem saída própria termina ali (destino null)");
  passo("webhook: extrai botão, payload e citação; reentrega não anda; botão com fim encerra");
}

async function parteIa(ids: Ids) {
  const c = await campanha("ia", fluxo("envio", {
    envio: envio("aguardar"),
    aguardar: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [], outra: "ia", sem_resposta: null },
    ia: { tipo: "ligar_ia", iaId: ids.ia, proximo: null },
  }));
  const h = await contato();
  const eh = await aguardando(c, h.id, ["wamid.H"]);
  await registrarResposta(msg({ numero: h.whatsapp, id: "wamid.in.h", texto: "quero" }));
  assert.equal((await avancarExecucao(eh)).ligouIa, true, "a IA ligada pelo fluxo responde a mensagem consumida");
  const [ch] = await sql`SELECT ia, ia_id FROM contatos WHERE id = ${h.id}::uuid`;
  assert.equal(ch.ia, true);
  assert.equal(ch.ia_id, ids.ia);

  const i = await contato();
  await sql`UPDATE contatos SET ia = false WHERE id = ${i.id}::uuid`;
  const ei = await aguardando(c, i.id, ["wamid.I"]);
  await registrarResposta(msg({ numero: i.whatsapp, id: "wamid.in.i", texto: "quero" }));
  assert.equal((await avancarExecucao(ei)).ligouIa, false);
  const [ci] = await sql`SELECT ia FROM contatos WHERE id = ${i.id}::uuid`;
  assert.equal(ci.ia, false, "IA desligada à mão não é religada");
  const ev = (await eventos(ei)).find((x) => x.tipo === "bloco" && x.detalhe.bloco === "ia");
  assert.equal(ev?.detalhe.ok, false);
  passo("passar para a IA: liga e avisa o webhook; desligada à mão fica desligada");
}

async function parteAvisos(ids: Ids, travaAtiva: boolean) {
  const instancias = await instanciasParaAviso();
  if (!instancias.length) {
    console.log("     (avisos: o DEV não tem instância que mande aviso; parte pulada)");
    return;
  }
  const instancia = instancias[0];
  hostUazapi = new URL((await instanciasPorId()).get(instancia.id)!.baseUrl).host;
  const [u1] = await sql`INSERT INTO usuarios (nome, iniciais, whatsapp, ativo) VALUES (${`${MARCA} U1`}, 'S1', ${`${PREFIXO}901`}, true) RETURNING id`;
  const [u2] = await sql`INSERT INTO usuarios (nome, iniciais, whatsapp, ativo) VALUES (${`${MARCA} U2`}, 'S2', ${`${PREFIXO}902`}, true) RETURNING id`;
  const c = await campanha("avisos", fluxo("av1", {
    av1: { tipo: "avisar_equipe", instanciaId: instancia.id, usuarioIds: [u1.id, u2.id], responsavelDoFunil: null, texto: "Respondeu a campanha", proximo: "av2" },
    av2: { tipo: "avisar_equipe", instanciaId: instancia.id, usuarioIds: [u1.id], responsavelDoFunil: ids.funil, texto: "Segundo aviso", proximo: null },
  }));
  const x1 = await contato(`${MARCA} Bia`);
  const x2 = await contato(`${MARCA} Caio`);
  // x1 tem oportunidade aberta no funil, com U2 de responsável: entra no av2.
  await sql`INSERT INTO oportunidades (nome, contato_id, valor, status, funil_id, etapa_id, responsavel_id)
            VALUES (${MARCA}, ${x1.id}::uuid, 0, 'aberta', ${ids.funil}::uuid, ${ids.etapa1}::uuid, ${u2.id}::uuid)`;
  const e1 = await inscrever(c, x1.id);
  const e2 = await inscrever(c, x2.id);
  await processarFila(5, c);
  const pendentes = await sql`SELECT detalhe FROM campanha_whatsapp_eventos WHERE campanha_id = ${c}::uuid AND tipo = 'aviso_pendente'`;
  assert.equal(pendentes.length, 4, "um aviso por bloco por contato, só enfileirado");
  assert.ok(pendentes.every((p: { detalhe: Record<string, unknown> }) => !JSON.stringify(p.detalhe).includes(PREFIXO)), "sem telefone no aviso");

  // Conta as tentativas por pessoa: pela uazapi falsa ou, com a trava, pelo registro de cada recusa.
  const erros: string[] = [];
  const consoleErro = console.error;
  console.error = (...a: unknown[]) => {
    erros.push(a.map(String).join(" "));
  };
  let r;
  try {
    r = await enviarAvisosPendentes();
  } finally {
    console.error = consoleErro;
  }
  assert.equal(r.avisos, 4);
  const tentativas = travaAtiva ? erros.filter((e) => e.startsWith("[aviso equipe] não saiu:")) : uazapi.map((u) => JSON.stringify(u.corpo));
  assert.equal(tentativas.length, 2, "uma mensagem por pessoa (U1 com 4 linhas, U2 com 3)");
  if (!travaAtiva) {
    const para1 = uazapi.find((u) => u.corpo.number === `${PREFIXO}901`)!;
    assert.equal((String(para1.corpo.text).match(/^• /gm) ?? []).length, 4);
    const para2 = uazapi.find((u) => u.corpo.number === `${PREFIXO}902`)!;
    assert.equal((String(para2.corpo.text).match(/^• /gm) ?? []).length, 3);
  }
  const finais = await sql`SELECT tipo, detalhe FROM campanha_whatsapp_eventos WHERE campanha_id = ${c}::uuid AND tipo LIKE 'aviso%'`;
  assert.ok(finais.every((f: { tipo: string }) => f.tipo === (travaAtiva ? "aviso_falhou" : "aviso_enviado")));
  assert.equal((await enviarAvisosPendentes()).avisos, 0, "nada fica para reenviar");
  assert.equal((await execucao(e1)).estado, "concluida");
  assert.equal((await execucao(e2)).estado, "concluida");
  passo(`avisos à equipe agrupados por pessoa${travaAtiva ? " (com a trava: contados pelas recusas)" : ""}`);
}

const TUDO = {
  modulos: new Map([["inicio", "todos"], ["chat", "todos"], ["contatos", "todos"], ["campanhas", "todos"]]),
  permissoes: Object.fromEntries(["inicio", "chat", "contatos", "campanhas"].map((m) => [m, { criar: true, editar: true, excluir: true }])),
} as never;

async function parteConferencia(ids: Ids) {
  const aguardar: BlocoCampanha = { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: { "Quero saber mais": "t" }, palavras: [], outra: null, sem_resposta: null };
  const confere = (blocos: Record<string, BlocoCampanha>, usuario = TUDO) =>
    conferirFluxo({ fluxo: fluxo("envio", blocos), wabaId: WABA, usuario }).then((p) => p.map((x) => `${x.blocoId ?? "-"}: ${x.mensagem}`));
  assert.deepEqual(await confere({ envio: envio("a"), a: aguardar, t: tag(ids.tagA, null) }), []);
  const fantasma = "11111111-1111-4111-8111-111111111111";
  const outroFunil = (await sql`SELECT id FROM etapas WHERE funil_id <> ${ids.funil}::uuid LIMIT 1`)[0]?.id ?? fantasma;
  const problemas = await confere({
    envio: envio("a", "nao_aprovado"),
    a: { ...aguardar, outra: "x" } as BlocoCampanha,
    t: tag(fantasma, null),
    x: { tipo: "enviar_texto", texto: "Seu e-mail é {{email}}", proximo: "m" },
    m: { tipo: "mover_oportunidade", funilId: ids.funil, etapaId: outroFunil, proximo: "av" },
    av: { tipo: "avisar_equipe", instanciaId: fantasma, usuarioIds: [fantasma], responsavelDoFunil: null, texto: "oi", proximo: "ia" },
    ia: { tipo: "ligar_ia", iaId: fantasma, proximo: null },
  });
  for (const esperado of [
    /^envio: O template “nao_aprovado” não está nesta conta do WhatsApp/,
    /^t: Essa tag não existe mais/,
    /^x: No texto, só as marcas/,
    /^m: A etapa não é deste funil/,
    /^av: Esse número não manda aviso/,
    /^ia: Essa IA não existe mais/,
  ])
    assert.ok(problemas.some((p) => esperado.test(p)), `faltou ${esperado}: ${problemas.join(" | ")}`);
  assert.ok((await confere({ t: tag(ids.tagA, null) })).length > 0, "fluxo sem template não passa");
  assert.deepEqual(await confere({ envio: envio(null, "convite_pendente") }), ["envio: O template “convite_pendente” ainda não foi aprovado pela Meta."]);
  const semInicio = { modulos: new Map([["campanhas", "todos"]]), permissoes: { campanhas: { criar: true, editar: true, excluir: false } } } as never;
  const soPermissao = await confere({ envio: envio("m"), m: { tipo: "mover_oportunidade", funilId: ids.funil, etapaId: ids.etapa1, proximo: null } }, semInicio);
  assert.deepEqual(soPermissao.length, 1, "sem a permissão, nem consulta o resto");
  passo("conferência: Meta, banco (tag, etapa do funil, aviso, IA), marcas do texto e permissão");
}

async function parteTexto(ids: Ids) {
  const c = await campanha("texto", fluxo("envio", {
    envio: envio("aguardar"),
    aguardar: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [], outra: "txt", sem_resposta: null },
    txt: { tipo: "enviar_texto", texto: "Oi {{primeiro_nome}}, já te chamamos.", proximo: "fim" },
    fim: tag(ids.tagA, null),
  }));
  const conversa = async (contatoId: string, responsavel: string | null) =>
    (await sql`INSERT INTO atendimentos (contato_id, status, canal, numero_instancia, responsavel_id)
               VALUES (${contatoId}::uuid, 'aberto', 'whatsapp_oficial', ${TELEFONE_EXIBICAO}, ${responsavel}::uuid) RETURNING id`)[0].id as string;
  const roda = async (p: { id: string; whatsapp: string }) => {
    const e = await aguardando(c, p.id, [`wamid.T.${p.id}`]);
    assert.equal((await registrarResposta(msg({ numero: p.whatsapp, id: `wamid.in.t.${p.id}`, texto: "quero" }))).consumida, true);
    await avancarExecucao(e);
    const x = await execucao(e);
    assert.equal(x.estado, "concluida", "texto que não sai não para o fluxo");
    assert.equal(await temTag(p.id, ids.tagA), true);
    return (await eventos(e)).find((v) => v.tipo === "bloco" && v.detalhe.bloco === "txt")!.detalhe;
  };
  const semConversa = await roda(await contato());
  assert.equal(semConversa.ok, false);
  assert.match(String(semConversa.erro), /Sem conversa/);

  const comGente = await contato();
  await conversa(comGente.id, ids.ia); // qualquer uuid serve de "alguém da equipe": a coluna não tem chave estrangeira
  assert.match(String((await roda(comGente)).erro), /alguém da equipe/);

  // Conversa sem dono e com a janela aberta: vai por lib/conversa-envio.ts, que grava pendente antes.
  const livre = await contato();
  const at = await conversa(livre.id, null);
  await sql`INSERT INTO mensagens (atendimento_id, origem, texto, status, data_criacao) VALUES (${at}::uuid, 'contato', 'oi', 'recebido', now() - interval '1 minute')`;
  const r = await roda(livre);
  const [m] = await sql`SELECT texto, enviada_por, status FROM mensagens WHERE atendimento_id = ${at}::uuid AND origem = 'agente'`;
  assert.equal(m.enviada_por, "automacao");
  assert.equal(m.texto, "Oi seed-teste-campanha, já te chamamos.");
  // Fora do Next a lista de números da Meta não carrega: o envio volta com erro,
  // registrado na linha que já estava na conversa.
  assert.equal(m.status, r.ok ? "enviado" : "erro");
  passo(`enviar texto: sem conversa e com gente da equipe pula; com conversa grava pendente e envia pelo canal${r.ok ? "" : " (recusado fora do Next, registrado)"}`);
}

async function parteMetricas(c: string) {
  const [linha] = await sql`SELECT definicao FROM campanhas_whatsapp WHERE id = ${c}::uuid`;
  const m = (await metricasDasCampanhas([{ id: c, definicao: lerDefinicao(linha.definicao) }])).get(c)!;
  assert.equal(m.porSaida["aguardar|botao:Quero saber mais"], 1);
  assert.equal(m.porSaida["aguardar|botao:Não tenho interesse"], 1);
  assert.equal(m.porSaida["aguardar|palavra:0"], 1);
  assert.equal(m.porSaida["aguardar|outra"], 1);
  assert.equal(m.porSaida["aguardar|sem_resposta"], 1);
  assert.equal(m.porSaida["aguardar|descadastro"], 1);
  assert.deepEqual(m.porBloco.aguardar, { agora: 0, passaram: 6 });
  assert.deepEqual(m.porBloco.tq, { agora: 0, passaram: 1 });
  passo("métricas: saídas e blocos pelos eventos, 'agora' pelo bloco_atual");
}

async function parteRegra6(c: string) {
  // Outra campanha no MESMO número: a nova espera enquanto a primeira aguarda.
  const outra = await campanha("mesmo número", fluxo("t", { t: { tipo: "registrar_conversao", proximo: null } }));
  const m = await contato();
  const em = await aguardando(c, m.id, ["wamid.M"]);
  const nova = await inscrever(outra, m.id);
  await processarFila(5, outra);
  assert.equal((await execucao(nova)).estado, "na_fila", "espera a outra campanha");
  await sql`UPDATE campanha_whatsapp_execucoes SET estado = 'concluida' WHERE id = ${em}::uuid`;
  await processarFila(5, outra);
  assert.equal((await execucao(nova)).estado, "concluida");
  // Em outro número, não espera.
  const longe = await campanha("outro número", fluxo("t", { t: { tipo: "registrar_conversao", proximo: null } }), { telefoneId: OUTRO_TELEFONE_ID });
  const n = await contato();
  await aguardando(c, n.id, ["wamid.N"]);
  const en = await inscrever(longe, n.id);
  await processarFila(5, longe);
  assert.equal((await execucao(en)).estado, "concluida");
  passo("uma campanha aguardando por contato e número");
}

async function parteFormatoAntigo(ids: Ids) {
  const antiga = { template_nome: "convite", template_idioma: "pt_BR", espera_minutos: 60, ao_responder: [{ tipo: "registrar_lead" }], ao_expirar: [] };
  const c = await campanha("antiga", antiga);
  const l1 = await contato();
  const e1 = await inscrever(c, l1.id, { estado: "aguardando_resposta", wamid: "wamid.L1", enviadoHaMin: 10, prazoEmMin: 60 });
  const l2 = await contato();
  const e2 = await inscrever(c, l2.id, { estado: "aguardando_resposta", wamid: "wamid.L2", enviadoHaMin: 10, prazoEmMin: -1 });
  const antes = enviosMeta().length;
  const r = await registrarResposta(msg({ numero: l1.whatsapp, id: "wamid.in.l1", texto: "tenho interesse" }));
  assert.equal(r.consumida, true);
  await avancarExecucao(e1);
  let x = await execucao(e1);
  assert.equal(x.estado, "concluida");
  assert.equal(x.conversao, true, "ao_responder (registrar_lead) rodou");
  await processarExpirados(50, c);
  await processarFila(5, c);
  x = await execucao(e2);
  assert.equal(x.estado, "concluida");
  assert.equal(x.resposta_saida, "sem_resposta");
  assert.equal(enviosMeta().length, antes, "nenhuma execução antiga reenviou o template");
  passo("formato antigo: aguardando sem bloco_atual responde e vence sem recomeçar nem reenviar");

  // Ativa gravada como STRING JSON: segue com os padrões (sem as ações escritas nela).
  const texto = await campanha("antiga em texto", antiga, { comoTexto: true });
  const l3 = await contato();
  const e3 = await inscrever(texto, l3.id, { estado: "aguardando_resposta", wamid: "wamid.L3", enviadoHaMin: 10, prazoEmMin: 60 });
  await registrarResposta(msg({ numero: l3.whatsapp, id: "wamid.in.l3", texto: "oi" }));
  x = await execucao(e3);
  assert.equal(x.estado, "concluida");
  assert.equal(x.conversao, false, "a string não é lida: nenhuma ação que nunca rodou passa a rodar");
  passo("campanha antiga gravada como string segue com os padrões");

  // 'enviando' antigo, sem reserva: o relógio começa agora e só depois falha.
  const l4 = await contato();
  const e4 = await inscrever(c, l4.id, { estado: "enviando" });
  await recuperarPresas();
  x = await execucao(e4);
  assert.equal(x.estado, "enviando");
  assert.ok(x.prazo_resposta, "relógio iniciado");
  await sql`UPDATE campanha_whatsapp_execucoes SET prazo_resposta = now() - interval '1 second' WHERE id = ${e4}::uuid`;
  assert.equal((await recuperarPresas()).presas, 1);
  assert.equal((await execucao(e4)).estado, "falhou");
  passo("execução presa em 'enviando' vira falha depois de 15 minutos, sem reenvio");

  // Edição de campanha pausada: quem estava num bloco apagado é concluído.
  await sql`UPDATE campanhas_whatsapp SET status = 'pausada' WHERE id = ${c}::uuid`;
  const l5 = await contato();
  const e5 = await inscrever(c, l5.id, { estado: "aguardando_resposta", wamid: "wamid.L5", enviadoHaMin: 10, prazoEmMin: 60 });
  const novo = fluxo("envio", { envio: envio("t"), t: tag(ids.tagA, null) });
  const ed = await salvarEdicao({ campanhaId: c, nome: null, fluxo: novo, usuarioId: QUEM_EDITA });
  assert.deepEqual(ed, { concluidas: 1 });
  x = await execucao(e5);
  assert.equal(x.estado, "concluida");
  assert.ok((await eventos(e5)).some((v) => v.tipo === "bloco_removido" && v.detalhe.bloco === "aguardar"));
  assert.equal(await salvarEdicao({ campanhaId: await campanha("no ar", novo), nome: null, fluxo: novo, usuarioId: QUEM_EDITA }), null, "a no ar não se edita");
  assert.deepEqual(await retomarCampanha(c, fluxo("envio", { envio: envio(null) }), QUEM_EDITA), { estado: "mudou" }, "definição diferente da conferida");
  assert.deepEqual(await retomarCampanha(c, novo, QUEM_EDITA), { estado: "retomada", inscritas: 0 });
  assert.deepEqual(await retomarCampanha(c, novo, QUEM_EDITA), { estado: "nao_pausada" }, "só a pausada retoma");
  passo("edição: execução antiga em bloco apagado termina com evento; retomar confere a definição e volta a ativa");
}

// ── Revisões de 2026-10-28 ──────────────────────────────────────────────────

const FANTASMA = "11111111-1111-4111-8111-111111111111";
const seEspera = (proximo: string | null, minutos = 60): BlocoCampanha => ({ tipo: "esperar", minutos, proximo });
const conversao = (proximo: string | null = null): BlocoCampanha => ({ tipo: "registrar_conversao", proximo });

function parteFiltroIa() {
  const f = fluxo("e", {
    e: envio("a"),
    a: {
      tipo: "aguardar_resposta",
      prazo_minutos: 60,
      botoes: { "Quero saber mais": "acao", "Não tenho interesse": "so_tag" },
      palavras: [{ contem: "preço", proximo: "espera" }],
      outra: "e2",
      sem_resposta: null,
    },
    acao: conversao("txt"),
    txt: { tipo: "enviar_texto", texto: "Oi", proximo: null },
    so_tag: tag(FANTASMA, null),
    espera: seEspera("e2"),
    e2: envio(null),
  });
  assert.equal(campanhaFalaAntesDeEsperar(f, "acao"), true, "ação e depois texto: a campanha fala");
  assert.equal(campanhaFalaAntesDeEsperar(f, "e2"), true, "template direto");
  assert.equal(campanhaFalaAntesDeEsperar(f, "so_tag"), false, "só ação de CRM: a IA responde");
  assert.equal(campanhaFalaAntesDeEsperar(f, "espera"), false, "espera antes do template: a IA responde agora");
  assert.equal(campanhaFalaAntesDeEsperar(f, null), false, "fim do fluxo");
  const antiga = lerDefinicao({ template_nome: "convite", espera_minutos: 60, ao_responder: [{ tipo: "registrar_lead" }], ao_expirar: [] });
  const aguardarAntigo = antiga.blocos.aguardar as Extract<BlocoCampanha, { tipo: "aguardar_resposta" }>;
  assert.equal(campanhaFalaAntesDeEsperar(antiga, aguardarAntigo.outra), false, "formato antigo: só ações depois do Aguardar");
  assert.equal(iaResponde(undefined, false), true, "mensagem que nenhuma campanha consumiu");
  assert.equal(iaResponde({ calaIa: false }, false), true);
  assert.equal(iaResponde({ calaIa: true }, false), false, "a campanha está falando");
  assert.equal(iaResponde({ calaIa: true }, true), true, "o fluxo ligou a IA");
  passo("filtro da IA: calada só quando o caminho da resposta manda mensagem antes da próxima espera");
}

async function parteMidiaEBotaoAntigo(ids: Ids) {
  const c = await campanha("midia", fluxo("envio", {
    envio: envio("aguardar"),
    aguardar: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [{ contem: "preço", proximo: "tp" }], outra: "to", sem_resposta: null },
    tp: tag(ids.tagB, null),
    to: tag(ids.tagC, null),
  }));
  const a = await contato();
  const ea = await aguardando(c, a.id, ["wamid.AU"]);
  assert.equal((await registrarResposta(msg({ numero: a.whatsapp, id: "wamid.in.sistema", tipo: "system" }))).consumida, false, "aviso de sistema");
  assert.equal((await registrarResposta(msg({ numero: a.whatsapp, id: "wamid.in.audio", tipo: "audio", texto: "" }))).consumida, true, "áudio é resposta");
  assert.equal((await execucao(ea)).resposta_saida, "outra", "mídia sem texto que case sai por outra");
  const b = await contato();
  const eb = await aguardando(c, b.id, ["wamid.FO"]);
  await registrarResposta(msg({ numero: b.whatsapp, id: "wamid.in.foto", tipo: "image", texto: "qual o preço?" }));
  assert.equal((await execucao(eb)).resposta_saida, "palavra:0", "a legenda da foto casa a palavra");
  passo("mídia conta como resposta (áudio sai por outra; legenda casa palavra); aviso de sistema não");

  // Dois templates seguidos: o clique no botão do PRIMEIRO, já no segundo
  // Aguardar, vale como texto; o do último template vale como botão.
  const c2 = await campanha("dois templates", fluxo("envio", {
    envio: envio("aguardar"),
    aguardar: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [], outra: null, sem_resposta: "envio2" },
    envio2: envio("aguardar2"),
    aguardar2: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: { "Quero saber mais": "tq" }, palavras: [], outra: "to", sem_resposta: null },
    tq: tag(ids.tagA, null),
    to: tag(ids.tagC, null),
  }));
  const noSegundo = async (p: { id: string }) => {
    const e = await inscrever(c2, p.id, { estado: "aguardando_resposta", bloco: "aguardar2", wamid: "wamid.2T", enviadoHaMin: 1, prazoEmMin: 60 });
    await evento(c2, e, "bloco", { bloco: "envio", tipo: "enviar_template", saida: "proximo", ok: true, wamid: "wamid.1T" });
    await evento(c2, e, "bloco", { bloco: "aguardar", tipo: "aguardar_resposta", saida: "sem_resposta", ok: true });
    await evento(c2, e, "bloco", { bloco: "envio2", tipo: "enviar_template", saida: "proximo", ok: true, wamid: "wamid.2T" });
    return e;
  };
  const clique = (de: string, execucaoId: string, bloco: string, id: string) =>
    msg({ numero: de, id, tipo: "button", texto: "Quero saber mais", botaoTexto: "Quero saber mais", botaoPayload: `cw:${execucaoId}:${bloco}` });
  const v = await contato();
  const ev = await noSegundo(v);
  assert.equal((await registrarResposta(clique(v.whatsapp, ev, "envio", "wamid.in.velho"))).consumida, true);
  assert.equal((await execucao(ev)).resposta_saida, "outra", "botão de template anterior vale como texto");
  const w = await contato();
  const ew = await noSegundo(w);
  await registrarResposta(clique(w.whatsapp, ew, "envio2", "wamid.in.novo"));
  assert.equal((await execucao(ew)).resposta_saida, "botao:Quero saber mais", "botão do último template vale como botão");
  passo("payload cw: só vale como botão se for do último template antes do Aguardar");

  // Citação do "Enviar texto": o wamid fica no evento do bloco de texto.
  const c3 = await campanha("citacao texto", fluxo("envio", {
    envio: envio("aguardar"),
    aguardar: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [], outra: "txt", sem_resposta: null },
    txt: { tipo: "enviar_texto", texto: "Oi", proximo: "aguardar2" },
    aguardar2: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [], outra: "to", sem_resposta: null },
    to: tag(ids.tagD, null),
  }));
  const x = await contato();
  const ex = await inscrever(c3, x.id, { estado: "aguardando_resposta", bloco: "aguardar2", wamid: "wamid.TPL", enviadoHaMin: 5, prazoEmMin: 60 });
  await evento(c3, ex, "bloco", { bloco: "envio", tipo: "enviar_template", saida: "proximo", ok: true, wamid: "wamid.TPL" });
  await evento(c3, ex, "bloco", { bloco: "txt", tipo: "enviar_texto", saida: "proximo", ok: true, wamid: "wamid.TXT" });
  const rx = await registrarResposta(msg({ numero: x.whatsapp, id: "wamid.in.cita", texto: "isso", contextoId: "wamid.TXT" }));
  assert.equal(rx.consumida, true, "citou o texto livre da campanha: casa pela execução");
  assert.equal((await execucao(ex)).resposta_saida, "outra");
  passo("citação do texto livre casa pelo wamid gravado no evento do bloco");
}

async function parteUmaPorNumero() {
  // A parada num "Esperar" e B na fila, no mesmo número: B espera.
  const x = await campanha("espera A", fluxo("esp", { esp: seEspera("fim"), fim: conversao() }));
  const y = await campanha("fila B", fluxo("c", { c: conversao() }));
  const p = await contato();
  const ea = await inscrever(x, p.id);
  await processarFila(5, x);
  assert.equal((await execucao(ea)).estado, "em_andamento");
  const eb = await inscrever(y, p.id);
  await processarFila(5, y);
  assert.equal((await execucao(eb)).estado, "na_fila", "outra campanha em andamento no número: espera");
  passo("execução em andamento (num Esperar) segura a fila de outra campanha no mesmo número");

  // Duas rodadas de campanhas diferentes ao mesmo tempo, mesmo contato: só uma começa.
  const r1 = await campanha("corrida 1", fluxo("esp", { esp: seEspera(null) }));
  const r2 = await campanha("corrida 2", fluxo("esp", { esp: seEspera(null) }));
  const q = await contato();
  const e1 = await inscrever(r1, q.id);
  const e2 = await inscrever(r2, q.id);
  await Promise.all([processarFila(5, r1), processarFila(5, r2)]);
  const estados = [(await execucao(e1)).estado, (await execucao(e2)).estado].sort();
  assert.deepEqual(estados, ["em_andamento", "na_fila"], "a trava do par contato+número deixa uma só começar");
  passo("duas rodadas de campanhas diferentes com o mesmo contato: uma começa, a outra espera");

  // Entrada do Aguardar: outra campanha já aguarda este contato no número.
  const z = await campanha("aguarda Z", fluxo("envio", {
    envio: envio("aguardar"),
    aguardar: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [], outra: null, sem_resposta: null },
  }));
  const k = await campanha("chega K", fluxo("aguarda", {
    aguarda: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [], outra: null, sem_resposta: null },
  }));
  const s = await contato();
  await aguardando(z, s.id, ["wamid.Z"]);
  const ek = await inscrever(k, s.id, { estado: "em_andamento", bloco: "aguarda", prazoEmMin: -1 });
  await processarFila(5, k);
  const xk = await execucao(ek);
  assert.equal(xk.estado, "em_andamento", "não passa a aguardar junto");
  assert.ok((await eventos(ek)).some((v) => v.tipo === "adiado"), "adiada, com evento");
  passo("a entrada do Aguardar confere outra campanha aguardando o mesmo contato no número");
}

async function parteDescadastroEmTodas() {
  const c = await campanha("descad A", fluxo("envio", {
    envio: envio("aguardar"),
    aguardar: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [], outra: null, sem_resposta: null },
  }));
  const fila = await campanha("descad fila", fluxo("c", { c: conversao() }));
  const andando = await campanha("descad andando", fluxo("esp", { esp: seEspera(null) }));
  const longe = await campanha("descad outro número", fluxo("c", { c: conversao() }), { telefoneId: OUTRO_TELEFONE_ID });
  const p = await contato();
  const ea = await aguardando(c, p.id, ["wamid.DA"]);
  const eb = await inscrever(fila, p.id);
  const ec = await inscrever(andando, p.id, { estado: "em_andamento", bloco: "esp", prazoEmMin: 30 });
  const ed = await inscrever(longe, p.id);
  const r = await registrarResposta(msg({ numero: p.whatsapp, id: "wamid.in.sair", texto: "Sair" }));
  assert.equal(r.consumida, true);
  assert.equal((await execucao(ea)).resposta_saida, "descadastro");
  for (const e of [ea, eb, ec]) assert.equal((await execucao(e)).estado, "concluida", "toda execução do contato no número termina");
  for (const e of [eb, ec]) assert.ok((await eventos(e)).some((v) => v.tipo === "descadastro"), "com evento");
  assert.equal((await execucao(ed)).estado, "na_fila", "em outro número, segue");
  // Sem nenhuma aguardando: não consome, mas encerra o que houver no número.
  const q = await contato();
  const eq = await inscrever(fila, q.id);
  assert.equal((await registrarResposta(msg({ numero: q.whatsapp, id: "wamid.in.parar", texto: "parar" }))).consumida, false);
  assert.equal((await execucao(eq)).estado, "concluida");
  passo("descadastro encerra toda execução não final do contato naquele número, em qualquer campanha");
}

async function partePausaERetomada(ids: Ids) {
  // Resposta durante a pausa: a saída fica gravada e anda na retomada.
  const definicao = fluxo("envio", {
    envio: envio("aguardar"),
    aguardar: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: {}, palavras: [], outra: "to", sem_resposta: null },
    to: tag(ids.tagC, null),
  });
  const c = await campanha("pausa", definicao);
  const p = await contato();
  const e = await aguardando(c, p.id, ["wamid.PA"]);
  await sql`UPDATE campanhas_whatsapp SET status = 'pausada' WHERE id = ${c}::uuid`;
  const r = await registrarResposta(msg({ numero: p.whatsapp, id: "wamid.in.pausa", texto: "pode ser" }));
  assert.deepEqual(r, { consumida: true, execucaoId: e, continuar: false, calaIa: false });
  await processarFila(5, c);
  assert.equal((await execucao(e)).estado, "em_andamento", "pausada não anda");
  assert.equal(await temTag(p.id, ids.tagC), false);
  const gravada = lerDefinicao((await sql`SELECT definicao FROM campanhas_whatsapp WHERE id = ${c}::uuid`)[0].definicao);
  assert.equal((await retomarCampanha(c, gravada, QUEM_EDITA)).estado, "retomada");
  await processarFila(5, c);
  assert.equal((await execucao(e)).estado, "concluida", "anda na retomada");
  assert.equal(await temTag(p.id, ids.tagC), true);
  passo("resposta durante a pausa grava a saída; a fila só anda na retomada");

  // Quem entrou no segmento durante a pausa é inscrito na retomada.
  const [s] = await sql`INSERT INTO segmentos (nome) VALUES (${`${MARCA} pausa`}) RETURNING id`;
  const r2 = await campanha("retoma inscreve", fluxo("esp", { esp: seEspera(null) }), { status: "pausada" });
  await sql`INSERT INTO campanha_whatsapp_segmentos (campanha_id, segmento_id) VALUES (${r2}::uuid, ${s.id}::uuid)`;
  const novo = await contato();
  await sql`INSERT INTO contato_segmentos (contato_id, segmento_id) VALUES (${novo.id}::uuid, ${s.id}::uuid)`;
  const [antes] = await sql`SELECT count(*)::int AS n FROM campanha_whatsapp_execucoes WHERE campanha_id = ${r2}::uuid`;
  assert.equal(antes.n, 0, "o gatilho não inscreve em campanha pausada");
  const gravada2 = lerDefinicao((await sql`SELECT definicao FROM campanhas_whatsapp WHERE id = ${r2}::uuid`)[0].definicao);
  assert.deepEqual(await retomarCampanha(r2, gravada2, QUEM_EDITA), { estado: "retomada", inscritas: 1 });
  passo("retomar inscreve quem entrou no segmento durante a pausa");
}

async function parteInscricaoSemTeto() {
  const [s] = await sql`INSERT INTO segmentos (nome) VALUES (${`${MARCA} massa`}) RETURNING id`;
  await sql`
    WITH novos AS (
      INSERT INTO contatos (nome, whatsapp)
      SELECT ${`${MARCA} massa`} || ' ' || i, ${PREFIXO} || '3' || lpad(i::text, 3, '0') FROM generate_series(1, 300) i
      RETURNING id)
    INSERT INTO contato_segmentos (contato_id, segmento_id) SELECT id, ${s.id}::uuid FROM novos`;
  const c = await campanha("massa", fluxo("c", { c: conversao() }), { status: "rascunho" });
  await sql`INSERT INTO campanha_whatsapp_segmentos (campanha_id, segmento_id) VALUES (${c}::uuid, ${s.id}::uuid)`;
  assert.equal(await contatosNosSegmentos({ campanhaId: c }), 300);
  assert.equal(await contatosNosSegmentos({ segmentoIds: [s.id] }), 300);
  assert.equal(await inscreverDosSegmentos(sql, c), 300, "os 300, numa instrução (antes eram 250)");
  assert.equal(await inscreverDosSegmentos(sql, c), 0, "de novo, ninguém em dobro");
  const [n] = await sql`SELECT count(*)::int AS n FROM campanha_whatsapp_execucoes WHERE campanha_id = ${c}::uuid`;
  assert.equal(n.n, 300);
  passo("inscrição sem teto: segmento com 300 contatos dá 300 execuções");
}

async function parteIdAposentado(ids: Ids) {
  const gravada = fluxo("envio", { envio: envio("x"), x: tag(ids.tagA, null) });
  const c = await campanha("aposentado", gravada, { status: "pausada" });
  const e = await inscrever(c, (await contato()).id, { estado: "concluida" });
  // 'velho' rodou numa versão anterior do fluxo e saiu dela; 'meio' começou a enviar e saiu.
  await evento(c, e, "bloco", { bloco: "velho", tipo: "mudar_tag", saida: "proximo", ok: true });
  await evento(c, e, "enviando", { bloco: "meio" });
  const volta = (id: string) => fluxo("envio", { envio: envio(id), [id]: tag(ids.tagB, null) });
  const r1 = await salvarEdicao({ campanhaId: c, nome: null, fluxo: volta("velho"), usuarioId: QUEM_EDITA });
  assert.ok(r1 && "problemas" in r1 && r1.problemas.some((p) => p.blocoId === "velho"), "id que rodou e saiu não volta");
  const r2 = await salvarEdicao({ campanhaId: c, nome: null, fluxo: volta("meio"), usuarioId: QUEM_EDITA });
  assert.ok(r2 && "problemas" in r2 && r2.problemas.some((p) => p.blocoId === "meio"), "envio começado também aposenta");
  const r3 = await salvarEdicao({ campanhaId: c, nome: null, fluxo: volta("novo"), usuarioId: QUEM_EDITA });
  assert.deepEqual(r3, { concluidas: 0 }, "id novo passa");
  passo("trava de id: id aposentado (rodou e saiu da definição) não volta em salvarEdicao");
}

async function parteIaEscolhida(ids: Ids) {
  const [outra] = await sql`INSERT INTO ias (nome, prompt) VALUES (${`${MARCA} IA`}, 'teste') RETURNING id`;
  const c = await campanha("ia escolhida", fluxo("ia", { ia: { tipo: "ligar_ia", iaId: ids.ia, proximo: null } }));
  const p = await contato();
  await sql`UPDATE contatos SET ia = true, ia_id = ${outra.id}::uuid WHERE id = ${p.id}::uuid`;
  const e = await inscrever(c, p.id);
  await processarFila(5, c);
  const [cp] = await sql`SELECT ia, ia_id FROM contatos WHERE id = ${p.id}::uuid`;
  assert.equal(cp.ia_id, outra.id, "outra IA escolhida não é trocada");
  const ev = (await eventos(e)).find((v) => v.tipo === "bloco" && v.detalhe.bloco === "ia");
  assert.equal(ev?.detalhe.ok, false);
  assert.match(String(ev?.detalhe.erro), /outra IA/);
  passo("passar para a IA: a condição vai no UPDATE; outra IA já ligada não é trocada");
}

async function parteRespostaAdiantada(ids: Ids) {
  const c = await campanha("adiantada", fluxo("envio", {
    envio: envio("aguardar"),
    aguardar: { tipo: "aguardar_resposta", prazo_minutos: 60, botoes: { "Quero saber mais": "tq" }, palavras: [], outra: "to", sem_resposta: null },
    tq: tag(ids.tagA, null),
    to: tag(ids.tagC, null),
  }));
  const p = await contato();
  // A execução enviou o template e, antes de chegar ao Aguardar, a pessoa clicou.
  const e = await inscrever(c, p.id, { estado: "em_andamento", bloco: "aguardar", wamid: "wamid.ADI", enviadoHaMin: 0, prazoEmMin: -1 });
  await evento(c, e, "enviando", { bloco: "envio" });
  await evento(c, e, "bloco", { bloco: "envio", tipo: "enviar_template", saida: "proximo", ok: true, wamid: "wamid.ADI" });
  const [at] = await sql`INSERT INTO atendimentos (contato_id, status, canal, numero_instancia)
                         VALUES (${p.id}::uuid, 'aberto', 'whatsapp_oficial', ${TELEFONE_EXIBICAO}) RETURNING id`;
  await sql`INSERT INTO mensagens (atendimento_id, origem, texto, status, id_externo)
            VALUES (${at.id}::uuid, 'contato', 'Quero saber mais', 'recebido', 'wamid.in.adiantada')`;
  await processarFila(5, c);
  const x = await execucao(e);
  assert.equal(x.estado, "concluida");
  assert.equal(x.resposta_saida, "botao:Quero saber mais");
  assert.equal(x.resposta_id, "wamid.in.adiantada");
  assert.equal(await temTag(p.id, ids.tagA), true);

  // A conversa de ANTES da rodada (durante um Esperar entre o template e o
  // Aguardar) não vira resposta: o Aguardar começa a esperar normalmente.
  const q = await contato();
  const eq = await inscrever(c, q.id, { estado: "em_andamento", bloco: "aguardar", wamid: "wamid.ESP", enviadoHaMin: 60, prazoEmMin: -1 });
  await sql`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe, data_criacao)
            VALUES (${c}::uuid, ${eq}::uuid, 'enviando', ${sql.json({ bloco: "envio" } as never)}, now() - interval '60 minutes')`;
  await evento(c, eq, "bloco", { bloco: "envio", tipo: "enviar_template", saida: "proximo", ok: true, wamid: "wamid.ESP" });
  const [atq] = await sql`INSERT INTO atendimentos (contato_id, status, canal, numero_instancia)
                          VALUES (${q.id}::uuid, 'aberto', 'whatsapp_oficial', ${TELEFONE_EXIBICAO}) RETURNING id`;
  await sql`INSERT INTO mensagens (atendimento_id, origem, texto, status, id_externo, data_criacao)
            VALUES (${atq.id}::uuid, 'contato', 'Quero saber mais', 'recebido', 'wamid.in.na-espera', now() - interval '30 minutes')`;
  await processarFila(5, c);
  const y = await execucao(eq);
  assert.equal(y.estado, "aguardando_resposta", "a mensagem da espera não conta");
  assert.equal(y.resposta_id, null);
  passo("resposta que chegou enquanto a execução enviava vale na entrada do Aguardar, uma vez só; a conversa de antes da rodada, não");
}

// ── Principal ───────────────────────────────────────────────────────────────

async function main() {
  if ((process.env.DATABASE_URL ?? "").includes("ep-noisy-pond")) throw new Error("RECUSADO: DATABASE_URL aponta para PRODUÇÃO");
  // Nenhuma credencial real sai daqui, nem para a rede falsa.
  process.env.META_SYSTEM_USER_TOKEN = "token-de-teste";
  globalThis.fetch = fetchFalso as typeof fetch;

  const travaAtiva = (() => {
    try {
      conferirDestino(numero(1));
      return false;
    } catch {
      return true;
    }
  })();
  if (travaAtiva) console.log("(WHATSAPP_SO_PARA ativa: os números de teste não passam; o envio real não é exercitado — ver o cabeçalho)");

  // As rodadas globais (presas, avisos) não podem tocar em dado que não é do teste.
  const [alheio] = await sql`
    SELECT (SELECT count(*)::int FROM campanha_whatsapp_eventos ev JOIN campanhas_whatsapp c ON c.id = ev.campanha_id
             WHERE ev.tipo IN ('aviso_pendente', 'aviso_enviando') AND c.nome NOT LIKE ${MARCA + "%"}) AS avisos,
           (SELECT count(*)::int FROM campanha_whatsapp_execucoes e JOIN campanhas_whatsapp c ON c.id = e.campanha_id
             WHERE e.estado = 'enviando' AND c.nome NOT LIKE ${MARCA + "%"}) AS presas,
           (SELECT count(*)::int FROM contatos WHERE regexp_replace(whatsapp, '[^0-9]', '', 'g') LIKE '%007710__'
              AND whatsapp NOT LIKE ${PREFIXO + "%"}) AS colisoes`;
  if (alheio.avisos || alheio.presas) throw new Error("o DEV tem aviso pendente ou execução presa de campanha real: as rodadas globais mexeriam nelas");
  if (alheio.colisoes) throw new Error("há contato real com o mesmo final de número dos de teste");

  const [ia] = await sql`SELECT id FROM ias ORDER BY data_criacao LIMIT 1`;
  const [etapas] = await sql`
    SELECT e1.funil_id, e1.id AS etapa1, e2.id AS etapa2 FROM etapas e1
      JOIN etapas e2 ON e2.funil_id = e1.funil_id AND e2.id <> e1.id
     WHERE NOT EXISTS (SELECT 1 FROM fluxos f WHERE f.etapa_id IN (e1.id, e2.id))
     LIMIT 1`;
  if (!ia || !etapas) throw new Error("o DEV precisa de uma IA e de um funil com duas etapas sem cadência");

  await limpar(); // sobra de uma rodada que caiu no meio
  try {
    const nova = async (tabela: "tags" | "segmentos", nome: string) =>
      tabela === "tags"
        ? ((await sql`INSERT INTO tags (nome) VALUES (${`${MARCA} ${nome}`}) RETURNING id`)[0].id as string)
        : ((await sql`INSERT INTO segmentos (nome) VALUES (${`${MARCA} ${nome}`}) RETURNING id`)[0].id as string);
    const ids: Ids = {
      tagA: await nova("tags", "A"),
      tagB: await nova("tags", "B"),
      tagC: await nova("tags", "C"),
      tagD: await nova("tags", "D"),
      segmento: await nova("segmentos", "S"),
      funil: etapas.funil_id,
      etapa1: etapas.etapa1,
      etapa2: etapas.etapa2,
      ia: ia.id,
    };
    parteEntrada(ids);
    await parteConferencia(ids);
    await parteRodada(ids);
    const c = await parteEnvio(ids, travaAtiva);
    await parteRespostas(ids, c);
    await parteMetricas(c);
    await parteIa(ids);
    await parteTexto(ids);
    await parteRegra6(c);
    await parteAvisos(ids, travaAtiva);
    await parteFormatoAntigo(ids);
    parteFiltroIa();
    await parteMidiaEBotaoAntigo(ids);
    await parteUmaPorNumero();
    await parteDescadastroEmTodas();
    await partePausaERetomada(ids);
    await parteInscricaoSemTeto();
    await parteIdAposentado(ids);
    await parteIaEscolhida(ids);
    await parteRespostaAdiantada(ids);
    console.log(`\nOK: ${passos} partes do motor conferidas (${graph.length} chamadas à Graph falsa, ${uazapi.length} à uazapi falsa).`);
  } finally {
    await limpar();
    const [{ n }] = await sql`
      SELECT (SELECT count(*) FROM campanhas_whatsapp WHERE nome LIKE ${MARCA + "%"})
           + (SELECT count(*) FROM contatos WHERE whatsapp LIKE ${PREFIXO + "%"})
           + (SELECT count(*) FROM tags WHERE nome LIKE ${MARCA + "%"})
           + (SELECT count(*) FROM segmentos WHERE nome LIKE ${MARCA + "%"})
           + (SELECT count(*) FROM usuarios WHERE nome LIKE ${MARCA + "%"})
           + (SELECT count(*) FROM ias WHERE nome LIKE ${MARCA + "%"}) AS n`;
    console.log(`limpeza: ${n} linha(s) de teste restando`);
    globalThis.fetch = fetchOriginal;
    await sql.end();
  }
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
