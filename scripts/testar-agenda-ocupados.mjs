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
// A reunião da remarcação (passo 9) e o que a remarcação grava no banco.
let reuniaoDoBanco = null;
const atualizacoes = [];
const sql = async (partes, ...valores) => {
  const texto = partes.join("?");
  if (texto.includes("FROM agenda_reunioes r JOIN contatos")) return reuniaoDoBanco ? [reuniaoDoBanco] : [];
  if (texto.includes("UPDATE agenda_reunioes")) {
    atualizacoes.push(valores);
    return [];
  }
  return texto.includes("FROM contatos") ? [contatoDoBanco] : [];
};
// O contato da reserva (passos 7 e 7b).
let contatoDoBanco = { nome: "Teste", email: null, whatsapp: null };
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
// Terça 03/11/2026; "agora" é segunda às 8h. Horários do dia: 8h a 21h.
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
// O corpo de cada evento que a reserva mandou criar.
const criados = [];
const comPrazo = { GET: 0, POST: 0, PATCH: 0 };
const patches = [];
globalThis.fetch = async (url, init = {}) => {
  if (init.signal) comPrazo[init.method ?? "GET"] = (comPrazo[init.method ?? "GET"] ?? 0) + 1;
  const u = new URL(url);
  const caminho = decodeURIComponent(u.pathname.replace("/calendar/v3", ""));
  if (caminho === "/users/me/calendarList") {
    if (respostaDaLista) return respostaDaLista();
    const mostrarOcultas = u.searchParams.get("showHidden") === "true";
    return Response.json({ items: lista.filter((a) => mostrarOcultas || !ocultas.has(a.id)) });
  }
  const p = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(caminho);
  if (p && init.method === "PATCH") {
    const corpo = JSON.parse(init.body);
    patches.push({ agenda: p[1], id: p[2], corpo, sendUpdates: u.searchParams.get("sendUpdates") });
    return Response.json({ id: p[2], start: corpo.start, end: corpo.end, hangoutLink: "https://meet.google.com/aaa-bbbb-ccc" });
  }
  const m = /^\/calendars\/([^/]+)\/events$/.exec(caminho);
  if (m && (init.method ?? "GET") === "POST") {
    postou++;
    criados.push(JSON.parse(init.body));
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
  assert.deepEqual(horasDoDia(livres), [8, 9, 11, 14, 15, 17, 18, 19, 20, 21]);
  assert.ok(!livres.some((h) => ag.diaEmBrasilia(h.inicio) === "2026-11-04"), "folga de dia inteiro ocupada tira o dia 04");
  assert.ok(livres.some((h) => ag.diaEmBrasilia(h.inicio) === "2026-11-05"), "o dia 05 segue livre, apesar do convite recusado");
  assert.equal(erros.length, 0, "com as duas agendas achadas, nada no log");
  assert.ok(comPrazo.GET > 0, "as leituras do Google vão com prazo");

  // 1a. Sábado e domingo entram (2026-11-06), só os que caem até o 10º dia
  //     útil com horário livre: 02, 03, 05, 06, 09 a 13 e 16/11 (a folga tira
  //     o 04). Os de 07/08 e 14/15 vêm; o 17/11 não.
  const dias = [...new Set(livres.map((h) => ag.diaEmBrasilia(h.inicio)))];
  const fimDeSemana = dias.filter((d) => ["07", "08", "14", "15"].includes(d.slice(-2)));
  assert.deepEqual(fimDeSemana, ["2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15"]);
  assert.equal(dias.length - fimDeSemana.length, 10, "10 dias úteis");
  assert.equal(dias.at(-1), "2026-11-16", "para no 10º dia útil");
  assert.deepEqual(
    [[2, 17], [2, 18], [7, 10], [8, 21]].map(([dia, h]) => ag.faixaDoHorario(ag.instanteEmBrasilia(2026, 11, dia, h))),
    [0, 1, 2, 2],
    "seg 17h, seg 18h, sáb 10h e dom 21h",
  );

  //     Para a IA, uma linha por faixa, na ordem de oferta: dia útil das 8h
  //     às 18h; a noite só se o cliente pedir; o fim de semana só se ele não
  //     puder durante a semana. Sem a primeira, a seguinte vai na frente.
  const [prioritaria, noite, sabDom, ...resto] = ag.horariosPorDia(livres, agora).split("\n");
  assert.equal(resto.length, 0, "uma linha por faixa");
  assert.ok(prioritaria.startsWith("seg a sex, das 8h às 18h (ofereça estes primeiro): seg 02/11 (hoje): 10:00, 11:00,"), prioritaria);
  assert.ok(prioritaria.includes(" · ter 03/11 (amanhã): 08:00, 09:00, 11:00, 14:00, 15:00, 17:00 · "), prioritaria);
  assert.ok(!/(18|19|20|21):00|sáb|dom/.test(prioritaria), "a faixa prioritária não leva noite nem fim de semana");
  assert.ok(
    noite.startsWith(
      "seg a sex, das 18h às 22h (só se o cliente pedir à noite ou não puder das 8h às 18h): seg 02/11 (hoje): 18:00, 19:00, 20:00, 21:00 · ter 03/11 (amanhã): 18:00",
    ),
    noite,
  );
  assert.ok(!/sáb|dom/.test(noite), "a noite é só de dia útil");
  assert.ok(
    sabDom.startsWith(
      "sáb e dom, das 8h às 22h (só se o cliente pedir o fim de semana ou não puder de segunda a sexta): sáb 07/11: 08:00, 09:00, ",
    ),
    sabDom,
  );
  assert.ok(sabDom.includes("21:00 · dom 08/11: 08:00"), sabDom);
  const semPrioritaria = livres.filter((h) => ag.faixaDoHorario(h.inicio) !== 0);
  assert.ok(ag.horariosPorDia(semPrioritaria, agora).startsWith("seg a sex, das 18h às 22h (ofereça estes primeiro): seg 02/11 (hoje): 18:00"));
  const soFimDeSemana = livres.filter((h) => ag.faixaDoHorario(h.inicio) === 2);
  assert.equal(ag.horariosPorDia(soFimDeSemana, agora).split("\n").length, 1);
  assert.ok(ag.horariosPorDia(soFimDeSemana, agora).startsWith("sáb e dom, das 8h às 22h (ofereça estes primeiro): sáb 07/11: 08:00"));
  assert.equal(ag.horariosPorDia([], agora), "");

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
  assert.deepEqual(horasDoDia(await ag.horariosLivres(agora)), [8, 9, 11, 14, 15, 16, 17, 18, 19, 20, 21]);
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
  assert.deepEqual(horasDoDia(await ag.horariosLivres(agora)), [8, 9, 11, 14, 15, 17, 18, 19, 20, 21]);
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

  // 7b. A descrição do evento (2026-11-06): nome, número, e-mail e o link do
  //     CRM, para a oportunidade ou, sem ela, para a ficha do contato.
  assert.equal(
    criados[0].description,
    "Reunião online de 1 hora pelo Google Meet.\n\nNome: Teste\nNo CRM: https://amaanoffice.amaan.com.br/contatos?contato=c",
  );
  contatoDoBanco = { nome: " Maria Lead ", email: "maria@exemplo.com", whatsapp: "5547999990000" };
  await assert.rejects(
    ag.marcarReuniao({ ...base, oportunidadeId: "o1", inicio: ag.instanteEmBrasilia(...D, 14), autorId: null, quem: "IA" }),
    /POST chamado/,
  );
  assert.equal(
    criados.at(-1).description,
    "Reunião online de 1 hora pelo Google Meet.\n\nNome: Maria Lead\nWhatsApp: 5547999990000\nE-mail: maria@exemplo.com\n" +
      "No CRM: https://amaanoffice.amaan.com.br/?op=o1",
  );
  assert.equal(criados.at(-1).summary, "Reunião AMAAN com Maria Lead");
  contatoDoBanco = { nome: "Teste", email: null, whatsapp: null };

  // 9. A remarcação (2026-11-05): o MESMO evento, só o horário, com a mesma
  //    duração; o próprio evento não ocupa o horário novo; a agenda da Fernanda
  //    barra; o banco muda junto; o convidado com e-mail recebe a atualização.
  EVENTOS.primary.push(ev("minha", 14));
  reuniaoDoBanco = {
    google_evento_id: "minha",
    inicio: ag.instanteEmBrasilia(...D, 14),
    fim: ag.instanteEmBrasilia(...D, 15),
    contato_id: "c",
    oportunidade_id: "o",
    email: "lead@exemplo.com",
  };
  const novo = new Date(ag.instanteEmBrasilia(...D, 14).getTime() + 30 * 60_000);
  const r = await ag.remarcarReuniao({ reuniaoId: "r1", inicio: novo, conferirAgendasQueOcupam: true });
  assert.equal(patches.length, 1, "o próprio evento (14h) não ocupa o horário novo (14h30)");
  assert.deepEqual([patches[0].id, patches[0].sendUpdates], ["minha", "all"]);
  assert.equal(patches[0].corpo.start.dateTime, novo.toISOString());
  assert.equal(patches[0].corpo.end.dateTime, new Date(novo.getTime() + 3_600_000).toISOString(), "mesma duração da reunião (1h)");
  assert.deepEqual(
    [r.antes.toISOString(), r.inicio.toISOString(), r.meet, r.convidou],
    [reuniaoDoBanco.inicio.toISOString(), novo.toISOString(), "https://meet.google.com/aaa-bbbb-ccc", true],
  );
  assert.equal(atualizacoes.length, 1, "agenda_reunioes muda junto (os lembretes leem a hora dali)");
  await assert.rejects(
    ag.remarcarReuniao({ reuniaoId: "r1", inicio: ag.instanteEmBrasilia(...D, 10), conferirAgendasQueOcupam: true }),
    (e) => e instanceof ag.HorarioOcupado,
    "remarcar para as 10h: ocupado na agenda da Fernanda",
  );
  assert.equal(patches.length, 1, "horário ocupado não chega ao Google");
  reuniaoDoBanco = null;
  await assert.rejects(ag.remarcarReuniao({ reuniaoId: "r2", inicio: novo }), /Reunião não encontrada/);
  assert.equal(comPrazo.PATCH, 0, "remarcar espera o Google, sem prazo");
} finally {
  console.error = erroOriginal;
}
console.log(
  "OK: janela das 8h às 22h com sábado e domingo e as três faixas de oferta para a IA, agendas que ocupam o horário (Fernanda sim, Fabricio não; na da conexão, evento com horário sempre, dia inteiro só se ocupado, recusado e local de trabalho nunca), falha fechada, prazo só na leitura, corpo cortado, cota, renomeada, repetida, escondida, reserva da IA x ficha, descrição com o link do CRM e remarcação.",
);
