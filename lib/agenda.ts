// A Agenda: o Google Calendar da conta da empresa (lib/google-oauth.ts) visto
// pelo CRM. Três usos, uma porta só:
//
//   · a tela /agenda lista os compromissos da semana (eventosEntre);
//   · a ficha da oportunidade marca reunião num horário escolhido à mão;
//   · a IA comercial oferece os horários livres e marca quando o lead escolhe
//     (ação agendar_reuniao, lib/ia/atendente.ts).
//
// O que fica no banco é só o VÍNCULO (agenda_reunioes): qual evento do Google
// é de qual contato/oportunidade, com início e fim. O evento em si — título,
// link do Meet, se foi cancelado — mora no Google e é lido de lá.
//
// SEM SDK, como lib/google-sa.ts: são três endpoints REST (listar, ler, criar),
// e o pacote `googleapis` traria todas as APIs do Google para o bundle.
import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { acessoGoogle, esquecerTokenGoogle, GoogleDesconectado } from "@/lib/google-oauth";

const API = "https://www.googleapis.com/calendar/v3";
export const FUSO = "America/Sao_Paulo";

/**
 * Os horários que a IA pode oferecer (decisões dele, 2026-10-02: fixo no
 * código; das 10h; 10 dias úteis para achar o dia que o lead sugerir). Seg a
 * sex, das 10h às 18h de Brasília — a última começa às 17h —, reuniões de 1h,
 * nos próximos 10 dias úteis com horário, e com 2h de antecedência no mínimo
 * — sempre só onde a agenda do Google está livre. A IA oferece os mais
 * próximos primeiro; o resto da lista serve para o dia que ele pedir.
 */
export const REGRA_HORARIOS = {
  diasUteis: 10,
  abre: 10,
  fecha: 18,
  duracaoMin: 60,
  antecedenciaMin: 120,
} as const;

/** Uma agenda da conta conectada (Google: "Minhas agendas" e "Outras agendas"). */
export type AgendaGoogle = {
  id: string;
  nome: string;
  /** Cor da agenda no Google ("#9fe1e7"), ou null. */
  cor: string | null;
  principal: boolean;
  /** Marcada para aparecer no Google Calendar da conta — é o padrão da tela. */
  marcadaNoGoogle: boolean;
};

/** Um participante do evento, como o Google devolve. */
export type ParticipanteEvento = {
  nome: string | null;
  email: string | null;
  resposta: "aceito" | "recusou" | "talvez" | "pendente";
  organizador: boolean;
  /** É a própria conta conectada. */
  conta: boolean;
};

/** Um compromisso do Google, já no formato da tela. */
export type EventoAgenda = {
  id: string;
  /** De qual agenda veio (id do Google). */
  agendaId: string;
  titulo: string;
  /** ISO. No evento de dia inteiro, meia-noite (Brasília) do primeiro dia. */
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  meet: string | null;
  /** Abre o evento no Google Calendar. */
  link: string | null;
  local: string | null;
  /** Bloqueia a agenda? Falso para "disponível", recusado e cancelado. */
  ocupa: boolean;
  /** Descrição em texto puro (o Google manda HTML). */
  descricao: string | null;
  participantes: ParticipanteEvento[];
  /** Nome ou e-mail de quem organizou. */
  organizador: string | null;
  /** Cor própria do evento (escolhida no Google), que vale sobre a da agenda. */
  cor: string | null;
  recorrente: boolean;
};

/** Um horário livre para reunião, com o rótulo que a IA usa para escolhê-lo. */
export type HorarioLivre = { inicio: Date; fim: Date; rotulo: string };

/** O horário escolhido já não está livre (outro compromisso entrou antes). */
export class HorarioOcupado extends Error {
  constructor() {
    super("Esse horário acabou de ser ocupado na agenda.");
    this.name = "HorarioOcupado";
  }
}

// ── Relógio de Brasília ───────────────────────────────────────────────────────
//
// O servidor roda em UTC (Vercel). "Amanhã às 10h" é 10h em Brasília, e o
// deslocamento vem do Intl em vez de um -3 fixo: se o horário de verão voltar,
// nada aqui muda.

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const fmtPartes = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

function partes(d: Date) {
  const p = Object.fromEntries(fmtPartes.formatToParts(d).map((x) => [x.type, x.value]));
  const m = /GMT(?:([+-])(\d{2}):?(\d{2})?)?/.exec(p.timeZoneName ?? "");
  const offset = m?.[1] ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    /** Minutos em relação ao UTC (Brasília hoje: -180). */
    offset,
  };
}

/** O instante de "dia/mês/ano hh:mm" no relógio de Brasília. */
export function instanteEmBrasilia(ano: number, mes: number, dia: number, hora = 0, minuto = 0): Date {
  const comoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto);
  // Duas passadas: o deslocamento certo é o DO instante procurado, e a
  // primeira estimativa pode cair do outro lado de uma troca de horário.
  const palpite = new Date(comoUtc - partes(new Date(comoUtc)).offset * 60_000);
  return new Date(comoUtc - partes(palpite).offset * 60_000);
}

/** "2026-10-02" de um instante, no calendário de Brasília. */
export function diaEmBrasilia(d: Date): string {
  const p = partes(d);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

/** "15:00" de um instante, no relógio de Brasília. */
export function horaEmBrasilia(d: Date): string {
  const p = partes(d);
  return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
}

/** "qui 02/10 15:00" — o rótulo do horário, e o valor que a IA devolve. */
export function rotuloDoHorario(d: Date): string {
  const p = partes(d);
  const semana = DIAS[new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay()];
  const dd = String(p.dia).padStart(2, "0");
  const mm = String(p.mes).padStart(2, "0");
  return `${semana} ${dd}/${mm} ${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
}

// ── Chamadas ao Google ────────────────────────────────────────────────────────

/**
 * Uma chamada à API do Calendar com o token da conta conectada. `caminho`
 * recebe o id da agenda já codificado: a da conexão (onde as reuniões são
 * marcadas), ou `agenda` quando a tela lê outra.
 */
async function chamar<T>(
  metodo: "GET" | "POST" | "DELETE",
  caminho: (calendarioId: string) => string,
  busca: Record<string, string> = {},
  corpo?: unknown,
  agenda?: string,
  renovou = false,
): Promise<T> {
  const { token, calendarioId } = await acessoGoogle();
  const url = new URL(API + caminho(encodeURIComponent(agenda ?? calendarioId)));
  for (const [k, v] of Object.entries(busca)) url.searchParams.set(k, v);

  const r = await fetch(url, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      ...(corpo ? { "content-type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    cache: "no-store",
  });
  const dado = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (r.status === 401) {
    // 401 com o token GUARDADO não quer dizer conexão caída: o token pode ter
    // sido recusado antes da hora. Renova e tenta UMA vez — seguro inclusive
    // no POST, porque 401 é recusa antes de qualquer efeito. Só se o token
    // novo também levar 401 é que o acesso foi revogado lá no Google.
    if (!renovou) {
      console.warn("[google] 401 com o token guardado; renovando e tentando de novo");
      esquecerTokenGoogle();
      return chamar<T>(metodo, caminho, busca, corpo, agenda, true);
    }
    throw new GoogleDesconectado(dado.error?.message ?? "acesso revogado");
  }
  if (!r.ok) throw new Error(`Google Calendar respondeu ${r.status}: ${dado.error?.message ?? "sem detalhe"}`);
  return dado;
}

type EventoGoogle = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  transparency?: string;
  colorId?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    self?: boolean;
    organizer?: boolean;
    resource?: boolean;
    responseStatus?: string;
  }>;
};

// A cor própria de um EVENTO (colorId 1–11: Lavanda, Sálvia, Uva, Flamingo,
// Banana, Tangerina, Pavão, Grafite, Mirtilo, Manjericão, Tomate), nos tons
// que a interface atual do Google mostra. A paleta é fixa; GET /colors traria
// a versão antiga dos tons, a um custo de chamada e escopo a mais.
const CORES_DE_EVENTO: Record<string, string> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "#0b8043",
  "11": "#d50000",
};

const RESPOSTA: Record<string, ParticipanteEvento["resposta"]> = {
  accepted: "aceito",
  declined: "recusou",
  tentative: "talvez",
};

/**
 * A descrição do Google em texto puro. Ela vem em HTML (negrito, links,
 * quebras); a tela mostra texto — e transforma URL em link ela mesma —, então
 * nada do HTML de terceiros chega a ser interpretado no CRM.
 */
function textoDaDescricao(html: string | undefined): string | null {
  if (!html?.trim()) return null;
  const texto = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    // Link com texto diferente da URL: guarda a URL, que é o que importa.
    .replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href: string, rotulo: string) =>
      rotulo.replace(/<[^>]+>/g, "").trim() === href ? href : `${rotulo} (${href})`,
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return texto || null;
}

/** "2026-10-03" (data do evento de dia inteiro) → meia-noite em Brasília. */
function meiaNoite(data: string): Date {
  const [a, m, d] = data.split("-").map(Number);
  return instanteEmBrasilia(a, m, d);
}

function paraEvento(e: EventoGoogle, agendaId: string): EventoAgenda {
  const diaInteiro = !e.start?.dateTime;
  const inicio = e.start?.dateTime ? new Date(e.start.dateTime) : meiaNoite(e.start?.date ?? "1970-01-01");
  const fim = e.end?.dateTime ? new Date(e.end.dateTime) : meiaNoite(e.end?.date ?? "1970-01-01");
  const recusado = e.attendees?.some((a) => a.self && a.responseStatus === "declined") ?? false;
  return {
    id: e.id,
    agendaId,
    // Agenda compartilhada só como "ver disponibilidade" devolve o horário sem
    // título: é um bloco ocupado, e é isso que a tela diz.
    titulo: e.summary?.trim() || "Ocupado",
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    diaInteiro,
    meet: e.hangoutLink ?? null,
    link: e.htmlLink ?? null,
    local: e.location?.trim() || null,
    ocupa: e.status !== "cancelled" && e.transparency !== "transparent" && !recusado,
    descricao: textoDaDescricao(e.description),
    participantes: (e.attendees ?? [])
      // Sala de reunião é recurso, não pessoa.
      .filter((a) => !a.resource)
      .map((a) => ({
        nome: a.displayName?.trim() || null,
        email: a.email ?? null,
        resposta: RESPOSTA[a.responseStatus ?? ""] ?? "pendente",
        organizador: Boolean(a.organizer),
        conta: Boolean(a.self),
      })),
    organizador: e.organizer?.displayName?.trim() || e.organizer?.email || null,
    cor: (e.colorId && CORES_DE_EVENTO[e.colorId]) || null,
    recorrente: Boolean(e.recurringEventId),
  };
}

/**
 * Os compromissos entre `de` e `ate`, em ordem de início (recorrentes já
 * abertos). Sem `agenda`, os da agenda da conexão — a das reuniões.
 */
export async function eventosEntre(de: Date, ate: Date, agenda?: string): Promise<EventoAgenda[]> {
  const eventos: EventoAgenda[] = [];
  let pagina: string | undefined;
  // Teto de 4 páginas (1.000 eventos): uma semana não chega perto disso, e um
  // laço sem teto numa API externa é como uma função fica pendurada.
  for (let i = 0; i < 4; i++) {
    const r = await chamar<{ items?: EventoGoogle[]; nextPageToken?: string }>(
      "GET",
      (cal) => `/calendars/${cal}/events`,
      {
        timeMin: de.toISOString(),
        timeMax: ate.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
        timeZone: FUSO,
        ...(pagina ? { pageToken: pagina } : {}),
      },
      undefined,
      agenda,
    );
    const origem = agenda ?? "primary";
    eventos.push(...(r.items ?? []).filter((e) => e.status !== "cancelled").map((e) => paraEvento(e, origem)));
    pagina = r.nextPageToken;
    if (!pagina) break;
  }
  return eventos;
}

/**
 * As agendas da conta conectada, a principal primeiro. Sem a permissão de
 * listar (ESCOPO_AGENDAS — conta conectada antes dela, ou caixa desmarcada no
 * consentimento), volta só a principal e `podeListar: false`, para a tela
 * pedir a reconexão em vez de quebrar.
 */
export async function agendasDaConta(): Promise<{ agendas: AgendaGoogle[]; podeListar: boolean }> {
  type Item = {
    id: string;
    summary?: string;
    summaryOverride?: string;
    backgroundColor?: string;
    primary?: boolean;
    selected?: boolean;
  };
  const itens: Item[] = [];
  try {
    let pagina: string | undefined;
    for (let i = 0; i < 4; i++) {
      const r = await chamar<{ items?: Item[]; nextPageToken?: string }>("GET", () => "/users/me/calendarList", {
        maxResults: "250",
        ...(pagina ? { pageToken: pagina } : {}),
      });
      itens.push(...(r.items ?? []));
      pagina = r.nextPageToken;
      if (!pagina) break;
    }
  } catch (e) {
    // 403 = o token não tem o escopo da lista. Qualquer outro erro sobe.
    if (e instanceof Error && / 403:/.test(e.message)) {
      const { contaEmail } = await acessoGoogle();
      return {
        agendas: [{ id: "primary", nome: contaEmail, cor: null, principal: true, marcadaNoGoogle: true }],
        podeListar: false,
      };
    }
    throw e;
  }

  const agendas = itens.map((c) => ({
    id: c.id,
    // summaryOverride é o nome que a própria conta deu a uma agenda de outra pessoa.
    nome: c.summaryOverride?.trim() || c.summary?.trim() || c.id,
    cor: c.backgroundColor ?? null,
    principal: Boolean(c.primary),
    marcadaNoGoogle: Boolean(c.selected) || Boolean(c.primary),
  }));
  return {
    agendas: agendas.sort((a, b) => Number(b.principal) - Number(a.principal) || a.nome.localeCompare(b.nome, "pt-BR")),
    podeListar: true,
  };
}

/**
 * Os compromissos de várias agendas na mesma janela. Uma agenda que falhar
 * (permissão retirada, agenda apagada) não derruba as outras: volta em
 * `falhas`. A conexão caída, sim — aí nenhuma funcionaria.
 *
 * O mesmo evento pode estar em duas agendas (convite de uma para a outra):
 * aparece uma vez, na primeira da lista.
 */
export async function eventosDasAgendas(
  de: Date,
  ate: Date,
  agendas: string[],
): Promise<{ eventos: EventoAgenda[]; falhas: string[] }> {
  const resultados = await Promise.allSettled(agendas.map((id) => eventosEntre(de, ate, id)));
  const vistos = new Set<string>();
  const eventos: EventoAgenda[] = [];
  const falhas: string[] = [];
  resultados.forEach((r, i) => {
    if (r.status === "rejected") {
      if (r.reason instanceof GoogleDesconectado) throw r.reason;
      console.error("[agenda] não leu a agenda", agendas[i], r.reason);
      falhas.push(agendas[i]);
      return;
    }
    for (const e of r.value) {
      if (vistos.has(e.id)) continue;
      vistos.add(e.id);
      eventos.push(e);
    }
  });
  eventos.sort((a, b) => a.inicio.localeCompare(b.inicio));
  return { eventos, falhas };
}

/** Um evento pelo id, ou null se não existe mais (apagado no Google). */
export async function eventoPorId(id: string): Promise<(EventoAgenda & { cancelado: boolean }) | null> {
  try {
    const e = await chamar<EventoGoogle>("GET", (cal) => `/calendars/${cal}/events/${encodeURIComponent(id)}`);
    return { ...paraEvento(e, "primary"), cancelado: e.status === "cancelled" };
  } catch (e) {
    if (e instanceof Error && / 404:| 410:/.test(e.message)) return null;
    throw e;
  }
}

const sobrepoe = (a: { inicio: Date; fim: Date }, b: EventoAgenda) =>
  b.ocupa && new Date(b.inicio) < a.fim && new Date(b.fim) > a.inicio;

// ── Horários livres ───────────────────────────────────────────────────────────

/**
 * Os horários de reunião que ainda estão livres, segundo REGRA_HORARIOS: os
 * dos próximos dias úteis QUE TÊM horário livre. Dia lotado ou bloqueado
 * (feriado marcado como dia inteiro) não conta, nem "hoje" depois das 16h.
 *
 * Olha no máximo 3 semanas à frente: agenda cheia nesse tempo devolve menos
 * dias (ou nenhum), e a IA cai no avisar_equipe.
 */
export async function horariosLivres(agora = new Date()): Promise<HorarioLivre[]> {
  const { diasUteis, abre, fecha, duracaoMin, antecedenciaMin } = REGRA_HORARIOS;
  const minimo = agora.getTime() + antecedenciaMin * 60_000;
  const hoje = partes(agora);

  // Todos os horários de expediente da janela, por dia.
  const porDia: Array<Array<{ inicio: Date; fim: Date }>> = [];
  for (let i = 0; i < 21; i++) {
    const data = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + i));
    const semana = data.getUTCDay();
    if (semana === 0 || semana === 6) continue;

    const doDia: Array<{ inicio: Date; fim: Date }> = [];
    for (let min = abre * 60; min + duracaoMin <= fecha * 60; min += duracaoMin) {
      const inicio = instanteEmBrasilia(data.getUTCFullYear(), data.getUTCMonth() + 1, data.getUTCDate(), Math.floor(min / 60), min % 60);
      if (inicio.getTime() < minimo) continue;
      doDia.push({ inicio, fim: new Date(inicio.getTime() + duracaoMin * 60_000) });
    }
    if (doDia.length) porDia.push(doDia);
  }
  if (porDia.length === 0) return [];

  // Uma ida ao Google para a janela inteira, e não uma por dia.
  const ultimo = porDia[porDia.length - 1];
  const ocupados = await eventosEntre(porDia[0][0].inicio, ultimo[ultimo.length - 1].fim);

  return porDia
    .map((doDia) => doDia.filter((c) => !ocupados.some((e) => sobrepoe(c, e))))
    .filter((livres) => livres.length > 0)
    .slice(0, diasUteis)
    .flat()
    .map((c) => ({ ...c, rotulo: rotuloDoHorario(c.inicio) }));
}

/**
 * "sex 02/10 (hoje): 17:00 · seg 05/10: 10:00, 11:00" — os horários livres por
 * dia, para a IA ler. O "(hoje)" e o "(amanhã)" não são enfeite: sem eles o
 * modelo ofereceu "hoje às 16h" quando 16h de hoje já não estava na lista, e
 * marcou a sexta da semana seguinte no lugar (simulação de 2026-10-02).
 */
export function horariosPorDia(horarios: HorarioLivre[], agora = new Date()): string {
  const diaDe = (d: Date) => rotuloDoHorario(d).split(" ").slice(0, 2).join(" ");
  const hoje = diaDe(agora);
  const amanha = diaDe(new Date(agora.getTime() + 24 * 3600_000));
  const dias = new Map<string, string[]>();
  for (const h of horarios) {
    const [semana, data, hora] = h.rotulo.split(" ");
    const dia = `${semana} ${data}`;
    dias.set(dia, [...(dias.get(dia) ?? []), hora]);
  }
  return [...dias]
    .map(([dia, horas]) => `${dia}${dia === hoje ? " (hoje)" : dia === amanha ? " (amanhã)" : ""}: ${horas.join(", ")}`)
    .join(" · ");
}

// ── Marcar reunião ────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ReuniaoMarcada = {
  id: string;
  eventoId: string;
  inicio: Date;
  fim: Date;
  meet: string | null;
  /** O convite do Google foi para o e-mail do contato? */
  convidou: boolean;
};

/**
 * Cria a reunião no Google (com Meet), grava o vínculo e a linha do histórico.
 * Confere o horário de novo logo antes de criar: entre oferecer e o lead
 * escolher, alguém pode ter marcado outra coisa ali — aí lança HorarioOcupado.
 *
 * `autorId` null = a IA (`quem` diz qual, para o histórico).
 */
export async function marcarReuniao(e: {
  contatoId: string;
  oportunidadeId: string | null;
  inicio: Date;
  duracaoMin?: number;
  autorId: string | null;
  quem: string;
}): Promise<ReuniaoMarcada> {
  const inicio = e.inicio;
  const fim = new Date(inicio.getTime() + (e.duracaoMin ?? REGRA_HORARIOS.duracaoMin) * 60_000);

  const [c] = await sql`
    SELECT c.nome, c.email, c.whatsapp
      FROM contatos c
     WHERE c.id = ${e.contatoId}`;
  if (!c) throw new Error("Contato não encontrado.");

  const ocupados = await eventosEntre(inicio, fim);
  if (ocupados.some((x) => sobrepoe({ inicio, fim }, x))) throw new HorarioOcupado();

  const email = typeof c.email === "string" && EMAIL.test(c.email.trim()) ? c.email.trim() : null;
  const nome = (c.nome as string)?.trim() || "contato";
  // A descrição vai no CONVITE que o lead recebe por e-mail: nada de bastidor
  // ("marcada pelo Chroma", "pela IA", nome interno da oportunidade). Quem
  // marcou e de qual oportunidade é fica no CRM (histórico, agenda_reunioes e
  // extendedProperties abaixo). Pedido dele, 2026-10-02.
  const minutos = Math.round((fim.getTime() - inicio.getTime()) / 60_000);
  const duracao = minutos % 60 ? (minutos < 60 ? `${minutos} minutos` : `${Math.floor(minutos / 60)}h${minutos % 60}`) : minutos === 60 ? "1 hora" : `${minutos / 60} horas`;
  const descricao = [
    `Reunião online de ${duracao} pelo Google Meet.`,
    c.whatsapp || email ? "" : null,
    c.whatsapp ? `WhatsApp: ${c.whatsapp}` : null,
    email ? `E-mail: ${email}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const criado = await chamar<EventoGoogle>(
    "POST",
    (cal) => `/calendars/${cal}/events`,
    // conferenceDataVersion=1 é o que faz o Google criar o Meet. sendUpdates:
    // o convite por e-mail só sai quando há e-mail de verdade no cadastro.
    { conferenceDataVersion: "1", sendUpdates: email ? "all" : "none" },
    {
      // Título lido dos dois lados: na agenda da AMAAN diz com quem é; no
      // convite do lead diz de quem é.
      summary: `Reunião AMAAN com ${nome}`,
      description: descricao,
      start: { dateTime: inicio.toISOString(), timeZone: FUSO },
      end: { dateTime: fim.toISOString(), timeZone: FUSO },
      ...(email ? { attendees: [{ email, displayName: nome }] } : {}),
      conferenceData: {
        createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
      // De onde o evento veio, para quem abrir no Google e para auditoria.
      extendedProperties: {
        private: { chroma_contato: e.contatoId, chroma_oportunidade: e.oportunidadeId ?? "" },
      },
    },
  );

  let id: string;
  try {
    const [l] = await sql`
      INSERT INTO agenda_reunioes (google_evento_id, contato_id, oportunidade_id, inicio, fim, autor_id)
      VALUES (${criado.id}, ${e.contatoId}, ${e.oportunidadeId}, ${inicio}, ${fim}, ${e.autorId})
      RETURNING id`;
    id = l.id as string;
  } catch (erro) {
    // Sem o vínculo o evento ficaria órfão: no Google, mas invisível no CRM e
    // para a IA. Desfaz no Google (sem avisar o convidado) e deixa o erro subir.
    await chamar("DELETE", (cal) => `/calendars/${cal}/events/${encodeURIComponent(criado.id)}`, {
      sendUpdates: "none",
    }).catch((x) => console.error("[agenda] evento ficou órfão no Google:", criado.id, x));
    throw erro;
  }

  await sql`
    INSERT INTO historico (contato_id, oportunidade_id, descricao, autor_id)
    VALUES (${e.contatoId}, ${e.oportunidadeId},
            ${`Reunião marcada para ${rotuloDoHorario(inicio)} no Google Calendar${e.autorId ? "" : ` pela ${e.quem}`}.`},
            ${e.autorId})`;

  return { id, eventoId: criado.id, inicio, fim, meet: criado.hangoutLink ?? null, convidou: Boolean(email) };
}

// ── O vínculo, do lado do CRM ─────────────────────────────────────────────────

export type ReuniaoDoCrm = {
  id: string;
  eventoId: string;
  contatoId: string;
  oportunidadeId: string | null;
  inicio: string;
  fim: string;
  autorId: string | null;
  /** Do Google, quando deu para ler: link do Meet e se foi cancelada lá. */
  meet: string | null;
  link: string | null;
  cancelada: boolean;
  /** Já terminou, na hora da leitura (a tela não pode chamar o relógio no render). */
  passou: boolean;
};

type LinhaReuniao = {
  id: string;
  google_evento_id: string;
  contato_id: string;
  oportunidade_id: string | null;
  inicio: Date;
  fim: Date;
  autor_id: string | null;
};

/**
 * Completa as reuniões que ainda não passaram com o que só o Google sabe (Meet,
 * cancelamento, remarcação) e corrige início/fim no banco quando mudaram lá.
 * Google fora do ar não derruba quem chamou: volta o que o banco tem.
 */
async function completarDoGoogle(linhas: LinhaReuniao[]): Promise<ReuniaoDoCrm[]> {
  const ontem = Date.now() - 24 * 3600_000;
  return Promise.all(
    linhas.map(async (l) => {
      const base: ReuniaoDoCrm = {
        id: l.id,
        eventoId: l.google_evento_id,
        contatoId: l.contato_id,
        oportunidadeId: l.oportunidade_id,
        inicio: new Date(l.inicio).toISOString(),
        fim: new Date(l.fim).toISOString(),
        autorId: l.autor_id,
        meet: null,
        link: null,
        cancelada: false,
        passou: new Date(l.fim).getTime() < Date.now(),
      };
      if (new Date(l.fim).getTime() < ontem) return base;
      try {
        const ev = await eventoPorId(l.google_evento_id);
        if (!ev || ev.cancelado) return { ...base, cancelada: true };
        if (ev.inicio !== base.inicio || ev.fim !== base.fim) {
          await sql`UPDATE agenda_reunioes SET inicio = ${ev.inicio}, fim = ${ev.fim} WHERE id = ${l.id}`;
        }
        return {
          ...base,
          inicio: ev.inicio,
          fim: ev.fim,
          meet: ev.meet,
          link: ev.link,
          passou: new Date(ev.fim).getTime() < Date.now(),
        };
      } catch (e) {
        console.error("[agenda] não leu o evento no Google:", l.google_evento_id, e);
        return base;
      }
    }),
  );
}

/** As reuniões de uma oportunidade, mais novas primeiro. */
export async function reunioesDaOportunidade(oportunidadeId: string): Promise<ReuniaoDoCrm[]> {
  const linhas = (await sql`
    SELECT id, google_evento_id, contato_id, oportunidade_id, inicio, fim, autor_id
      FROM agenda_reunioes
     WHERE oportunidade_id = ${oportunidadeId}
     ORDER BY inicio DESC
     LIMIT 20`) as LinhaReuniao[];
  return completarDoGoogle(linhas);
}

/**
 * A próxima reunião do contato que continua de pé no Google, ou null. É o que
 * a IA lê antes de oferecer horário: quem já tem reunião não recebe outra.
 */
export async function proximaReuniaoDoContato(contatoId: string): Promise<ReuniaoDoCrm | null> {
  const linhas = (await sql`
    SELECT id, google_evento_id, contato_id, oportunidade_id, inicio, fim, autor_id
      FROM agenda_reunioes
     WHERE contato_id = ${contatoId} AND fim > now()
     ORDER BY inicio
     LIMIT 3`) as LinhaReuniao[];
  const completas = await completarDoGoogle(linhas);
  return completas.find((r) => !r.cancelada && !r.passou) ?? null;
}

/**
 * Uma reunião que o CRM marcou, com quem é o cliente — o que a tela /agenda
 * mostra no painel do evento e na lista "Agendados pelo Chroma".
 */
export type ReuniaoDoSistema = {
  id: string;
  eventoId: string;
  /** Como o CRM gravou ao marcar. Remarcada no Google, quem vale é o evento. */
  inicio: string;
  fim: string;
  marcadaEm: string;
  /** null = marcada pela IA. */
  autor: string | null;
  /** Terminou, na hora da leitura (a tela não chama o relógio no render). */
  passou: boolean;
  contato: {
    id: string;
    nome: string;
    whatsapp: string | null;
    email: string | null;
    cidade: string | null;
    estado: string | null;
  };
  oportunidade: {
    id: string;
    nome: string;
    valor: number;
    status: string;
    funil: string | null;
    etapa: string | null;
  } | null;
  /** A conversa mais recente com o contato, para o atalho do chat. */
  atendimentoId: string | null;
};

/**
 * As reuniões marcadas pelo CRM, SÓ LEITURA. Com `eventoIds`, as desses
 * eventos (o painel da tela); sem, as que terminam de `desde` em diante (a
 * lista lateral), da mais próxima para a mais distante.
 */
export async function reunioesDoSistema(filtro: {
  eventoIds?: string[];
  desde?: Date;
  limite?: number;
}): Promise<ReuniaoDoSistema[]> {
  if (filtro.eventoIds && filtro.eventoIds.length === 0) return [];
  // Ids de evento do Google são [a-v0-9_] — sem vírgula, então a lista vai como
  // UMA string e o Postgres monta o array (mesma razão de listaUuid, lib/db.ts).
  const ids = filtro.eventoIds ? filtro.eventoIds.join(",") : null;
  const linhas = await sql`
    SELECT ar.id, ar.google_evento_id, ar.inicio, ar.fim, ar.data_criacao, u.nome AS autor,
           c.id AS contato_id, c.nome AS contato_nome, c.whatsapp, c.email, c.cidade, c.estado,
           o.id AS op_id, o.nome AS op_nome, o.valor, o.status, f.nome AS funil, e.nome AS etapa,
           (SELECT a.id FROM atendimentos a
             WHERE a.contato_id = c.id
             ORDER BY a.data_atualizacao DESC NULLS LAST, a.data_criacao DESC
             LIMIT 1) AS atendimento_id
      FROM agenda_reunioes ar
      JOIN contatos c ON c.id = ar.contato_id
      LEFT JOIN oportunidades o ON o.id = ar.oportunidade_id
      LEFT JOIN funis f ON f.id = o.funil_id
      LEFT JOIN etapas e ON e.id = o.etapa_id
      LEFT JOIN usuarios u ON u.id = ar.autor_id
     WHERE (${ids}::text IS NULL OR ar.google_evento_id = ANY(string_to_array(${ids}, ',')))
       AND (${filtro.desde ?? null}::timestamptz IS NULL OR ar.fim >= ${filtro.desde ?? null})
     ORDER BY ar.inicio
     LIMIT ${filtro.limite ?? 200}`;

  const agora = Date.now();
  return linhas.map((l) => ({
    id: l.id as string,
    eventoId: l.google_evento_id as string,
    inicio: new Date(l.inicio).toISOString(),
    fim: new Date(l.fim).toISOString(),
    marcadaEm: new Date(l.data_criacao).toISOString(),
    autor: (l.autor as string | null) ?? null,
    passou: new Date(l.fim).getTime() < agora,
    contato: {
      id: l.contato_id as string,
      nome: l.contato_nome as string,
      whatsapp: (l.whatsapp as string | null) ?? null,
      email: (l.email as string | null) ?? null,
      cidade: (l.cidade as string | null) ?? null,
      estado: (l.estado as string | null) ?? null,
    },
    oportunidade: l.op_id
      ? {
          id: l.op_id as string,
          nome: l.op_nome as string,
          // numeric chega como texto (fetch_types:false, lib/db.ts).
          valor: Number(l.valor ?? 0),
          status: l.status as string,
          funil: (l.funil as string | null) ?? null,
          etapa: (l.etapa as string | null) ?? null,
        }
      : null,
    atendimentoId: (l.atendimento_id as string | null) ?? null,
  }));
}
