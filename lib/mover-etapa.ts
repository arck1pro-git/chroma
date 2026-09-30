// Pôr uma oportunidade numa etapa, com tudo o que vem junto — o MESMO caminho
// para o arraste no quadro (app/funil/actions.ts) e para a IA que atende no
// WhatsApp (lib/ia/atendente.ts). Separado da server action porque a IA roda
// sem sessão, depois da resposta ao webhook: não há de quem exigir módulo.
import "server-only";
import { inscreverNaCadenciaDaEtapa } from "@/lib/automacoes/repositorio";
import { dispararInscritos } from "@/lib/automacoes/disparo";
import { moverEtapaRegistrando } from "@/lib/historico";
import { eventoAoEntrarNaEtapa } from "@/lib/meta-eventos";

/**
 * Move, registra no histórico, inscreve na cadência da etapa e manda o evento
 * da Meta. `complemento` vai no fim da linha do histórico ("… pela IA X:
 * motivo"). Devolve se a etapa mudou de fato.
 */
export async function moverOportunidadeDeEtapa(
  oportunidadeId: string,
  etapaId: string,
  funilId: string,
  complemento = "",
): Promise<boolean> {
  const mudou = await moverEtapaRegistrando(oportunidadeId, etapaId, funilId, complemento);
  // Entrar na etapa é entrar na cadência dela, se houver uma rodando. É o que
  // faz a cadência valer para "as próximas que entrarem" sem ninguém clicar em
  // nada — ver inscreverNaCadenciaDaEtapa.
  await entrarNaCadencia(oportunidadeId, etapaId);
  // Só quando a etapa mudou: reordenar dentro da coluna não é entrar nela.
  if (mudou) eventoAoEntrarNaEtapa(oportunidadeId, etapaId);
  return mudou;
}

/**
 * Põe a oportunidade na cadência da etapa e manda o motor começar.
 *
 * NÃO DERRUBA QUEM CHAMOU: mover o card é a ação; a cadência é consequência.
 * Se o n8n estiver fora do ar, o card fica na etapa nova do mesmo jeito e a
 * inscrição já está gravada — o próximo Publicar a leva ao motor.
 *
 * Exportada porque criar a oportunidade direto numa etapa também é entrar nela.
 */
export async function entrarNaCadencia(oportunidadeId: string, etapaId: string) {
  try {
    const r = await inscreverNaCadenciaDaEtapa(oportunidadeId, etapaId);
    if (r) await dispararInscritos(r.fluxo, "oportunidade", r.inscritos);
  } catch (e) {
    console.error("[cadencia] falhou ao inscrever na entrada da etapa:", e);
  }
}
