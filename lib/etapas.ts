// Remover uma etapa do funil — o botão da lixeira em Configurações → Funis.
//
// Separado da action (app/configuracoes/actions.ts) para que a regra de banco
// possa ser chamada e testada sem sessão; a action só confere quem pede.
//
// O QUE APONTA PARA UMA ETAPA, e o que acontece com cada um (conferido no
// esquema em 2026-10-14 — são as únicas colunas com id de etapa, e nenhum JSON
// de automação guarda etapa):
//   · oportunidades.etapa_id   → MOVIDAS para a etapa que a pessoa escolher;
//   · webhook_acoes.etapa_id   → passam a criar o lead nessa mesma etapa. Sem
//     isso o DELETE estoura (FK sem ON DELETE) ou, pior, a webhook ficaria
//     criando lead numa etapa que ninguém vê;
//   · fluxos.etapa_id (cadência da etapa) → RECUSA. A cadência tem workflow no
//     n8n e leads no meio da sequência; apagar a etapa por baixo deixaria tudo
//     órfão. Exclui-se a cadência no quadro primeiro (excluirFluxo);
//   · fluxo_execucoes.origem_etapa_id e meta_eventos.etapa_id → ON DELETE SET
//     NULL no banco: o registro fica, sem a etapa.
//
// MOVER AQUI NÃO É "ENTRAR NA ETAPA". As oportunidades vão para o destino sem
// disparar a cadência nem o evento da Meta dele (o que lib/mover-etapa.ts faz
// num arraste): é uma arrumação de funil, e mandar "Ganho" para a Meta por
// todas de uma vez seria inventar conversão. O histórico de cada uma registra
// a mudança, na mesma frase que o arraste usa ("Movida de X para Y").
import { sql } from "@/lib/db";

export type ResultadoRemocao = { erro?: string; movidas?: number; webhooks?: number };

export async function removerEtapaNoBanco(
  etapaId: string,
  destinoId: string | null,
): Promise<ResultadoRemocao> {
  if (destinoId === etapaId) return { erro: "Escolha outra etapa como destino." };

  // Tudo numa transação: mover pela metade e falhar no DELETE deixaria
  // oportunidades no destino com a etapa velha ainda de pé.
  return sql.begin(async (tx: typeof sql) => {
    // FOR UPDATE: dois cliques (ou duas abas) removendo a mesma etapa não
    // movem as oportunidades duas vezes.
    const [etapa] = await tx`
      SELECT id, nome, funil_id FROM etapas WHERE id = ${etapaId} FOR UPDATE`;
    if (!etapa) return { erro: "Essa etapa não existe mais. Recarregue a página." };

    const [cadencia] = await tx`
      SELECT nome FROM fluxos WHERE etapa_id = ${etapaId} AND arquivado_em IS NULL LIMIT 1`;
    if (cadencia) {
      return {
        erro: `A etapa tem a cadência "${cadencia.nome}". Exclua a cadência no quadro antes de remover a etapa.`,
      };
    }

    const [uso] = await tx`
      SELECT (SELECT count(*)::int FROM oportunidades WHERE etapa_id = ${etapaId}) AS oportunidades,
             (SELECT count(*)::int FROM webhook_acoes WHERE etapa_id = ${etapaId}) AS webhooks`;
    const movidas = uso.oportunidades as number;
    const webhooks = uso.webhooks as number;

    if (movidas + webhooks > 0) {
      if (!destinoId) return { erro: "Escolha para qual etapa vão as oportunidades desta." };
      const [destino] = await tx`
        SELECT id, nome FROM etapas WHERE id = ${destinoId} AND funil_id = ${etapa.funil_id}`;
      if (!destino) return { erro: "A etapa de destino precisa ser deste mesmo funil." };

      // O histórico ANTES do UPDATE: depois dele não há mais como achar quem
      // estava na etapa removida.
      await tx`
        INSERT INTO historico (contato_id, oportunidade_id, descricao)
        SELECT o.contato_id, o.id,
               ${`Movida de ${etapa.nome} para ${destino.nome} — a etapa ${etapa.nome} foi removida do funil`}
          FROM oportunidades o
         WHERE o.etapa_id = ${etapaId}`;
      await tx`UPDATE oportunidades SET etapa_id = ${destinoId} WHERE etapa_id = ${etapaId}`;
      await tx`UPDATE webhook_acoes SET etapa_id = ${destinoId} WHERE etapa_id = ${etapaId}`;
    }

    await tx`DELETE FROM etapas WHERE id = ${etapaId}`;

    // Regrava 1..N sem o buraco: o quadro e a faixa de tons leem a posição.
    await tx`
      WITH ordenadas AS (
        SELECT id, row_number() OVER (ORDER BY ordem, data_criacao)::int AS n
          FROM etapas WHERE funil_id = ${etapa.funil_id}
      )
      UPDATE etapas e SET ordem = o.n
        FROM ordenadas o
       WHERE e.id = o.id AND e.ordem IS DISTINCT FROM o.n`;

    return { movidas, webhooks };
  });
}
