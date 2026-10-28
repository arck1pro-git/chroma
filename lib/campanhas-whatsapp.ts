// O MOTOR das campanhas de WhatsApp oficial em blocos. O formato do fluxo, o
// catálogo e a validação são o contrato de lib/campanhas-fluxo.ts; o que chega
// para gravar, e a leitura do que está gravado, em lib/campanhas-fluxo-entrada.ts;
// a regra de cada envio, em lib/campanhas-fluxo-envios.ts. O motor roda em
// lib/campanhas-whatsapp-*.ts, por assunto (divisão de 2026-10-28, pedido dele:
// o arquivo passava de 1.300 linhas), e este arquivo é a porta: as rotas, a IA e
// os scripts importam daqui.
//
//   -campanha.ts  template e número, inscrição, autoria, pausar/editar/retomar
//   -rodada.ts    a fila do /processar, a reserva, o percurso bloco a bloco, a
//                 entrada do Aguardar e as execuções presas
//   -envios.ts    Enviar template, Enviar texto e Enviar arquivo
//   -acoes.ts     tag, segmento, oportunidade, conversão, IA e aviso (enfileira)
//   -controle.ts  Condição, Horário de envio e Permissão de passagem
//   -respostas.ts a resposta do contato (webhook), descadastro, prazo vencido
//   -avisos.ts    os avisos à equipe, juntos por pessoa
//   -totais.ts    os totais da campanha e as métricas do canvas
//   -base.ts      a execução, os eventos e as transições de estado
//
// ESTADOS DE UMA EXECUÇÃO (campanha_whatsapp_execucoes):
//   na_fila             inscrita, ainda sem rodar (começa pelo início do fluxo)
//   enviando            RESERVADA por uma rodada; prazo_resposta = até quando
//                       vale a reserva (15 min). Presa além disso vira 'falhou'
//                       (recuperarPresas): nunca reenviar no escuro.
//   aguardando_resposta parada num "Aguardar resposta" até responder ou vencer
//   em_andamento        bloco_atual roda quando prazo_resposta chegar: depois de
//                       uma resposta (prazo = agora), estacionada por pausa, ou
//                       parada num "Esperar" (ver jaComecou), num "Horário de
//                       envio" fora da janela ou numa "Permissão de passagem"
//                       cheia
//   concluida, falhou   finais; 'respondeu' e 'expirou' são do formato antigo
//
// EXECUÇÃO DO FORMATO ANTIGO não tem bloco_atual: vale pelo estado — na fila vai
// pelo início (que no fluxo convertido É o envio), 'enviando' é envio
// interrompido (falha, não reenvia) e aguardando é o bloco ID_AGUARDAR_ANTIGO.
// Nunca recomeça do início: reenviaria o template a quem já recebeu.
//
// CADA BLOCO deixa um evento 'bloco' {bloco, tipo, saida?, ok, erro?, wamid?}
// com frase fixa — nunca o texto que o contato escreveu: o histórico de
// campanha vai ao MCP e às IAs. Sem laço no fluxo (contrato), cada bloco roda no
// máximo uma vez por execução: é o evento que diz se um envio já foi tentado e
// se um "Esperar" já começou. Por isso id que rodou não muda de tipo nem volta
// depois de apagado (travaDeIds, na edição).
//
// UMA CAMPANHA FALANDO POR CONTATO E NÚMERO (revisões de 2026-10-28): a
// execução na fila não começa enquanto outra do mesmo contato, no mesmo
// telefone_id, estiver aguardando, rodando ou em andamento (num "Esperar",
// inclusive); a reserva roda sob pg_advisory_xact_lock do par contato+número,
// e a entrada do "Aguardar resposta" confere de novo. Sem isso a resposta da
// pessoa não teria dono certo.
//
// INSCRIÇÃO SEM TETO: ativar e retomar inscrevem TODO contato com WhatsApp dos
// segmentos numa instrução (inscreverDosSegmentos); o gatilho do banco inscreve
// quem entra depois, enquanto a campanha está ativa. A vazão é a da rodada: até
// 100 execuções e 45 s por chamada do /processar, uma por minuto por campanha.
//
// PAUSADA: nada anda (cada bloco confere que a campanha está ativa). A resposta
// que chega durante a pausa grava a saída e espera a retomada.
import "server-only";

export {
  contatosNosSegmentos,
  inscreverDosSegmentos,
  numeroDaConta,
  pausarCampanha,
  registrarNaCampanha,
  retomarCampanha,
  salvarEdicao,
  templateDaCampanha,
} from "@/lib/campanhas-whatsapp-campanha";
export { avancarExecucao, processarFila, recuperarPresas } from "@/lib/campanhas-whatsapp-rodada";
export { payloadDoBotao } from "@/lib/campanhas-whatsapp-envios";
export { alimentaCampanha, processarExpirados, registrarResposta, type RespostaDaCampanha } from "@/lib/campanhas-whatsapp-respostas";
export { enviarAvisosPendentes } from "@/lib/campanhas-whatsapp-avisos";
export { metricasDasCampanhas, type MetricasDoFluxo } from "@/lib/campanhas-whatsapp-totais";
