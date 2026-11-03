// A folha do pessoal, sem nada de servidor: a tela (a prévia que muda enquanto
// se digita) e o servidor (lib/financeiro-pagamentos.ts) fazem a MESMA conta
// por aqui.

export type TipoPagamento = "hora" | "fixo";

/** Como a pessoa recebe: vale para todos os meses. */
export type CadastroPagamento = {
  /** O id do cadastro no app de ponto. */
  pessoaId: string;
  setor: string | null;
  atividade: string | null;
  tipo: TipoPagamento;
  valorHora: number | null;
  valorMes: number | null;
  pix: string | null;
};

/** O que é lançado em cada mês. Mês sem lançamento é zero. */
export type LancamentoMes = { adicional: number; descontos: number };

export const SEM_LANCAMENTO: LancamentoMes = { adicional: 0, descontos: 0 };

/**
 * A conta do profissional no mês: a base (por hora, horas × valor hora; fixo, o
 * valor mês, trabalhe quanto trabalhar), mais o adicional, menos os descontos.
 * `base` e `total` são null quando falta o cadastro ou o valor do tipo.
 */
export function contaDoMes(
  cadastro: Pick<CadastroPagamento, "tipo" | "valorHora" | "valorMes"> | null | undefined,
  minutos: number,
  lancamento: LancamentoMes = SEM_LANCAMENTO,
): { base: number | null; adicional: number; descontos: number; total: number | null } {
  const base = !cadastro
    ? null
    : cadastro.tipo === "fixo"
      ? cadastro.valorMes
      : cadastro.valorHora === null
        ? null
        : centavos((minutos / 60) * cadastro.valorHora);
  const { adicional, descontos } = lancamento;
  return { base, adicional, descontos, total: base === null ? null : centavos(base + adicional - descontos) };
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
