"use server";

// Ligar a IA numa etapa e mexer na exceção do contato — as duas pontas do
// "quem a IA atende" (ver app/funil/ia.ts e lib/ia/atendente.ts).
//
// Módulo "inicio": é onde o quadro e a gaveta de contatos moram, e as outras
// ações da gaveta (app/contatos/actions.ts) pedem o mesmo.
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { exigirModulo } from "@/lib/auth/dal";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function definirIaDaEtapa(etapaId: string, ligada: boolean): Promise<{ erro?: string }> {
  await exigirModulo("inicio");
  if (!UUID.test(etapaId)) return { erro: "Etapa inválida." };
  await sql`UPDATE etapas SET ia_atende = ${ligada} WHERE id = ${etapaId}`;
  revalidatePath("/");
  return {};
}

const FRASE: Record<string, string> = {
  true: "Contato vinculado à IA: ela responde no WhatsApp em qualquer etapa.",
  false: "Contato removido da IA: ela não responde mais no WhatsApp.",
  null: "Atendimento por IA do contato voltou a seguir a etapa.",
};

/**
 * A exceção do contato: `true` vinculado, `false` removido, `null` segue a
 * etapa. Fica no histórico com quem mexeu — é a primeira pergunta quando a IA
 * "parou de responder" alguém.
 */
export async function definirIaDoContato(
  contatoId: string,
  valor: boolean | null,
): Promise<{ erro?: string }> {
  const { usuario } = await exigirModulo("inicio");
  if (!UUID.test(contatoId)) return { erro: "Contato inválido." };
  const [linha] = await sql`
    UPDATE contatos SET ia = ${valor}
     WHERE id = ${contatoId} AND ia IS DISTINCT FROM ${valor}
    RETURNING id`;
  if (linha) {
    await sql`
      INSERT INTO historico (contato_id, descricao, autor_id)
      VALUES (${contatoId}, ${FRASE[String(valor)]}, ${usuario.id})`;
  }
  revalidatePath("/");
  return {};
}
