"use server";

// Mutações de Contatos. Roda no servidor — trate a entrada como não confiável.
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";

export type NovoContato = {
  nome: string;
  email: string;
  whatsapp: string;
  cidade: string;
  estado: string;
  pais: string;
};

export async function criarContato(dados: NovoContato): Promise<string> {
  const nome = dados.nome.trim();
  if (!nome) throw new Error("Nome é obrigatório");

  const [novo] = await sql`
    INSERT INTO contatos (nome, email, whatsapp, cidade, estado, pais)
    VALUES (${nome}, ${dados.email}, ${dados.whatsapp},
            ${dados.cidade}, ${dados.estado}, ${dados.pais || "Brasil"})
    RETURNING id`;

  revalidatePath("/");
  return novo.id;
}

// Edita os dados do contato. Toca / e /chat porque nome/whatsapp aparecem lá.
export async function atualizarContato(
  id: string,
  dados: NovoContato,
): Promise<void> {
  const nome = dados.nome.trim();
  if (!nome) throw new Error("Nome é obrigatório");
  await sql`
    UPDATE contatos SET
      nome = ${nome}, whatsapp = ${dados.whatsapp.trim()}, email = ${dados.email.trim()},
      cidade = ${dados.cidade.trim()}, estado = ${dados.estado.trim()},
      pais = ${dados.pais.trim() || "Brasil"}
    WHERE id = ${id}`;
  revalidatePath("/");
  revalidatePath("/chat");
}

// ── Vínculos de tag/segmento ao contato ──────────────────────────────────────
// ON CONFLICT DO NOTHING: a PK (contato_id, x_id) já impede duplicar; ignora o
// clique repetido em vez de estourar.
export async function adicionarTag(contatoId: string, tagId: string) {
  await sql`
    INSERT INTO contato_tags (contato_id, tag_id)
    VALUES (${contatoId}, ${tagId}) ON CONFLICT DO NOTHING`;
  revalidatePath("/");
}

export async function removerTag(contatoId: string, tagId: string) {
  await sql`DELETE FROM contato_tags WHERE contato_id = ${contatoId} AND tag_id = ${tagId}`;
  revalidatePath("/");
}

export async function adicionarSegmento(contatoId: string, segmentoId: string) {
  await sql`
    INSERT INTO contato_segmentos (contato_id, segmento_id)
    VALUES (${contatoId}, ${segmentoId}) ON CONFLICT DO NOTHING`;
  revalidatePath("/");
}

export async function removerSegmento(contatoId: string, segmentoId: string) {
  await sql`DELETE FROM contato_segmentos WHERE contato_id = ${contatoId} AND segmento_id = ${segmentoId}`;
  revalidatePath("/");
}
