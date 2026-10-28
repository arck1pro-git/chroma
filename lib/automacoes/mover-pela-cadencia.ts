// O bloco "Atualizar oportunidade" com etapa (2026-10-21): a cadência põe o card
// em outra etapa. O caso que o trouxe: a recuperação do Atendimento IA da AMAAN
// terminou sem resposta → "sem contato". Desde 2026-10-28 (pedido dele), o fim
// dela leva ao atendimento humano.
//
// QUEM MOVE É O CRM, pelo MESMO caminho do arraste no quadro e da IA
// (moverOportunidadeDeEtapa): histórico, cadência da etapa nova e evento da
// Meta. O motor só diz "esta execução, este nó, esta etapa".
//
// A ETAPA VALE A DA VERSÃO PUBLICADA AGORA (2026-10-28). O n8n guarda o
// workflow de quando a execução começou, e a cadência dura 14 dias: trocar o
// destino na tela só valeria para quem entrasse depois. Por isso o CRM lê o
// destino do nó (pelo id, que salvar a cadência preserva) na versão publicada
// do fluxo. A etapa que veio no corpo vale quando o nó não está mais lá, não é
// mais um "Atualizar oportunidade" ou ficou sem etapa — aí vai um aviso no log,
// porque quem já está no meio segue para o destino antigo.
//
// A guarda do motor (GUARDA_INSCRITO) já barrou quem respondeu. Aqui entra o que
// ela não vê: mover o card de etapa não desinscreve ninguém (lib/mover-etapa.ts),
// e um card que alguém levou à mão para "reunião agendada" seria puxado de
// volta no fim da cadência. Só move quem continua aberto e na etapa em que
// entrou na cadência.
//
// Chegou ao atendimento humano: grava a linha que acende a pill vermelha do card
// (lib/atendimento-humano.ts), a mesma que a IA acende quando passa o lead.
import "server-only";
import { sql } from "@/lib/db";
import { ETAPA_ATENDIMENTO_HUMANO } from "@/lib/atendimento-humano";
import { registrarEnvioAoAtendimentoHumano } from "@/lib/historico";
import { moverOportunidadeDeEtapa } from "@/lib/mover-etapa";
import { ehUuid } from "@/lib/validacao";

export type ResultadoMover =
  | { movido: string }
  | { pulado: string }
  // Erro é de configuração (etapa que não existe, de outro funil): o nó falha
  // no motor e a execução fica vermelha, com o motivo, em vez de sumir calada.
  | { erro: string; status: number };

export async function moverPelaCadencia(execucaoId: string, etapaId: string, noId = ""): Promise<ResultadoMover> {
  if (!ehUuid(execucaoId) || !ehUuid(etapaId)) return { erro: "execução ou etapa inválida", status: 400 };

  const publicada = noId ? await etapaPublicadaDoNo(execucaoId, noId) : null;
  if (noId && !publicada) {
    console.warn(`[mover pela cadência] ${execucaoId}: o bloco ${noId} não tem etapa na versão publicada; vale a do motor`);
  }
  const destinoId = publicada ?? etapaId;
  const [l] = await sql`
    SELECT e.estado, e.entidade_tipo, e.origem_etapa_id, f.nome AS fluxo, f.etapa_id AS etapa_do_fluxo,
           o.id AS op_id, o.funil_id, o.etapa_id, o.status,
           d.funil_id AS funil_destino, d.nome AS destino
      FROM fluxo_execucoes e
      JOIN fluxos f ON f.id = e.fluxo_id
      LEFT JOIN oportunidades o ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
      LEFT JOIN etapas d ON d.id = ${destinoId}
     WHERE e.id = ${execucaoId}`;
  if (!l) return { erro: "execução não encontrada", status: 404 };
  if (!l.funil_destino) return { erro: "a etapa de destino não existe mais", status: 400 };
  if (l.entidade_tipo !== "oportunidade" || !l.op_id) return { erro: "só oportunidade muda de etapa", status: 400 };
  if (l.funil_destino !== l.funil_id) return { erro: `a etapa "${l.destino}" é de outro funil`, status: 400 };

  if (!["pendente", "rodando", "esperando"].includes(l.estado)) return { pulado: "a execução não está mais ativa" };
  if (l.status !== "aberta") return { pulado: "a oportunidade não está aberta" };
  const etapaDaCadencia = l.origem_etapa_id ?? l.etapa_do_fluxo;
  if (etapaDaCadencia && l.etapa_id !== etapaDaCadencia) return { pulado: "o card já saiu da etapa da cadência" };
  if (l.etapa_id === destinoId) return { pulado: `já está em ${l.destino}` };

  const mudou = await moverOportunidadeDeEtapa(l.op_id, destinoId, l.funil_id, ` pela cadência "${l.fluxo}"`);
  if (mudou && ETAPA_ATENDIMENTO_HUMANO.test(String(l.destino).trim())) {
    await registrarEnvioAoAtendimentoHumano(l.op_id, l.fluxo);
  }
  return { movido: l.destino };
}

/** A etapa do bloco `noId` na versão publicada agora do fluxo da execução; null se o nó não está lá. */
async function etapaPublicadaDoNo(execucaoId: string, noId: string): Promise<string | null> {
  const [v] = await sql`
    SELECT n.no->'config'->>'etapa_id' AS etapa_id
      FROM fluxo_execucoes e
      JOIN fluxos f ON f.id = e.fluxo_id
      JOIN fluxo_versoes v ON v.id = f.versao_publicada_id
     CROSS JOIN LATERAL (SELECT v.definicao->'nos'->${noId}::text AS no) n
     WHERE e.id = ${execucaoId} AND n.no->>'tipo' = 'atualizar_oportunidade'`;
  return v && ehUuid(v.etapa_id) ? v.etapa_id : null;
}
