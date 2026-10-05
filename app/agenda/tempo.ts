// O relógio da Agenda: tudo em Brasília, no servidor (UTC, na Vercel) e no
// navegador (o fuso de quem abre). Sem "server-only": a grade usa no cliente.
//
// Datas de calendário andam como texto "AAAA-MM-DD" e a conta de dias é feita
// em UTC puro — somar um dia a "2026-10-31" não pode depender de horário de
// verão nem do fuso da máquina. O instante (Date) só aparece para comparar
// com os eventos do Google.

export const FUSO = "America/Sao_Paulo";

export type Visao = "dia" | "semana" | "mes" | "lista";
export const VISOES: readonly Visao[] = ["dia", "semana", "mes", "lista"];

/** Quantos dias a visão Lista cobre a partir da data escolhida. */
export const DIAS_DA_LISTA = 14;

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
  return {
    data: `${p.year}-${p.month}-${p.day}`,
    hora: Number(p.hour),
    minuto: Number(p.minute),
    offset: m?.[1] ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0,
  };
}

/** "2026-10-02" do instante, no calendário de Brasília. */
export const diaDe = (d: Date | string) => partes(new Date(d)).data;

/** Minutos desde a meia-noite (Brasília) do dia do instante. */
export function minutosDe(d: Date | string): number {
  const p = partes(new Date(d));
  return p.hora * 60 + p.minuto;
}

const pedacos = (data: string) => data.split("-").map(Number) as [number, number, number];

/** O instante da meia-noite de uma data, em Brasília. */
export function meiaNoite(data: string): Date {
  const [a, m, d] = pedacos(data);
  const comoUtc = Date.UTC(a, m - 1, d);
  // Duas passadas: o deslocamento certo é o DO instante procurado.
  const palpite = new Date(comoUtc - partes(new Date(comoUtc)).offset * 60_000);
  return new Date(comoUtc - partes(palpite).offset * 60_000);
}

export function somarDias(data: string, dias: number): string {
  const [a, m, d] = pedacos(data);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = pedacos(data);
  // Dia 31 + 1 mês não pode virar dia 1 do mês seguinte ao seguinte.
  const ultimo = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(data: string): number {
  const [a, m, d] = pedacos(data);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** A segunda-feira da semana da data (a semana do CRM começa na segunda). */
export function segundaDa(data: string): string {
  const s = diaDaSemana(data);
  return somarDias(data, s === 0 ? -6 : 1 - s);
}

export const primeiroDoMes = (data: string) => `${data.slice(0, 7)}-01`;

/** As 42 datas (6 semanas) da grade do mês, começando na segunda. */
export function gradeDoMes(data: string): string[] {
  const inicio = segundaDa(primeiroDoMes(data));
  return Array.from({ length: 42 }, (_, i) => somarDias(inicio, i));
}

/** Os dias que a visão mostra, e a janela [de, ate) que se pede ao Google. */
export function janelaDa(visao: Visao, data: string): { dias: string[]; de: string; ate: string } {
  if (visao === "dia") return { dias: [data], de: data, ate: somarDias(data, 1) };
  if (visao === "semana") {
    const seg = segundaDa(data);
    const dias = Array.from({ length: 7 }, (_, i) => somarDias(seg, i));
    return { dias, de: seg, ate: somarDias(seg, 7) };
  }
  if (visao === "mes") {
    const dias = gradeDoMes(data);
    return { dias, de: dias[0], ate: somarDias(dias[41], 1) };
  }
  const dias = Array.from({ length: DIAS_DA_LISTA }, (_, i) => somarDias(data, i));
  return { dias, de: data, ate: somarDias(data, DIAS_DA_LISTA) };
}

/** Anda uma "página" da visão para frente (+1) ou para trás (-1). */
export function andar(visao: Visao, data: string, passo: 1 | -1): string {
  if (visao === "dia") return somarDias(data, passo);
  if (visao === "semana") return somarDias(data, 7 * passo);
  if (visao === "mes") return somarMeses(primeiroDoMes(data), passo);
  return somarDias(data, DIAS_DA_LISTA * passo);
}

// ── Textos ────────────────────────────────────────────────────────────────────
// Formatadores com fuso fixo: o servidor e o navegador escrevem a mesma coisa,
// e a hidratação não diverge.

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS_LONGOS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

/** "09:30" */
export const hora = (d: Date | string) => fmtHora.format(new Date(d));

/** "9h", "9h30" — o rótulo curto dos cartões da grade. */
export function horaCurta(d: Date | string): string {
  const m = minutosDe(d);
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h${String(m % 60).padStart(2, "0")}` : `${h}h`;
}

export const numeroDoDia = (data: string) => Number(data.slice(8, 10));
export const nomeDoMes = (data: string) => MESES[Number(data.slice(5, 7)) - 1];
export const diaCurto = (data: string) => DIAS_CURTOS[diaDaSemana(data)];

/** "sexta-feira, 2 de outubro" */
export const diaPorExtenso = (data: string) =>
  `${DIAS_LONGOS[diaDaSemana(data)]}, ${numeroDoDia(data)} de ${nomeDoMes(data)}`;

/** "2 out" */
export const diaEMes = (data: string) => `${numeroDoDia(data)} ${MESES_CURTOS[Number(data.slice(5, 7)) - 1]}`;

/** O título da página para a visão: "outubro de 2026", "28 set – 4 out 2026"… */
export function tituloDaJanela(visao: Visao, data: string): string {
  const ano = data.slice(0, 4);
  if (visao === "dia") return `${diaPorExtenso(data)} de ${ano}`;
  if (visao === "mes") return `${nomeDoMes(data)} de ${ano}`;
  const { dias } = janelaDa(visao, data);
  const primeiro = dias[0];
  const ultimo = dias[dias.length - 1];
  const anoFim = ultimo.slice(0, 4);
  if (primeiro.slice(0, 7) === ultimo.slice(0, 7)) {
    return `${numeroDoDia(primeiro)} – ${diaEMes(ultimo)} ${anoFim}`;
  }
  return `${diaEMes(primeiro)}${primeiro.slice(0, 4) !== anoFim ? ` ${primeiro.slice(0, 4)}` : ""} – ${diaEMes(ultimo)} ${anoFim}`;
}

/** "10:00 – 11:00", "Dia inteiro", ou com as datas quando passa de um dia. */
export function intervalo(inicio: string, fim: string, diaInteiro: boolean): string {
  if (diaInteiro) {
    const ultimo = somarDias(diaDe(fim), -1);
    return ultimo === diaDe(inicio) ? "Dia inteiro" : `${diaEMes(diaDe(inicio))} – ${diaEMes(ultimo)}`;
  }
  if (diaDe(inicio) === diaDe(fim)) return `${hora(inicio)} – ${hora(fim)}`;
  return `${diaEMes(diaDe(inicio))}, ${hora(inicio)} – ${diaEMes(diaDe(fim))}, ${hora(fim)}`;
}

/** Duração em texto: "30 min", "1h", "1h30". */
export function duracao(inicio: string, fim: string): string {
  const min = Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h}h${String(min % 60).padStart(2, "0")}` : `${h}h`;
}
