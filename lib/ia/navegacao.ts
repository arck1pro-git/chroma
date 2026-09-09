// De qual TELA é cada conversa de IA.
//
// A sidebar lista as conversas de todos os painéis juntos, como no ChatGPT. Mas
// aqui uma conversa não é uma tela própria: ela aconteceu DENTRO de um lugar do
// CRM — o quadro da raiz, o editor de um fluxo, o painel de cadência de uma
// etapa. Clicar tem que levar de volta àquele lugar, com o painel aberto na
// conversa certa.
//
// O que carrega essa informação é `ia_conversas.escopo`, que já existia para
// separar as listas. Os formatos:
//
//   'funil'                  → a raiz
//   'automacoes:<fluxo_id>'  → o editor daquele fluxo
//   'cadencia:<fluxo_id>'    → o painel de cadência daquela etapa, na raiz
//
// ⚠ O escopo do editor era só 'automacoes', sem o id — o que tornava
// impossível saber a qual fluxo a conversa pertencia. Passou a carregar o id
// (app/automacoes/builder.tsx). Conversas gravadas com o formato antigo caem no
// fallback de `rotaDaConversa` e abrem a lista de automações, que é o mais
// perto que dá para chegar sem a informação.

export type EscopoConversa = string;

/** O rótulo do lugar, para a sidebar mostrar de onde veio a conversa. */
export function lugarDoEscopo(escopo: EscopoConversa): string {
  if (escopo === "funil") return "Funil";
  if (escopo.startsWith("cadencia:")) return "Cadência";
  if (escopo.startsWith("automacoes")) return "Automação";
  return "CRM";
}

/**
 * A URL que reabre a conversa no lugar onde ela foi feita.
 *
 * `?ia=<id>` é lido pela tela de destino, que abre o painel já naquela conversa
 * (ver o prop `conversaInicial` de app/components/chat-ia.tsx).
 */
export function rotaDaConversa(escopo: EscopoConversa, id: string): string {
  if (escopo.startsWith("cadencia:")) {
    const fluxoId = escopo.slice("cadencia:".length);
    // A cadência mora num painel da raiz, não em rota própria: a raiz abre o
    // painel daquele fluxo por ?cadencia=.
    return `/?cadencia=${encodeURIComponent(fluxoId)}&ia=${id}`;
  }

  if (escopo.startsWith("automacoes:")) {
    const fluxoId = escopo.slice("automacoes:".length);
    return `/automacoes/${encodeURIComponent(fluxoId)}?ia=${id}`;
  }

  // 'automacoes' sem id (formato antigo): sem saber o fluxo, a lista é o
  // destino honesto. Abrir um fluxo qualquer seria pior que não abrir nenhum.
  if (escopo === "automacoes") return "/automacoes";

  return `/?ia=${id}`;
}
