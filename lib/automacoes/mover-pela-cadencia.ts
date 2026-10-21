// O bloco "Atualizar oportunidade" com etapa (2026-10-21): a cadência põe o card
// em outra etapa. O caso que o trouxe: a recuperação do Atendimento IA da AMAAN
// terminou sem resposta → "sem contato".
//
// QUEM MOVE É O CRM, pelo MESMO caminho do arraste no quadro e da IA
// (moverOportunidadeDeEtapa): histórico, cadência da etapa nova e evento da
// Meta. O motor só diz "esta execução, esta etapa".
//
// A guarda do motor (GUARDA_INSCRITO) já barrou quem respondeu. Aqui entra o que
// ela não vê: mover o card de etapa não desinscreve ninguém (lib/mover-etapa.ts),
// e um card que alguém levou à mão para "solicitou contato" seria puxado de
// volta para "sem contato" no fim da cadência. Só move quem continua aberto e
// na etapa em que entrou na cadência.
import "server-only";
import { sql } from "@/lib/db";
import { moverOportunidadeDeEtapa } from "@/lib/mover-etapa";
import { ehUuid } from "@/lib/validacao";

export type ResultadoMover =
  | { movido: string }
  | { pulado: string }
  // Erro é de configuração (etapa que não existe, de outro funil): o nó falha
  // no motor e a execução fica vermelha, com o motivo, em vez de sumir calada.
  | { erro: string; status: number };

export async function moverPelaCadencia(execucaoId: string, etapaId: string): Promise<ResultadoMover> {
  if (!ehUuid(execucaoId) || !ehUuid(etapaId)) return { erro: "execução ou etapa inválida", status: 400 };

  const [l] = await sql`
    SELECT e.estado, e.entidade_tipo, e.origem_etapa_id, f.nome AS fluxo, f.etapa_id AS etapa_do_fluxo,
           o.id AS op_id, o.funil_id, o.etapa_id, o.status,
           d.funil_id AS funil_destino, d.nome AS destino
      FROM fluxo_execucoes e
      JOIN fluxos f ON f.id = e.fluxo_id
      LEFT JOIN oportunidades o ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
      LEFT JOIN etapas d ON d.id = ${etapaId}
     WHERE e.id = ${execucaoId}`;
  if (!l) return { erro: "execução não encontrada", status: 404 };
  if (!l.funil_destino) return { erro: "a etapa de destino não existe mais", status: 400 };
  if (l.entidade_tipo !== "oportunidade" || !l.op_id) return { erro: "só oportunidade muda de etapa", status: 400 };
  if (l.funil_destino !== l.funil_id) return { erro: `a etapa "${l.destino}" é de outro funil`, status: 400 };

  if (!["pendente", "rodando", "esperando"].includes(l.estado)) return { pulado: "a execução não está mais ativa" };
  if (l.status !== "aberta") return { pulado: "a oportunidade não está aberta" };
  const etapaDaCadencia = l.origem_etapa_id ?? l.etapa_do_fluxo;
  if (etapaDaCadencia && l.etapa_id !== etapaDaCadencia) return { pulado: "o card já saiu da etapa da cadência" };
  if (l.etapa_id === etapaId) return { pulado: `já está em ${l.destino}` };

  await moverOportunidadeDeEtapa(l.op_id, etapaId, l.funil_id, ` pela cadência "${l.fluxo}"`);
  return { movido: l.destino };
}
