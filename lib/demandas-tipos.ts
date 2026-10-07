// O que a tela de Demandas e o modal de chamado precisam saber de uma demanda.
//
// SEPARADO de lib/demandas.ts porque aquele é server-only (fala com o banco) e
// os rótulos daqui são usados nos componentes de cliente — o modal do chamado
// mora no Dashboard, e importar o arquivo do banco ali quebraria o build.

export type Prioridade = "baixa" | "normal" | "alta";

/** Na ordem em que aparecem no seletor. */
export const PRIORIDADES: readonly { valor: Prioridade; rotulo: string }[] = [
  { valor: "baixa", rotulo: "Baixa" },
  { valor: "normal", rotulo: "Normal" },
  { valor: "alta", rotulo: "Alta" },
];

export function ehPrioridade(v: unknown): v is Prioridade {
  return v === "baixa" || v === "normal" || v === "alta";
}

export type Demanda = {
  id: string;
  titulo: string;
  descricao: string | null;
  /** "2026-10-12" — só a data, sem fuso. */
  prazo: string | null;
  prioridade: Prioridade;
  /** Para quem: uma pessoa OU (no chamado) um departamento. */
  responsavelId: string | null;
  responsavel: string | null;
  /** Para o avatar do cartão. */
  responsavelIniciais: string | null;
  departamentoId: string | null;
  departamento: string | null;
  criadoPor: string | null;
  autor: string | null;
  dataCriacao: string;
  /** Nulo = pendente. */
  feitaEm: string | null;
  feitaPor: string | null;
};

/**
 * Os dois destinos que não são uma pessoa: o chamado (vai para o departamento
 * TI) e a demanda para todo mundo (uma linha por pessoa).
 */
export const PARA_O_TI = "ti";
export const PARA_TODOS = "todos";

/** O formulário, como sai do modal. `para` só existe na "Nova demanda" do módulo. */
export type DadosDemanda = {
  titulo: string;
  descricao: string;
  prazo: string;
  prioridade: Prioridade;
  /** Id da pessoa, PARA_TODOS ou PARA_O_TI. */
  para?: string;
};

export type ResultadoDemanda = { ok: boolean; mensagem: string };
