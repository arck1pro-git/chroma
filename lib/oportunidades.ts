// A regra de "uma aberta por contato em cada funil", do lado do servidor.
//
// Mora num módulo porque três portas precisam dela e precisam responder a
// MESMA coisa: a tela (app/funil/actions.ts), a captação por webhook
// (lib/webhooks-recepcao.ts) e o reabrir de uma oportunidade fechada.
//
// Quem garante a regra é o índice parcial `ux_oportunidade_aberta_por_funil`
// (migration-oportunidade-unica.sql). O que está aqui é o que o índice não faz:
// dizer o nome de quem já está lá, em português, antes de alguém ver um erro
// 23505.
import { sql } from "@/lib/db";

export type AbertaNoFunil = { id: string; nome: string; contato: string };

/**
 * A oportunidade ABERTA que este contato já tem neste funil, se houver.
 *
 * `ignorarId` existe para o reabrir: a própria oportunidade que está mudando de
 * status não pode ser considerada concorrente de si mesma.
 */
export async function abertaNoFunil(
  contatoId: string,
  funilId: string,
  ignorarId?: string,
): Promise<AbertaNoFunil | null> {
  const [linha] = ignorarId
    ? await sql`
        SELECT o.id, o.nome, c.nome AS contato
        FROM oportunidades o
        JOIN contatos c ON c.id = o.contato_id
        WHERE o.contato_id = ${contatoId} AND o.funil_id = ${funilId}
          AND o.status = 'aberta' AND o.id <> ${ignorarId}
        LIMIT 1`
    : await sql`
        SELECT o.id, o.nome, c.nome AS contato
        FROM oportunidades o
        JOIN contatos c ON c.id = o.contato_id
        WHERE o.contato_id = ${contatoId} AND o.funil_id = ${funilId}
          AND o.status = 'aberta'
        LIMIT 1`;

  return (linha as AbertaNoFunil | undefined) ?? null;
}

/**
 * O erro do Postgres quando duas gravações simultâneas passam pela verificação
 * e o índice barra a segunda.
 *
 * 23505 = unique_violation. O nome do índice entra na checagem porque
 * `oportunidades` tem outras restrições, e transformar qualquer 23505 em "já
 * existe uma aberta" esconderia um problema diferente atrás da mensagem errada.
 */
export function ehDuplicadaNoFunil(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const erro = e as { code?: string; constraint_name?: string };
  return (
    erro.code === "23505" &&
    erro.constraint_name === "ux_oportunidade_aberta_por_funil"
  );
}

/** A frase única desta regra. Um lugar só, para as três portas dizerem igual. */
export function jaTemAberta(contato: string): string {
  return `${contato} já tem uma oportunidade aberta neste funil. Feche a atual (ganha ou perdida) antes de abrir outra.`;
}
