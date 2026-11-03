// O ponto da equipe, lido da base do app de ponto (lib/ponto-db.ts), para a aba
// Ponto do módulo Financeiro (pedido dele, 2026-11-03).
//
// O DIA É O DA PESSOA: cada cadastro tem o seu fuso (users.timezone), e a
// batida das 23h30 de Manaus é do mesmo dia em Manaus, não do seguinte em
// Brasília. A data e a hora já saem do banco no fuso de cada um.
//
// AS HORAS SÃO A SOMA DOS PARES entrada → saída, na ordem (`calcularDia`).
// Batida que não fecha par não vira hora: a entrada sem saída deixa o dia
// "falta saída". Se o dia é hoje, ele está "em andamento" e a entrada aberta
// conta até agora, para quem está trabalhando não aparecer com 0h. A entrada
// repetida antes da saída, ou a saída sem entrada, deixa o dia "irregular",
// contando só os pares que fecham. Nada é corrigido aqui: a tela mostra para alguém conferir no app
// de ponto.
import "server-only";
import { lerPonto } from "@/lib/ponto-db";

export type Modalidade = "presencial" | "home_office";
export type SituacaoDia = "completo" | "em_andamento" | "falta_saida" | "irregular" | "sem_batida";
export type BatidaPonto = { tipo: "in" | "out"; hora: string };

export type PessoaPonto = { id: string; nome: string; email: string; admin: boolean; fuso: string };

export type DiaPonto = {
  pessoaId: string;
  /** AAAA-MM-DD no fuso da pessoa. */
  dia: string;
  modalidade: Modalidade | null;
  batidas: BatidaPonto[];
  minutos: number;
  situacao: SituacaoDia;
};

export type ResumoPonto = {
  pessoaId: string;
  diasComBatida: number;
  minutos: number;
  presencial: number;
  homeOffice: number;
  /** Dias com falta de saída, irregulares ou com modalidade e sem batida. */
  pendencias: number;
  /** Média da primeira entrada e da última saída do dia, em minutos desde a meia-noite (null sem dado). */
  entradaMedia: number | null;
  saidaMedia: number | null;
};

/** Um dia do mês em que alguém bateu ponto: o total da equipe e quantos bateram. */
export type EquipeNoDia = { dia: string; minutos: number; pessoas: number };

/** Um mês inteiro: o total da equipe, quantos bateram e os minutos de cada um. */
export type EquipeNoMes = { mes: string; minutos: number; pessoas: number; porPessoa: Record<string, number> };

export type DadosPonto = {
  mes: string;
  /** Os meses que têm batida, do mais novo para o mais velho. */
  meses: string[];
  pessoas: PessoaPonto[];
  resumos: ResumoPonto[];
  /** Os dias do mês pedido. */
  dias: DiaPonto[];
  /** Os dias do mês com batida de alguém, em ordem: os gráficos por dia. */
  porDia: EquipeNoDia[];
  /** Todos os meses com batida, do mais velho para o mais novo: os gráficos por mês. */
  porMes: EquipeNoMes[];
  lidoEm: string;
};

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export function ehMes(valor: unknown): valor is string {
  return typeof valor === "string" && MES.test(valor);
}

/** AAAA-MM-DD de agora num fuso. Fuso inválido no cadastro cai em Brasília. */
export function hojeNoFuso(fuso: string, agora = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(agora);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
  }
}

/** O mês corrente em Brasília (AAAA-MM). */
export function mesAtual(agora = new Date()): string {
  return hojeNoFuso("America/Sao_Paulo", agora).slice(0, 7);
}

/**
 * Minutos e situação de um dia, a partir das batidas em ordem (`instante` em
 * milissegundos). `agora` só vale no dia de hoje: a entrada aberta conta até
 * ele. Pura: é o que scripts/testar-ponto.ts confere.
 */
export function calcularDia(
  batidas: Array<{ tipo: "in" | "out"; instante: number }>,
  ehHoje: boolean,
  agora = Date.now(),
): { minutos: number; situacao: Exclude<SituacaoDia, "sem_batida"> } {
  let entrada: number | null = null;
  let ms = 0;
  let irregular = false;
  for (const b of batidas) {
    if (b.tipo === "in") {
      if (entrada === null) entrada = b.instante;
      else irregular = true;
    } else if (entrada === null) {
      irregular = true;
    } else {
      ms += b.instante - entrada;
      entrada = null;
    }
  }
  if (entrada !== null && ehHoje) {
    return { minutos: Math.round((ms + Math.max(0, agora - entrada)) / 60_000), situacao: "em_andamento" };
  }
  const minutos = Math.round(ms / 60_000);
  if (entrada !== null) return { minutos, situacao: "falta_saida" };
  return { minutos, situacao: irregular ? "irregular" : "completo" };
}

/** "08:42" → 522. */
const minutosDoDia = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

/**
 * O ponto de todo mundo: o mês pedido em detalhe e todos os meses resumidos,
 * para os gráficos. Lê a base inteira de uma vez: são umas 500 batidas por mês,
 * e o resumo por mês precisa do mesmo cálculo de pares do dia a dia.
 */
export async function carregarPonto(mes: string): Promise<DadosPonto> {
  if (!ehMes(mes)) throw new Error(`mês inválido: ${mes}`);
  const { pessoas, batidas, modalidades } = await lerPonto(async (sql) => {
    // A senha e o token do celular ficam de fora de propósito.
    const pessoas = await sql`SELECT id, name, email, role, timezone FROM users ORDER BY name`;
    const batidas = await sql`
      SELECT r.user_id, r.tipo, r.timestamp AS instante,
             to_char(r.timestamp AT TIME ZONE u.timezone, 'YYYY-MM-DD') AS dia,
             to_char(r.timestamp AT TIME ZONE u.timezone, 'HH24:MI') AS hora
        FROM registros r
        JOIN users u ON u.id = r.user_id
       ORDER BY r.user_id, r.timestamp`;
    const modalidades = await sql`SELECT user_id, to_char(dia, 'YYYY-MM-DD') AS dia, tipo FROM modalidade`;
    return { pessoas, batidas, modalidades };
  });

  const lista: PessoaPonto[] = pessoas.map((p) => ({
    id: p.id as string,
    nome: p.name as string,
    email: p.email as string,
    admin: p.role === "admin",
    fuso: p.timezone as string,
  }));
  const fusoDe = new Map(lista.map((p) => [p.id, p.fuso]));

  // Um dia por pessoa e data, juntando as batidas e a modalidade.
  const porDia = new Map<string, { pessoaId: string; dia: string; modalidade: Modalidade | null; batidas: Array<{ tipo: "in" | "out"; instante: number; hora: string }> }>();
  const chave = (pessoaId: string, dia: string) => `${pessoaId}|${dia}`;
  const diaDe = (pessoaId: string, dia: string) => {
    const k = chave(pessoaId, dia);
    let d = porDia.get(k);
    if (!d) porDia.set(k, (d = { pessoaId, dia, modalidade: null, batidas: [] }));
    return d;
  };
  for (const b of batidas) {
    diaDe(b.user_id as string, b.dia as string).batidas.push({
      tipo: b.tipo === "out" ? "out" : "in",
      instante: new Date(b.instante as string | Date).getTime(),
      hora: b.hora as string,
    });
  }
  for (const m of modalidades) {
    diaDe(m.user_id as string, m.dia as string).modalidade = m.tipo === "home_office" ? "home_office" : "presencial";
  }

  const agora = new Date();
  const todos: DiaPonto[] = [...porDia.values()].map((d) => {
    const base = { pessoaId: d.pessoaId, dia: d.dia, modalidade: d.modalidade, batidas: d.batidas.map(({ tipo, hora }) => ({ tipo, hora })) };
    if (d.batidas.length === 0) return { ...base, minutos: 0, situacao: "sem_batida" as const };
    const ehHoje = d.dia === hojeNoFuso(fusoDe.get(d.pessoaId) ?? "America/Sao_Paulo", agora);
    return { ...base, ...calcularDia(d.batidas, ehHoje, agora.getTime()) };
  });

  // Todos os meses, resumidos: o gráfico por mês.
  const meses = new Map<string, EquipeNoMes>();
  for (const d of todos) {
    if (!d.batidas.length) continue;
    const m = d.dia.slice(0, 7);
    let r = meses.get(m);
    if (!r) meses.set(m, (r = { mes: m, minutos: 0, pessoas: 0, porPessoa: {} }));
    if (!(d.pessoaId in r.porPessoa)) r.pessoas++;
    r.porPessoa[d.pessoaId] = (r.porPessoa[d.pessoaId] ?? 0) + d.minutos;
    r.minutos += d.minutos;
  }
  const porMes = [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes));

  const nome = new Map(lista.map((p) => [p.id, p.nome]));
  const dias = todos
    .filter((d) => d.dia.startsWith(mes))
    .sort((a, b) => b.dia.localeCompare(a.dia) || (nome.get(a.pessoaId) ?? "").localeCompare(nome.get(b.pessoaId) ?? ""));

  // O mês pedido, dia a dia, para a equipe: o gráfico por dia.
  const equipe = new Map<string, EquipeNoDia>();
  for (const d of dias) {
    if (!d.batidas.length) continue;
    const e = equipe.get(d.dia) ?? { dia: d.dia, minutos: 0, pessoas: 0 };
    e.minutos += d.minutos;
    e.pessoas++;
    equipe.set(d.dia, e);
  }

  // O resumo de cada pessoa no mês, com o horário médio de chegada e de saída.
  const resumos = new Map<string, ResumoPonto & { entradas: number[]; saidas: number[] }>();
  for (const d of dias) {
    let r = resumos.get(d.pessoaId);
    if (!r) {
      r = { pessoaId: d.pessoaId, diasComBatida: 0, minutos: 0, presencial: 0, homeOffice: 0, pendencias: 0, entradaMedia: null, saidaMedia: null, entradas: [], saidas: [] };
      resumos.set(d.pessoaId, r);
    }
    if (d.batidas.length) r.diasComBatida++;
    r.minutos += d.minutos;
    if (d.modalidade === "presencial") r.presencial++;
    if (d.modalidade === "home_office") r.homeOffice++;
    if (d.situacao === "falta_saida" || d.situacao === "irregular" || d.situacao === "sem_batida") r.pendencias++;
    const entrada = d.batidas.find((b) => b.tipo === "in");
    const saida = d.batidas.at(-1);
    if (entrada) r.entradas.push(minutosDoDia(entrada.hora));
    // A saída só conta quando o dia terminou com ela (dia em andamento ou sem saída não).
    if (saida?.tipo === "out" && d.situacao !== "em_andamento") r.saidas.push(minutosDoDia(saida.hora));
  }
  const media = (v: number[]) => (v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null);

  return {
    mes,
    meses: porMes.map((m) => m.mes).reverse(),
    pessoas: lista,
    resumos: [...resumos.values()]
      .map(({ entradas, saidas, ...r }) => ({ ...r, entradaMedia: media(entradas), saidaMedia: media(saidas) }))
      .sort((a, b) => b.minutos - a.minutos),
    dias,
    porDia: [...equipe.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
    porMes,
    lidoEm: agora.toISOString(),
  };
}
