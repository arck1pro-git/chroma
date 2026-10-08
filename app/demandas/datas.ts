// As contas de data da tela de Demandas.
//
// TUDO NO FUSO DE BRASÍLIA, e com "hoje" e "agora" vindos do servidor (ver
// page.tsx): se o navegador usasse o relógio e o fuso dele, o SSR e a
// hidratação discordariam sobre "há 2 h" ou "vence hoje", e o React acusaria
// erro. Com a mesma referência dos dois lados, o texto sai igual.
//
// Datas "YYYY-MM-DD" são comparadas como texto (a ordem alfabética é a
// cronológica) e só viram Date ao meio-dia UTC, onde nenhuma virada de fuso
// troca o dia.

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const diaFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const horaFmt = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** O dia (YYYY-MM-DD) de um instante, em Brasília. */
export function diaDe(iso: string) {
  return diaFmt.format(new Date(iso));
}

export function horaDe(iso: string) {
  return horaFmt.format(new Date(iso));
}

function meioDia(dia: string) {
  return new Date(`${dia}T12:00:00Z`);
}

export function somarDias(dia: string, n: number) {
  const d = meioDia(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Quantos dias de `de` até `ate` (negativo quando `ate` já passou). */
export function diasEntre(de: string, ate: string) {
  return Math.round((meioDia(ate).getTime() - meioDia(de).getTime()) / 86_400_000);
}

/** "12 out" — o ano só aparece quando não é o corrente. */
export function diaCurto(dia: string, hoje: string) {
  const [ano, mes, d] = dia.split("-");
  const base = `${Number(d)} ${MESES[Number(mes) - 1]}`;
  return ano === hoje.slice(0, 4) ? base : `${base} ${ano}`;
}

/** "sex, 10 out" */
export function diaComSemana(dia: string, hoje: string) {
  return `${SEMANA[meioDia(dia).getUTCDay()]}, ${diaCurto(dia, hoje)}`;
}

export type TomDoPrazo = "atrasada" | "hoje" | "perto" | "longe";

/**
 * O prazo como a pessoa pensa nele: "atrasada há 3 dias", "vence hoje",
 * "amanhã", "sex, 10 out". Feita, ele vira só a data — atraso de coisa já
 * entregue não é alarme.
 */
export function prazoEmTexto(
  prazo: string,
  hoje: string,
  feita: boolean,
): { texto: string; tom: TomDoPrazo } {
  if (feita) return { texto: `Prazo ${diaCurto(prazo, hoje)}`, tom: "longe" };
  const dias = diasEntre(hoje, prazo);
  if (dias < 0) {
    const n = -dias;
    return { texto: `Atrasada há ${n} ${n === 1 ? "dia" : "dias"}`, tom: "atrasada" };
  }
  if (dias === 0) return { texto: "Vence hoje", tom: "hoje" };
  if (dias === 1) return { texto: "Amanhã", tom: "perto" };
  if (dias <= 6) return { texto: diaComSemana(prazo, hoje), tom: "perto" };
  return { texto: diaCurto(prazo, hoje), tom: "longe" };
}

/** "agora", "há 12 min", "há 3 h", "ontem", "5 out". */
export function haQuanto(iso: string, agora: string, hoje: string) {
  const min = Math.floor((new Date(agora).getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const dia = diaDe(iso);
  if (dia === hoje) return `há ${Math.floor(min / 60)} h`;
  if (dia === somarDias(hoje, -1)) return "ontem";
  return diaCurto(dia, hoje);
}

/** O título de um grupo de feitas: "Hoje", "Ontem", "seg, 5 out". */
export function rotuloDoDia(dia: string, hoje: string) {
  if (dia === hoje) return "Hoje";
  if (dia === somarDias(hoje, -1)) return "Ontem";
  return diaComSemana(dia, hoje);
}

// ── Colunas e filtros ───────────────────────────────────────────────────────

/**
 * A coluna do quadro de uma demanda PENDENTE, pelo prazo — é a pergunta de quem
 * abre a tela: o que já passou, o que é para hoje, o que vem depois (com prazo
 * mais adiante ou sem prazo nenhum). A feita vai para "Feitas", seja qual for.
 */
export type ColunaDePrazo = "atrasadas" | "hoje" | "fila";

export function colunaDoPrazo(prazo: string | null, hoje: string): ColunaDePrazo {
  if (!prazo || prazo > hoje) return "fila";
  return prazo < hoje ? "atrasadas" : "hoje";
}

export type FiltroDia = "qualquer" | "hoje" | "ontem" | "7d" | "30d";

export const OPCOES_DIA: { valor: FiltroDia; rotulo: string }[] = [
  { valor: "qualquer", rotulo: "Qualquer data" },
  { valor: "hoje", rotulo: "Criadas hoje" },
  { valor: "ontem", rotulo: "Criadas ontem" },
  { valor: "7d", rotulo: "Criadas em 7 dias" },
  { valor: "30d", rotulo: "Criadas em 30 dias" },
];

/** O filtro de dia olha a CRIAÇÃO da demanda. */
export function passaNoDia(dataCriacao: string, filtro: FiltroDia, hoje: string) {
  if (filtro === "qualquer") return true;
  const dia = diaDe(dataCriacao);
  if (filtro === "hoje") return dia === hoje;
  if (filtro === "ontem") return dia === somarDias(hoje, -1);
  return dia >= somarDias(hoje, filtro === "7d" ? -6 : -29);
}
