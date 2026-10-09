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

/** Um passo do checklist da demanda (migration-demanda-itens.sql). */
export type ItemDemanda = {
  id: string;
  texto: string;
  ordem: number;
  /** Nulo = pendente. */
  feitoEm: string | null;
  feitoPor: string | null;
};

/** Tetos do checklist: um item é uma linha, não um texto; uma demanda não é um projeto. */
export const TETO_ITENS = 50;
export const TETO_TEXTO_ITEM = 200;

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
  /**
   * Quando foi para "Em andamento" — arrastada para lá ou com o primeiro passo
   * do checklist marcado — e quem a pôs lá. Nulo = não começou.
   */
  iniciadaEm: string | null;
  iniciadaPor: string | null;
  /** Nulo = pendente. */
  feitaEm: string | null;
  feitaPor: string | null;
  /** O checklist, na ordem. Vazio quando não tem. */
  itens: ItemDemanda[];
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
  /** Os passos do checklist, na ordem — só na criação; depois, cada item tem a sua ação. */
  itens?: string[];
};

export type ResultadoDemanda = { ok: boolean; mensagem: string };

/** O número da barra lateral: o que está a fazer PARA a pessoa, e quanto disso atrasou. */
export type ContagemDemandas = { pendentes: number; atrasadas: number };

/**
 * Disparado na janela depois de qualquer mudança que mexe na contagem (criar,
 * dar o check, desmarcar, excluir): a barra lateral busca o número de novo na
 * hora, sem esperar a próxima conferência de um minuto.
 */
export const EVENTO_DEMANDAS = "chroma:demandas-mudaram";

export function avisarQueDemandasMudaram() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_DEMANDAS));
}
