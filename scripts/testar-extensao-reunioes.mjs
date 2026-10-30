// O service worker da extensão de reuniões (extensao-reunioes/service-worker.js)
// com um `chrome` falso em memória: sem navegador, sem rede, sem banco.
//
//   node scripts/testar-extensao-reunioes.mjs
//
// Confere o caminho de uma reunião:
//   · o clique e o "pronta";
//   · Gravar só pelo painel, com ou sem o clique no ícone antes (2026-10-30);
//   · o status "gravando" gravado pelo service worker;
//   · o estado que o gravador não pode mexer;
//   · a parada quando a aba sai da reunião;
//   · o clique depois do fim que não apaga a transcrição;
//   · baixar e Nova reunião;
//   · as falhas na captura e no gravador.
// O áudio de verdade (gravador.js) só se confere no Chrome: ver extensao-reunioes/LEIAME.md.

const MEET = "https://meet.google.com/abc-defg-hij";
const ID = "extensao-de-teste";

let falhas = 0;
function conferir(ok, texto, extra = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${texto}${extra ? ` → ${extra}` : ""}`);
}

// ── O chrome falso ──────────────────────────────────────────────────────────
const ouvintes = { clique: [], mensagem: [], removida: [], atualizada: [], download: [] };
const sessao = new Map();
const abas = new Map([[7, { id: 7, url: MEET }], [8, { id: 8, url: "https://exemplo.com/" }], [9, { id: 9, url: "https://meet.google.com/meet/abc-defg-hij?authuser=0" }]]);
// A aba aberta da janela em foco: o site comum, com a reunião numa aba ao lado.
const ABA_ATIVA = 8;
const badges = [];
const pedidosAoGravador = [];
let documentos = 0;
let criados = 0;
let fechados = 0;
let capturaFalha = false;
let gravadorFalha = false;

const ouvinte = (lista) => ({ addListener: (f) => lista.push(f) });

// O CRM falso: onde a pessoa está logada. Começa logada só pelo endereço da
// Vercel, o caso que quebrou na primeira vez (2026-10-28).
let logadoEm = new Set(["https://chromacrm.vercel.app"]);
globalThis.fetch = async (url) => {
  const origem = new URL(url).origin;
  return new Response(JSON.stringify(logadoEm.has(origem) ? { lead: null, candidatos: [] } : { erro: "não autenticado" }), {
    status: logadoEm.has(origem) ? 200 : 401,
    headers: { "content-type": "application/json" },
  });
};

async function gravadorFalso(msg) {
  pedidosAoGravador.push(msg);
  if (msg.tipo === "iniciar") return gravadorFalha ? { ok: false, erro: "o microfone travou" } : { ok: true };
  if (msg.tipo === "parar") return { ok: true, url: "blob:chrome-extension://teste/gravacao" };
  return { ok: true };
}

globalThis.chrome = {
  storage: {
    session: {
      get: async (chave) => ({ [chave]: structuredClone(sessao.get(chave)) }),
      set: async (objeto) => {
        for (const [k, v] of Object.entries(objeto)) sessao.set(k, structuredClone(v));
      },
    },
  },
  runtime: {
    id: ID,
    onMessage: ouvinte(ouvintes.mensagem),
    sendMessage: async (msg) => (msg.alvo === "gravador" ? gravadorFalso(msg) : undefined),
    getContexts: async () => Array.from({ length: documentos }, () => ({})),
    getURL: (p) => `chrome-extension://${ID}/${p}`,
  },
  offscreen: {
    createDocument: async () => {
      documentos = 1;
      criados++;
    },
    closeDocument: async () => {
      if (!documentos) throw new Error("nenhum documento");
      documentos = 0;
      fechados++;
    },
  },
  tabCapture: {
    getMediaStreamId: async ({ targetTabId }) => {
      if (capturaFalha) throw new Error("Extension has not been invoked for the current page (see activeTab permission).");
      return `stream-${targetTabId}`;
    },
  },
  tabs: {
    get: async (id) => {
      if (!abas.has(id)) throw new Error("No tab with id");
      return { ...abas.get(id) };
    },
    query: async ({ active } = {}) => [...abas.values()].filter((a) => !active || a.id === ABA_ATIVA).map((a) => ({ ...a })),
    onRemoved: ouvinte(ouvintes.removida),
    onUpdated: ouvinte(ouvintes.atualizada),
  },
  action: {
    onClicked: ouvinte(ouvintes.clique),
    setBadgeText: async (o) => badges.push(o),
    setBadgeBackgroundColor: async () => {},
  },
  sidePanel: { open: async () => {} },
  downloads: { download: async () => 42, onChanged: ouvinte(ouvintes.download) },
};

const esperar = () => new Promise((pronto) => setTimeout(pronto, 30));
const estado = async () => {
  await esperar();
  return sessao.get("reuniao") ?? {};
};

/** Manda uma mensagem aos ouvintes do service worker, como o painel (sem tab) ou o content script (com tab). */
function enviar(msg, remetente = { id: ID, url: `chrome-extension://${ID}/painel.html` }) {
  return new Promise((pronto) => {
    let espera = false;
    for (const f of ouvintes.mensagem) if (f(msg, remetente, pronto) === true) espera = true;
    if (!espera) pronto(undefined);
  });
}
const clicar = async (abaId) => {
  for (const f of ouvintes.clique) f({ ...abas.get(abaId) });
  return estado();
};

await import("../extensao-reunioes/service-worker.js");

// ── 1. O clique ─────────────────────────────────────────────────────────────
let r = await clicar(8);
conferir(r.status === "parada" && /Abra a reunião/.test(r.aviso ?? ""), "clique fora de reunião: parada, com o aviso");
// O Meet redireciona a sala para /meet/abc-defg-hij desde 2026-10-30 (antes, o painel dizia "abra a reunião").
r = await clicar(9);
conferir(r.status === "pronta" && r.abaId === 9, "clique no Meet com o endereço novo (/meet/abc-defg-hij): pronta");
abas.delete(9);
r = await clicar(7);
conferir(r.status === "pronta" && r.abaId === 7, "clique na aba do Meet: pronta");
conferir(badges.some((b) => b.tabId === 7 && b.text === ""), "o \"!\" do aviso sai do ícone da aba");

// ── 2. Começar ──────────────────────────────────────────────────────────────
const doContentScript = { id: ID, tab: { id: 7, url: MEET }, url: MEET };
await enviar({ alvo: "sw", tipo: "comecar" }, doContentScript);
r = await estado();
conferir(r.status === "pronta" && !pedidosAoGravador.length, "Começar vindo da página da reunião (content script) é ignorado");
logadoEm = new Set();
const semLogin = await enviar({ alvo: "sw", tipo: "comecar" });
r = await estado();
conferir(semLogin?.ok === false && /login no CRM/.test(semLogin.erro) && !pedidosAoGravador.length, "sem login em nenhum endereço do CRM: avisa e não grava", semLogin?.erro);
// A captura se prepara junto com a conferência do login (2026-10-30): sem login, o documento invisível fecha.
conferir(documentos === 0 && r.status === "pronta", "sem login: o documento invisível preparado junto fecha e a aba volta a pronta", JSON.stringify({ documentos, s: r.status }));
await clicar(7);
logadoEm = new Set(["https://chromacrm.vercel.app"]);
const comecou = await enviar({ alvo: "sw", tipo: "comecar" });
r = await estado();
conferir(comecou?.ok === true && r.status === "gravando", "Gravar: o estado vira gravando", r.status);
conferir(pedidosAoGravador.some((p) => p.tipo === "iniciar" && p.crm === "https://chromacrm.vercel.app" && p.streamId === "stream-7"), "logado só pela Vercel: o gravador fala com o CRM pela Vercel");
conferir(typeof r.sessao === "string" && r.sessao.length === 36 && Boolean(r.consentimentoEm), "sessão e hora do aviso guardadas para o resumo");
conferir(badges.some((b) => b.tabId === 7 && b.text === "REC") && badges.some((b) => !b.tabId && b.text === "REC"), "REC na aba da reunião e no ícone");

// ── 3. O que o gravador pode mexer ──────────────────────────────────────────
await enviar({ alvo: "sw", tipo: "estado", parcial: { status: "parada", sessao: "x", arquivo: "https://mal/", falas: [{ fala: "lead", texto: "Achei caro", em: 1 }] } }, { id: ID, url: `chrome-extension://${ID}/gravador.html` });
r = await estado();
conferir(r.status === "gravando" && r.sessao !== "x" && r.arquivo === null, "o gravador não muda status, sessão nem arquivo");
conferir(r.falas?.length === 1, "as falas que o gravador manda entram");
await enviar({ alvo: "sw", tipo: "estado", parcial: { lead: { contatoId: "x", nome: "Falso" } } }, doContentScript);
r = await estado();
conferir(!r.lead, "estado vindo do content script é ignorado");
r = await clicar(7);
conferir(r.status === "gravando", "clique durante a gravação não mexe em nada");

// ── 4. A aba sai da reunião ─────────────────────────────────────────────────
const muitosAntes = pedidosAoGravador.filter((p) => p.tipo === "parar").length;
for (const f of ouvintes.atualizada) f(7, { mutedInfo: { muted: false } });
r = await estado();
conferir(r.status === "gravando" && pedidosAoGravador.filter((p) => p.tipo === "parar").length === muitosAntes, "evento da própria captura (som/mudo) não para");
abas.set(7, { id: 7, url: "https://exemplo.com/" });
for (const f of ouvintes.atualizada) f(7, { url: "https://exemplo.com/" });
r = await estado();
conferir(r.status === "encerrada" && r.arquivo === "blob:chrome-extension://teste/gravacao", "a aba foi para outro site: para, e a gravação fica para baixar");
conferir(badges.at(-1)?.text === "" && badges.some((b) => b.tabId === 7 && b.text === ""), "REC sai do ícone");

// ── 5. Depois do fim ────────────────────────────────────────────────────────
abas.set(7, { id: 7, url: MEET });
r = await clicar(7);
conferir(r.status === "encerrada" && r.falas?.length === 1 && Boolean(r.sessao), "clique depois do fim só abre o painel: a transcrição fica para o resumo");
await enviar({ alvo: "sw", tipo: "baixar" });
r = await estado();
conferir(r.downloadId === 42, "Baixar guarda o download no estado");
const segunda = await enviar({ alvo: "sw", tipo: "baixar" });
conferir(segunda?.ok === false, "um segundo Baixar no meio do download é recusado");
for (const f of ouvintes.download) f({ id: 42, state: { current: "complete" } });
r = await estado();
conferir(r.arquivo === null && r.downloadId === null && documentos === 0, "download concluído: o gravador sai da memória");
await enviar({ alvo: "sw", tipo: "limpar" });
r = await estado();
conferir(r.status === "parada" && !r.falas?.length && !r.sessao, "Nova reunião zera o estado");

// ── 6. Falhas ao começar ────────────────────────────────────────────────────
await clicar(7);
capturaFalha = true;
const fechadosAntes = fechados;
await enviar({ alvo: "sw", tipo: "comecar" });
r = await estado();
conferir(r.status === "pronta" && r.esperandoClique && /Falta um clique/.test(r.aviso ?? "") && Boolean(r.consentimentoEm), "o Chrome pediu o clique no ícone: volta a pronta, guarda a hora do Gravar e diz o que fazer", r.aviso);
capturaFalha = false;
r = await clicar(7);
conferir(r.status === "gravando" && !r.esperandoClique, "o clique no ícone, com o Gravar já clicado, começa a gravação");
for (const f of ouvintes.removida) f(7);
await estado();
await enviar({ alvo: "sw", tipo: "limpar" });

// ── 6b. Gravar sem o clique no ícone antes (o painel aberto, a reunião ao lado) ──
const direto = await enviar({ alvo: "sw", tipo: "comecar" });
r = await estado();
conferir(direto?.ok === true && r.status === "gravando" && r.abaId === 7 && Boolean(r.consentimentoEm), "Gravar com o painel parado: acha a reunião na janela e grava a aba dela", direto?.erro ?? r.status);
for (const f of ouvintes.removida) f(7);
await estado();
await enviar({ alvo: "sw", tipo: "limpar" });
capturaFalha = true;
await enviar({ alvo: "sw", tipo: "comecar" });
r = await estado();
conferir(r.status === "pronta" && r.esperandoClique && r.abaId === 7, "o Chrome recusou sem o clique no ícone: a aba fica guardada para o clique", JSON.stringify({ s: r.status, aba: r.abaId }));
capturaFalha = false;
r = await clicar(7);
conferir(r.status === "gravando", "e o clique no ícone dessa aba começa a gravação");
for (const f of ouvintes.removida) f(7);
await estado();
await enviar({ alvo: "sw", tipo: "limpar" });
abas.set(7, { id: 7, url: "https://exemplo.com/outra" });
const semReuniao = await enviar({ alvo: "sw", tipo: "comecar" });
conferir(semReuniao?.ok === false && /Abra a reunião/.test(semReuniao.erro), "Gravar sem reunião aberta na janela: explica o caminho", semReuniao?.erro);
abas.set(7, { id: 7, url: MEET });
await clicar(7);
gravadorFalha = true;
await enviar({ alvo: "sw", tipo: "comecar" });
r = await estado();
conferir(r.status === "pronta" && /microfone travou/.test(r.erro ?? "") && fechados > fechadosAntes && documentos === 0, "o gravador falhou: volta a pronta e o documento invisível fecha", r.erro);
gravadorFalha = false;

// ── 7. A aba fecha no meio ──────────────────────────────────────────────────
await enviar({ alvo: "sw", tipo: "comecar" });
r = await estado();
conferir(r.status === "gravando", "começa de novo depois das falhas");
for (const f of ouvintes.removida) f(7);
r = await estado();
conferir(r.status === "encerrada", "fechar a aba da reunião para a gravação");

console.log(falhas ? `\n${falhas} falha(s)` : `\ntudo ok (${criados} documento(s) invisível(is) aberto(s))`);
process.exit(falhas ? 1 : 0);
