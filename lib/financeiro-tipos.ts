// A folha do pessoal, sem nada de servidor: a tela (a prévia e os totais que
// mudam enquanto se digita) e o servidor (lib/financeiro-pagamentos.ts) fazem a
// MESMA conta por aqui.
//
// OS VALORES SÃO DO MÊS (2026-11-04): o tipo, o valor hora, o valor mês e a
// taxa de deslocamento com que um mês foi lançado ficam nele (a "foto" em
// LancamentoMes.valores). Mês sem foto usa o padrão do cadastro do colaborador.

export type TipoPagamento = "hora" | "fixo";

/** O que decide a conta: o tipo, os dois valores e a taxa diária de deslocamento (null = não recebe). */
export type ValoresPagamento = {
  tipo: TipoPagamento;
  valorHora: number | null;
  valorMes: number | null;
  taxaDeslocamento: number | null;
};

/** O cadastro do colaborador: os valores PADRÃO (os dos meses ainda não lançados) e o que não muda por mês. */
export type CadastroPagamento = ValoresPagamento & {
  /** O id do cadastro no app de ponto. */
  pessoaId: string;
  setor: string | null;
  atividade: string | null;
  pix: string | null;
};

/** O que é lançado em cada mês. `valores`: a foto do mês (null = mês ainda não lançado, vale o padrão). */
export type LancamentoMes = { adicional: number; descontos: number; valores: ValoresPagamento | null };

export const SEM_LANCAMENTO: LancamentoMes = { adicional: 0, descontos: 0, valores: null };

/** Os valores que valem no mês: a foto dele, ou o padrão do cadastro. null = sem cadastro. */
export function valoresDoMes(cadastro: CadastroPagamento | null | undefined, lancamento: LancamentoMes | null | undefined): ValoresPagamento | null {
  if (lancamento?.valores) return lancamento.valores;
  if (!cadastro) return null;
  return { tipo: cadastro.tipo, valorHora: cadastro.valorHora, valorMes: cadastro.valorMes, taxaDeslocamento: cadastro.taxaDeslocamento };
}

/**
 * A conta do profissional no mês: a base (por hora, horas × valor hora; fixo, o
 * valor mês, trabalhe quanto trabalhar), mais o deslocamento (taxa diária × dias
 * presenciais no ponto), mais o adicional, menos os descontos. `base` e `total`
 * são null quando falta o cadastro ou o valor do tipo.
 */
export function contaDoMes(
  valores: ValoresPagamento | null | undefined,
  minutos: number,
  diasPresenciais: number,
  lancamento: Pick<LancamentoMes, "adicional" | "descontos"> = SEM_LANCAMENTO,
): { base: number | null; deslocamento: number; adicional: number; descontos: number; total: number | null } {
  const base = !valores
    ? null
    : valores.tipo === "fixo"
      ? valores.valorMes
      : valores.valorHora === null
        ? null
        : centavos((minutos / 60) * valores.valorHora);
  const deslocamento = valores?.taxaDeslocamento ? centavos(valores.taxaDeslocamento * diasPresenciais) : 0;
  const { adicional, descontos } = lancamento;
  return { base, deslocamento, adicional, descontos, total: base === null ? null : centavos(base + deslocamento + adicional - descontos) };
}

function centavos(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 25.5 → "25,50" (o valor no campo de digitar). */
export function paraCampo(v: number | null): string {
  return v === null ? "" : v.toFixed(2).replace(".", ",");
}

/**
 * O valor digitado em reais, como se escreve no Brasil ("1.500,00", "25,5" ou
 * "25.50"): número, null (vazio) ou undefined (não é um valor).
 */
export function lerReais(texto: string): number | null | undefined {
  const s = texto.replace(/[R$\s]/g, "");
  if (!s) return null;
  // Com vírgula, ela é o decimal e os pontos são milhar; sem vírgula, um ponto com até dois dígitos depois é decimal.
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d+\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, "");
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

const REAIS = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 1234.5 → "R$ 1.234,50". */
export function reais(valor: number): string {
  return REAIS.format(valor);
}
