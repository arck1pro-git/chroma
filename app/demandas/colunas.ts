// As colunas do quadro de Demandas — as mesmas nos dois quadros, "Minhas" e
// "Enviadas"; muda só o nome da coluna do meio e o que o vazio diz.
//
// POR PRAZO, E NÃO POR "ESTADO": a demanda só tem dois estados no banco (a
// fazer e feita), e um quadro de duas colunas não responde a pergunta de quem
// abre a tela — o que eu faço primeiro, quem está me devendo. O prazo responde.
// A faixa colorida no topo é a mesma pista do quadro do Dashboard.
//
// "EM ANDAMENTO" (pedido dele de 2026-10-08) é a demanda a fazer que começou —
// `iniciadaEm` preenchida (migration-demanda-iniciada.sql), seja qual for o
// prazo; o chip do cartão continua dizendo se atrasou. Ela chega lá de dois
// jeitos: arrastada (desde 2026-10-09) ou com o primeiro passo do checklist
// marcado. Arrastar de volta para uma coluna de prazo tira de lá.
import type { ColunaDePrazo } from "./datas";

export type Quadro = "minhas" | "enviadas";
export type ColunaId = ColunaDePrazo | "andamento" | "feitas";
/** As colunas do que ainda está a fazer. */
export type ColunaPendente = Exclude<ColunaId, "feitas">;

export type DefinicaoColuna = {
  id: ColunaId;
  rotulo: Record<Quadro, string>;
  /** A faixa do topo da coluna e da gaveta. */
  faixa: string;
  vazio: Record<Quadro, string>;
};

export const COLUNAS: readonly DefinicaoColuna[] = [
  {
    id: "atrasadas",
    rotulo: { minhas: "Atrasadas", enviadas: "Atrasadas" },
    faixa: "bg-red-500",
    vazio: { minhas: "Nada atrasado.", enviadas: "Ninguém atrasado com você." },
  },
  {
    id: "hoje",
    rotulo: { minhas: "Para hoje", enviadas: "Vencem hoje" },
    faixa: "bg-amber-400",
    vazio: { minhas: "Nada vence hoje.", enviadas: "Nada vence hoje." },
  },
  {
    id: "fila",
    rotulo: { minhas: "A fazer", enviadas: "Aguardando" },
    faixa: "bg-sky-500",
    vazio: { minhas: "Nada na fila.", enviadas: "Nada aguardando." },
  },
  {
    id: "andamento",
    rotulo: { minhas: "Em andamento", enviadas: "Em andamento" },
    faixa: "bg-violet-500",
    vazio: {
      minhas: "Arraste para cá o que você começou — ou marque um passo do checklist.",
      enviadas: "Entra aqui quando a pessoa começa a demanda.",
    },
  },
  {
    id: "feitas",
    rotulo: { minhas: "Feitas", enviadas: "Feitas" },
    faixa: "bg-emerald-500",
    vazio: { minhas: "O que você marcar aparece aqui.", enviadas: "O que a pessoa marcar aparece aqui." },
  },
];

export function definicaoDe(id: ColunaId) {
  return COLUNAS.find((c) => c.id === id)!;
}

/** As colunas que só dizem o prazo — entre elas o arraste não muda nada. */
export function ehColunaDePrazo(id: ColunaId): id is ColunaDePrazo {
  return id === "atrasadas" || id === "hoje" || id === "fila";
}
