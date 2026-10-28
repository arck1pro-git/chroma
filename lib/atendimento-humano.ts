// O ATENDIMENTO HUMANO: a etapa para onde vai o lead que passa para a equipe e
// as linhas de histórico que acendem a pill vermelha "Atendimento humano" do
// card (lib/funil.ts, app/funil/cartao.tsx).
//
// Dois caminhos levam o lead até lá (pedido dele, 2026-10-28):
//   · a IA vê que o lead quer uma pessoa (lib/ia/atendente.ts, passarParaHumano);
//   · a cadência do Atendimento IA termina sem resposta e o bloco "Atualizar
//     oportunidade" põe o card nesta etapa (lib/automacoes/mover-pela-cadencia.ts).
// Nos dois, o contato ganha uma das linhas abaixo e a pill acende. Ela apaga
// quando alguém da equipe escreve para o lead.
//
// Arquivo próprio porque a IA, a cadência e o quadro leem a mesma regra, e a
// cadência não deve carregar o atendente da IA inteiro só por uma constante.

/** A etapa do atendimento humano. "solicitou contato" é o nome dos funis reformulados (2026-10-19). */
export const ETAPA_ATENDIMENTO_HUMANO = /^(solicitou contato|atendimento humano)$/i;

/** Começo da linha que a IA grava quando passa o lead para a equipe. */
export const PASSOU_PELA_IA = "IA passou o atendimento para a equipe:";

/** Começo da linha que a cadência grava quando põe o card no atendimento humano. */
export const ENVIADO_PELA_CADENCIA = "Enviado para atendimento humano pela cadência";
