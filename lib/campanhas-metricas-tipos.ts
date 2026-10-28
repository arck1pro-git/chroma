// O CONTRATO das métricas de uma campanha de WhatsApp (pedido dele,
// 2026-10-28: "quero que metrifique gastos e métricas"), entre o servidor
// (lib/campanhas-metricas.ts e GET /api/meta/whatsapp/campanhas/[id]/metricas)
// e a tela (app/campanhas/fluxo/ver-campanha.tsx). Puro: só tipos.
//
// O GASTO é o que a Meta informa: as estatísticas de template da WABA
// (template_analytics, métrica COST) dão o custo por entrega de cada template
// no período, e o gasto da campanha é a soma de entregues da campanha × custo
// por entrega de cada template. Sem as estatísticas ligadas na WABA, ou numa
// conta que divide a linha de crédito de um parceiro (a Meta não devolve COST),
// a situação diz por quê e os valores vêm null.

/** Do primeiro contato inscrito ao último resultado. */
export type FunilCampanha = {
  entraram: number;
  enviados: number;
  /** Contatos com algum template entregue (status da Meta "delivered" ou "read"); por bloco, em porBloco, são mensagens. */
  entregues: number;
  lidos: number;
  responderam: number;
  conversoes: number;
  falhas: number;
  /** Pediram para sair ("sair", "parar"…). */
  descadastros: number;
};

export type CustoPorTemplate = {
  template: string;
  idioma: string;
  /** Entregues DESTA campanha com este template. */
  entregues: number;
  /** O custo por entrega que a Meta informa para o template no período; null sem estatística. */
  custoPorEntrega: number | null;
  total: number | null;
};

export type CustoCampanha = {
  /**
   * ok: valores da Meta. sem_estatisticas: a WABA não tem as estatísticas de
   * template confirmadas. sem_custo: a Meta não devolve custo para esta conta.
   * erro: a Graph falhou (aviso diz o quê). sem_envio: nada entregue ainda.
   */
  situacao: "ok" | "sem_estatisticas" | "sem_custo" | "erro" | "sem_envio";
  /** Moeda da conta do WhatsApp (ex.: "BRL", "USD"). */
  moeda: string | null;
  total: number | null;
  porTemplate: CustoPorTemplate[];
  porResposta: number | null;
  porConversao: number | null;
  /** Frase curta para a tela quando situacao não é ok. */
  aviso: string | null;
  /** ISO. A Meta consolida o custo com atraso de horas. */
  atualizadoEm: string;
};

export type MetricasDoBloco = {
  /** Contatos parados neste bloco agora. */
  agora: number;
  /** Contatos que já passaram por ele. */
  passaram: number;
  /** Só nos blocos Enviar template; null nos outros. */
  entregues: number | null;
  lidos: number | null;
};

export type MetricasCampanha = {
  funil: FunilCampanha;
  porBloco: Record<string, MetricasDoBloco>;
  /** As falhas agrupadas pelo motivo (o erro da Meta ou do motor), da mais comum à menos. */
  falhasPorMotivo: Array<{ motivo: string; n: number }>;
  custo: CustoCampanha;
};
