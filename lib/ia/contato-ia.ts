// O interruptor de IA do CONTATO (contatos.ia + contatos.ia_id), gravado igual
// de onde quer que venha — a gaveta do dashboard e o chat chamam isto, cada um
// com a sua checagem de módulo.
//
//   true  → ligada à mão   (a IA `iaId` responde, em qualquer etapa)
//   false → desligada à mão (nenhuma IA responde, nem em etapa com IA)
//   null  → segue a etapa   (o normal: a IA da etapa, se houver)
//
// ia_id só vale com ia = true; nos outros casos é gravado NULL, para a linha
// nunca dizer duas coisas ao mesmo tempo (migration-ias.sql).
//
// Fica no histórico com quem mexeu: é a primeira pergunta quando "a IA parou
// de responder" alguém. Pelo celular (a palavra da IA, lib/ia/atendente.ts) não
// há usuário do CRM: autor vazio, e `como` diz por onde veio.
import "server-only";
import { sql } from "@/lib/db";

export async function gravarIaDoContato(
  contatoId: string,
  valor: boolean | null,
  iaId: string | null,
  autorId: string | null,
  como?: string,
): Promise<{ erro?: string }> {
  let nomeIa: string | null = null;
  if (valor === true) {
    if (!iaId) return { erro: "Escolha qual IA vai atender." };
    const [ia] = await sql`SELECT nome FROM ias WHERE id = ${iaId}`;
    if (!ia) return { erro: "Essa IA não existe mais." };
    nomeIa = ia.nome as string;
  }
  const id = valor === true ? iaId : null;

  const [linha] = await sql`
    UPDATE contatos SET ia = ${valor}::boolean, ia_id = ${id}::uuid
     WHERE id = ${contatoId}
       AND (ia, ia_id) IS DISTINCT FROM (${valor}::boolean, ${id}::uuid)
    RETURNING id`;
  if (linha) {
    const base =
      valor === true
        ? `IA "${nomeIa}" ligada para o contato: ela responde no WhatsApp em qualquer etapa.`
        : valor === false
          ? "IA desligada para o contato: ela não responde mais no WhatsApp."
          : "IA do contato voltou a seguir a etapa.";
    const frase = como ? `${base.slice(0, -1)} — ${como}.` : base;
    await sql`
      INSERT INTO historico (contato_id, descricao, autor_id)
      VALUES (${contatoId}, ${frase}, ${autorId})`;
  }
  return {};
}
