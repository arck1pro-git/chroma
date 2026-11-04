// Pôr uma oportunidade numa etapa, com tudo o que vem junto — o MESMO caminho
// para o arraste no quadro (app/funil/actions.ts) e para a IA que atende no
// WhatsApp (lib/ia/atendente.ts). Separado da server action porque a IA roda
// sem sessão, depois da resposta ao webhook: não há de quem exigir módulo.
//
// A etapa que pede retorno (a "interesse futuro", 2026-11-04) só aceita quem
// vem com o dia de retomar o contato: a trava está no UPDATE
// (lib/historico.ts), e `conferirRetomarEm`, aqui embaixo, confere o dia que a
// tela manda.
import "server-only";
import { inscreverNaCadenciaDaEtapa } from "@/lib/automacoes/repositorio";
import { dispararInscritos } from "@/lib/automacoes/disparo";
import { moverEtapaRegistrando, moverEtapaRegistrandoLote } from "@/lib/historico";
import { hojeEmBrasilia, somarMeses } from "@/lib/formato";
import { eventoAoEntrarNaEtapa, eventosAoEntrarNaEtapa } from "@/lib/meta-eventos";

/**
 * Move, registra no histórico, inscreve na cadência da etapa e manda o evento
 * da Meta. `complemento` vai no fim da linha do histórico ("… pela IA X:
 * motivo"). Devolve se a etapa mudou de fato.
 *
 * `retomarEm`: o dia de retomar o contato, que a etapa que pede retorno exige
 * (lib/historico.ts). Sem ele, a oportunidade não entra nela e volta false.
 */
export async function moverOportunidadeDeEtapa(
  oportunidadeId: string,
  etapaId: string,
  funilId: string,
  complemento = "",
  retomarEm: string | null = null,
): Promise<boolean> {
  const mudou = await moverEtapaRegistrando(oportunidadeId, etapaId, funilId, complemento, retomarEm);
  // Entrar na etapa é entrar na cadência dela, se houver uma rodando. É o que
  // faz a cadência valer para "as próximas que entrarem" sem ninguém clicar em
  // nada — ver inscreverNaCadenciaDaEtapa.
  await entrarNaCadencia(oportunidadeId, etapaId);
  // Só quando a etapa mudou: reordenar dentro da coluna não é entrar nela.
  if (mudou) eventoAoEntrarNaEtapa(oportunidadeId, etapaId);
  return mudou;
}

/**
 * O mesmo para a seleção do quadro (2026-10-26): um UPDATE com o histórico,
 * uma inscrição na cadência e um disparo para o lote inteiro. Um por um, uma
 * coluna de 600 cards estouraria o tempo da função. Devolve as que mudaram.
 */
export async function moverOportunidadesDeEtapa(
  oportunidadeIds: string[],
  etapaId: string,
  funilId: string,
  complemento = "",
  retomarEm: string | null = null,
): Promise<string[]> {
  const mudaram = await moverEtapaRegistrandoLote(oportunidadeIds, etapaId, funilId, complemento, retomarEm);
  // Só as que MUDARAM entram na cadência: a que já estava na etapa e saiu da
  // cadência (cancelada, concluída) não pode voltar a receber por causa do lote.
  await entrarNaCadencia(mudaram, etapaId);
  eventosAoEntrarNaEtapa(mudaram, etapaId);
  return mudaram;
}

/**
 * Põe a oportunidade (ou a lista) na cadência da etapa e manda o motor começar.
 *
 * NÃO DERRUBA QUEM CHAMOU: mover o card é a ação; a cadência é consequência.
 * Se o n8n estiver fora do ar, o card fica na etapa nova do mesmo jeito e a
 * inscrição já está gravada — o próximo Publicar a leva ao motor.
 *
 * Exportada porque criar a oportunidade direto numa etapa também é entrar nela.
 */
export async function entrarNaCadencia(oportunidadeId: string | string[], etapaId: string) {
  try {
    const r = await inscreverNaCadenciaDaEtapa(oportunidadeId, etapaId);
    if (r) await dispararInscritos(r.fluxo, "oportunidade", r.inscritos);
  } catch (e) {
    console.error("[cadencia] falhou ao inscrever na entrada da etapa:", e);
  }
}

/** Até quando se pode marcar o retorno: 5 anos à frente cobre o "daqui 1 ano" com folga. */
const TETO_RETORNO_ANOS = 5;

/**
 * O dia de retomar vindo do navegador: 'AAAA-MM-DD' de amanhã (em Brasília) até
 * TETO_RETORNO_ANOS anos à frente. Devolve a data ou a frase da recusa.
 */
export function conferirRetomarEm(bruto: unknown): { data: string } | { erro: string } {
  if (typeof bruto !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return { erro: "Escolha quando retomar o contato." };
  const [ano, mes, dia] = bruto.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return { erro: "Data de retorno inválida." };
  const hoje = hojeEmBrasilia();
  if (bruto <= hoje) return { erro: "A data de retorno precisa ser depois de hoje." };
  if (bruto > somarMeses(hoje, TETO_RETORNO_ANOS * 12)) return { erro: `A data de retorno pode ser no máximo daqui a ${TETO_RETORNO_ANOS} anos.` };
  return { data: bruto };
}
