// O domínio dos links que vão em mensagem de WhatsApp para a equipe (pedido
// dele, 2026-10-16: "com o domínio amaanoffice.amaan.com.br").
//
// FIXO NO CÓDIGO, de propósito: esses avisos saem de dentro da resposta da IA,
// do webhook de captação e do motor de automação, sem request de navegador de
// onde tirar o domínio. Quando há request, quem responde é lib/endereco.ts.
export const ENDERECO_DO_CRM = "https://amaanoffice.amaan.com.br";

/** A conversa aberta direto no chat do CRM. */
export function linkDaConversa(atendimentoId: string): string {
  return `${ENDERECO_DO_CRM}/chat?atendimento=${atendimentoId}`;
}

/** A oportunidade aberta direto no quadro. */
export function linkDaOportunidade(oportunidadeId: string): string {
  return `${ENDERECO_DO_CRM}/?op=${oportunidadeId}`;
}
