// De qual TELA é cada conversa de IA.
//
// Uma conversa não é uma tela própria: ela aconteceu DENTRO de um lugar do CRM
// — o quadro da raiz, o editor de um fluxo, o painel de cadência de uma etapa.
// A lista de conversas do painel de IA (app/components/chat-ia.tsx) mostra esse
// lugar ao lado de cada uma. Até 2026-10-27 a barra lateral também listava as
// conversas e levava de volta a elas (rotaDaConversa); saiu a pedido dele.
//
// O que carrega essa informação é `ia_conversas.escopo`, que já existia para
// separar as listas. Os formatos:
//
//   'funil'                  → a raiz
//   'automacoes:<fluxo_id>'  → o editor daquele fluxo
//   'cadencia:<fluxo_id>'    → o painel de cadência daquela etapa, na raiz
//   'webhooks'               → a tela de Webhooks
//   'campanhas'              → a IA que grava rascunho de campanha
//   'campanhas-construtor'   → a IA do construtor de campanha em blocos
//
// 'webhooks' não carrega id, e é a diferença de postura daquela conversa: ela
// CRIA captação, e captação que ainda não existe não tem id para prender. A
// conversa é da tela.
//
// ⚠ O escopo do editor era só 'automacoes', sem o id — o que tornava
// impossível saber a qual fluxo a conversa pertencia. Passou a carregar o id
// (app/automacoes/builder.tsx).

export type EscopoConversa = string;

/** O rótulo do lugar, para a lista de conversas mostrar de onde veio cada uma. */
export function lugarDoEscopo(escopo: EscopoConversa): string {
  if (escopo === "funil") return "Funil";
  if (escopo === "webhooks") return "Webhooks";
  if (escopo.startsWith("cadencia:")) return "Cadência";
  if (escopo.startsWith("automacoes")) return "Automação";
  if (escopo.startsWith("campanhas")) return "Campanhas";
  return "CRM";
}
