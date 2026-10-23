// node scripts/testar-agenda-ocupados.mjs
// Os horários livres e a reserva de reunião (lib/agenda.ts) conferem as agendas
// que ocupam o horário (AGENDAS_QUE_OCUPAM) além da agenda da conexão. Google,
// banco e conexão simulados: nada sai da máquina.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
function carregar(arquivo, mocks, cache = new Map()) {
  const caminho = [arquivo, `${arquivo}.ts`, `${arquivo}/index.ts`].find((p) => existsSync(p) && /\.ts$/.test(p));
  if (!caminho) throw new Error(`Módulo não encontrado: ${arquivo}`);
  if (cache.has(caminho)) return cache.get(caminho).exports;
  const modulo = { exports: {} };
  cache.set(caminho, modulo);
  const codigo = ts.transpileModule(readFileSync(caminho, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const importar = (nome) => {
    if (Object.hasOwn(mocks, nome)) return mocks[nome];
    // Fora do Next o pacote estoura de propósito; aqui ele é só um marcador.
    if (nome === "server-only") return {};
    if (nome.startsWith("@/")) return carregar(resolve(raiz, nome.slice(2)), mocks, cache);
    if (nome.startsWith(".")) return carregar(resolve(dirname(caminho), nome), mocks, cache);
    return require(nome);
  };
  new Function("require", "module", "exports", codigo)(importar, modulo, modulo.exports);
  return modulo.exports;
}

class GoogleDesconectado extends Error {}
const sql = async (partes) => (partes.join("?").includes("FROM contatos") ? [{ nome: "Teste", email: null, whatsapp: null }] : []);
// A trava da reserva roda numa transação; aqui ela só chama de volta (a fila de
// verdade precisa de um Postgres e não é testada neste script).
sql.begin = async (corpo) => corpo(async () => []);
const ag = carregar(resolve(raiz, "lib/agenda.ts"), {
  "@/lib/db": { sql },
  "@/lib/google-oauth": {
    acessoGoogle: async () => ({ token: "t", calendarioId: "primary", contaEmail: "meet@teste" }),
    esquecerTokenGoogle: () => {},
    GoogleDesconectado,
  },
});

// ── O Google simulado ────────────────────────────────────────────────────────
// Terça 03/11/2026; "agora" é segunda às 8h. Horários do dia: 10h a 17h.
const D = [2026, 11, 3];
const agora = ag.instanteEmBrasilia(2026, 11, 2, 8);
const ev = (id, h, extra = {}) => ({
  id,
  status: "confirmed",
  start: { dateTime: ag.instanteEmBrasilia(...D, h).toISOString() },
  end: { dateTime: ag.instanteEmBrasilia(...D, h + 1).toISOString() },
  ...extra,
});
const AGENDAS = [
  { id: "meet@teste", summary: "Agendamentos IA Amaan", primary: true },
  { id: "fab", summary: "Agenda Fabricio" },
  { id: "fer-lig", summary: "Agenda Fernanda - Ligação" },
  { id: "fer-vid", summary: "Agenda Fernanda - Vídeo chamada" },
];
// Evento de dia inteiro: o Google manda só a data, e o fim é o dia seguinte.
const diaInteiro = (id, dia, extra = {}) => ({
  id,
  status: "confirmed",
  start: { date: `2026-11-${String(dia).padStart(2, "0")}` },
  end: { date: `2026-11-${String(dia + 1).padStart(2, "0")}` },
  ...extra,
});
const EVENTOS = {
  // Na agenda da conexão, evento com horário ocupa até "disponível"; o recusado
  // pela conta, não. O de dia inteiro só ocupa se estiver marcado como ocupado.
  primary: [
    ev("p12", 12),
    ev("p13", 13, { transparency: "transparent" }),
    ev("p14", 14, { attendees: [{ email: "meet@teste", self: true, responseStatus: "declined" }] }),
    diaInteiro("lembrete", 3, { transparency: "transparent" }),
    diaInteiro("folga", 4),
    // Convite de dia inteiro que a conta recusou: o dia 05 continua livre.
    diaInteiro("recusado-dia", 5, { attendees: [{ email: "meet@teste", self: true, responseStatus: "declined" }] }),
    // Local de trabalho por horário (Workspace): segue o Google, não ocupa.
    ev("local", 17, { eventType: "workingLocation", transparency: "transparent" }),
  ],
  fab: [ev("f11", 11)],
  "fer-lig": [ev("l10", 10)],
  "fer-vid": [ev("v15", 15, { transparency: "transparent" }), ev("v16", 16)],
};
let lista = AGENDAS;
let ocultas = new Set();
let respostaDaLista = null;
let falhar = null;
let corpoCortado = null;
let semResposta = null;
let postou = 0;
const comPrazo = { GET: 0, POST: 0 };
globalThis.fetch = async (url, init = {}) => {
  if (init.signal) comPrazo[init.method ?? "GET"] = (comPrazo[init.method ?? "GET"] ?? 0) + 1;
  const u = new URL(url);
  const caminho = decodeURIComponent(u.pathname.replace("/calendar/v3", ""));
  if (caminho === "/users/me/calendarList") {
    if (respostaDaLista) return respostaDaLista();
    const mostrarOcultas = u.searchParams.get("showHidden") === "true";
    return Response.json({ items: lista.filter((a) => mostrarOcultas || !ocultas.has(a.id)) });
  }
  const m = /^\/calendars\/([^/]+)\/events$/.exec(caminho);
  if (m && (init.method ?? "GET") === "POST") {
    postou++;
    throw new Error("POST chamado");
  }
  if (m) {
    if (m[1] === falhar) return Response.json({ error: { message: "falha simulada" } }, { status: 500 });
    // 200 com o corpo pela metade (prazo estourado no meio da leitura).
    if (m[1] === corpoCortado) return new Response('{"items": [', { status: 200, headers: { "content-type": "application/json" } });
    // O prazo estourou antes da resposta: é o erro que o AbortSignal.timeout lança.
    if (m[1] === semResposta) throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const de = new Date(u.searchParams.get("timeMin"));
    const ate = new Date(u.searchParams.get("timeMax"));
    const instante = (p) => new Date(p.dateTime ?? `${p.date}T00:00:00-03:00`);
    const items = (EVENTOS[m[1]] ?? []).filter((e) => instante(e.start) < ate && instante(e.end) > de);
    return Response.json({ items });
  }
  throw new Error(`rota inesperada: ${caminho}`);
};
const horasDoDia = (livres) =>
  livres.filter((h) => ag.diaEmBrasilia(h.inicio) === "2026-11-03").map((h) => Number(ag.horaEmBrasilia(h.inicio).slice(0, 2)));
const erros = [];
const erroOriginal = console.error;
console.error = (...a) => erros.push(a.join(" "));

try {
  // 1. Ocupam: agendas da Fernanda e, na da conexão, até o "disponível" com
  //    horário (13h). Não ocupam: a do Fabricio, o "disponível" de outra
  //    agenda (15h), o convite que a própria conta recusou (14h), o local de
  //    trabalho com horário (17h) e o lembrete de dia inteiro "disponível" (o
  //    dia 03 continua com horários).
  const livres = await ag.horariosLivres(agora);
  assert.deepEqual(horasDoDia(livres), [11, 14, 15, 17]);
  assert.ok(!livres.some((h) => ag.diaEmBrasilia(h.inicio) === "2026-11-04"), "folga de dia inteiro ocupada tira o dia 04");
  assert.ok(livres.some((h) => ag.diaEmBrasilia(h.inicio) === "2026-11-05"), "o dia 05 segue livre, apesar do convite recusado");
  assert.equal(erros.length, 0, "com as duas agendas achadas, nada no log");
  assert.ok(comPrazo.GET > 0, "as leituras do Google vão com prazo");

  // 1b. Resposta boa com o corpo cortado não vira "agenda sem compromisso".
  corpoCortado = "fer-lig";
  await assert.rejects(ag.horariosLivres(agora), SyntaxError);
  corpoCortado = null;

  // 1c. Prazo estourado: erro em português, e nenhum horário oferecido.
  semResposta = "fer-lig";
  await assert.rejects(ag.horariosLivres(agora), /Google Calendar não respondeu em 15 segundos/);
  semResposta = null;

  // 2. Uma agenda que ocupa não responde: nenhum horário (a IA cai em "agenda indisponível").
  falhar = "fer-vid";
  await assert.rejects(ag.horariosLivres(agora), /Google Calendar respondeu 500/);
  falhar = null;

  // 3. A lista de agendas responde 403 (cota ou escopo): também fecha.
  respostaDaLista = () => Response.json({ error: { message: "Rate Limit Exceeded" } }, { status: 403 });
  await assert.rejects(ag.horariosLivres(agora), /Sem a lista de agendas/);
  respostaDaLista = null;

  // 4. Agenda renomeada: só ela sai da conferência, com erro no log; a outra segue.
  lista = AGENDAS.map((a) => (a.id === "fer-vid" ? { ...a, summary: "Videochamada" } : a));
  assert.deepEqual(horasDoDia(await ag.horariosLivres(agora)), [11, 14, 15, 16, 17]);
  assert.ok(erros.some((e) => e.includes("Agenda Fernanda - Vídeo chamada")), "loga a que falta");

  // 5. Nome repetido não esconde a que falta.
  erros.length = 0;
  lista = [...lista, { id: "fer-lig-2", summary: "Agenda Fernanda - Ligação" }];
  await ag.horariosLivres(agora);
  assert.ok(erros.some((e) => e.includes("Agenda Fernanda - Vídeo chamada")), "loga mesmo com a outra repetida");
  lista = AGENDAS;
  erros.length = 0;

  // 6. Agenda escondida da lista do Google continua ocupando; a tela não a vê.
  ocultas = new Set(["fer-vid"]);
  assert.deepEqual(horasDoDia(await ag.horariosLivres(agora)), [11, 14, 15, 17]);
  assert.ok(!(await ag.agendasDaConta()).agendas.some((a) => a.id === "fer-vid"), "a tela não lista a escondida");
  ocultas = new Set();

  // 7. A reserva da IA confere as mesmas agendas; a da ficha, só a da conexão.
  const base = { contatoId: "c", oportunidadeId: null, inicio: ag.instanteEmBrasilia(...D, 10), quem: "x" };
  await assert.rejects(
    ag.marcarReuniao({ ...base, autorId: null, conferirAgendasQueOcupam: true }),
    (e) => e instanceof ag.HorarioOcupado,
    "IA às 10h: ocupado na agenda da Fernanda",
  );
  await assert.rejects(ag.marcarReuniao({ ...base, autorId: "u" }), /POST chamado/, "ficha às 10h: segue para criar");
  await assert.rejects(
    ag.marcarReuniao({ ...base, inicio: ag.instanteEmBrasilia(...D, 11), autorId: null, conferirAgendasQueOcupam: true }),
    /POST chamado/,
    "IA às 11h: a agenda do Fabricio não ocupa",
  );
  await assert.rejects(
    ag.marcarReuniao({ ...base, inicio: ag.instanteEmBrasilia(...D, 12), autorId: "u" }),
    (e) => e instanceof ag.HorarioOcupado,
    "ficha às 12h: a agenda da conexão barra",
  );
  // 8. O "disponível" da agenda da conexão barra a IA; o convite recusado, não.
  await assert.rejects(
    ag.marcarReuniao({ ...base, inicio: ag.instanteEmBrasilia(...D, 13), autorId: null, conferirAgendasQueOcupam: true }),
    (e) => e instanceof ag.HorarioOcupado,
    "IA às 13h: evento disponível na agenda da conexão ocupa",
  );
  await assert.rejects(
    ag.marcarReuniao({ ...base, inicio: ag.instanteEmBrasilia(...D, 14), autorId: null, conferirAgendasQueOcupam: true }),
    /POST chamado/,
    "IA às 14h: convite recusado pela conta não ocupa",
  );
  assert.equal(postou, 3);
  assert.equal(comPrazo.POST, 0, "criar evento espera o Google, sem prazo (POST abortado deixaria reunião sem vínculo)");
} finally {
  console.error = erroOriginal;
}
console.log(
  "OK: agendas que ocupam o horário (Fernanda sim, Fabricio não; na da conexão, evento com horário sempre, dia inteiro só se ocupado, recusado e local de trabalho nunca), falha fechada, prazo só na leitura, corpo cortado, cota, renomeada, repetida, escondida e reserva da IA x ficha.",
);
