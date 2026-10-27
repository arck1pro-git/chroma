import type { ChaveModulo } from "./modulos";

export const OPERACOES = ["criar", "editar", "excluir"] as const;
export type Operacao = (typeof OPERACOES)[number];
export type PermissoesCrud = Record<Operacao, boolean>;
export type PermissoesPorModulo = Partial<Record<ChaveModulo, PermissoesCrud>>;

export function ehOperacao(valor: string): valor is Operacao {
  return OPERACOES.some((operacao) => operacao === valor);
}

/** Sem módulo ou sem concessão explícita, a operação é negada. */
export function podeOperar(
  usuario: { modulos: Map<ChaveModulo, unknown>; permissoes?: PermissoesPorModulo },
  modulo: ChaveModulo,
  operacao: Operacao,
): boolean {
  return usuario.modulos.has(modulo) && usuario.permissoes?.[modulo]?.[operacao] === true;
}
