"use server";

// Toda ação daqui é ponto de entrada de rede: o cliente posta direto nela.
// O proxy já barra quem não tem cookie; esta linha acrescenta o que ele não
// pode conferir sem ir ao banco — se a pessoa ainda existe e ainda está ativa.
import { exigirModulo } from "@/lib/auth/dal";

// Mutações de Contatos. Roda no servidor — trate a entrada como não confiável.
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import {
  atualizarContatoRegistrando,
  registrarContatoCriado,
  registrarTag,
} from "@/lib/historico";

export type NovoContato = {
  nome: string;
  email: string;
  whatsapp: string;
  cidade: string;
  estado: string;
  pais: string;
};

export async function criarContato(dados: NovoContato): Promise<string> {
  await exigirModulo("inicio");
  const nome = dados.nome.trim();
  if (!nome) throw new Error("Nome é obrigatório");

  const [novo] = await sql`
    INSERT INTO contatos (nome, email, whatsapp, cidade, estado, pais)
    VALUES (${nome}, ${dados.email}, ${dados.whatsapp},
            ${dados.cidade}, ${dados.estado}, ${dados.pais || "Brasil"})
    RETURNING id`;

  await registrarContatoCriado(novo.id);
  revalidatePath("/");
  return novo.id;
}

// Edita os dados do contato. Toca / e /chat porque nome/whatsapp aparecem lá.
export async function atualizarContato(
  id: string,
  dados: NovoContato,
): Promise<void> {
  await exigirModulo("inicio");
  const nome = dados.nome.trim();
  if (!nome) throw new Error("Nome é obrigatório");
  // O UPDATE mora em lib/historico.ts junto com a linha que ele gera: dizer
  // QUAIS campos mudaram exige comparar com o valor anterior, e ele só existe
  // dentro da mesma consulta.
  await atualizarContatoRegistrando(id, {
    nome,
    whatsapp: dados.whatsapp.trim(),
    email: dados.email.trim(),
    cidade: dados.cidade.trim(),
    estado: dados.estado.trim(),
    pais: dados.pais.trim() || "Brasil",
  });
  revalidatePath("/");
  revalidatePath("/chat");
}

// ── Vínculos de tag/segmento ao contato ──────────────────────────────────────
// ON CONFLICT DO NOTHING: a PK (contato_id, x_id) já impede duplicar; ignora o
// clique repetido em vez de estourar.
export async function adicionarTag(contatoId: string, tagId: string) {
  await exigirModulo("inicio");
  // RETURNING para não registrar o clique repetido: o ON CONFLICT engole a
  // segunda inserção, e sem esta checagem o histórico ganharia "Tag X
  // adicionada" duas vezes por uma tag só.
  const linhas = await sql`
    INSERT INTO contato_tags (contato_id, tag_id)
    VALUES (${contatoId}, ${tagId}) ON CONFLICT DO NOTHING
    RETURNING contato_id`;
  if (linhas.length) await registrarTag(contatoId, tagId, "adicionada");
  revalidatePath("/");
}

export async function removerTag(contatoId: string, tagId: string) {
  await exigirModulo("inicio");
  const linhas = await sql`
    DELETE FROM contato_tags
    WHERE contato_id = ${contatoId} AND tag_id = ${tagId}
    RETURNING contato_id`;
  if (linhas.length) await registrarTag(contatoId, tagId, "removida");
  revalidatePath("/");
}

export async function adicionarSegmento(contatoId: string, segmentoId: string) {
  await exigirModulo("inicio");
  await sql`
    INSERT INTO contato_segmentos (contato_id, segmento_id)
    VALUES (${contatoId}, ${segmentoId}) ON CONFLICT DO NOTHING`;
  revalidatePath("/");
}

export async function removerSegmento(contatoId: string, segmentoId: string) {
  await exigirModulo("inicio");
  await sql`DELETE FROM contato_segmentos WHERE contato_id = ${contatoId} AND segmento_id = ${segmentoId}`;
  revalidatePath("/");
}

// ── Excluir contato ─────────────────────────────────────────────────────────
//
// Apagar um contato NÃO é só tirar uma linha da lista. O schema manda junto,
// por CASCADE: atendimentos, e com eles TODAS as mensagens de WhatsApp da
// pessoa (mensagens.atendimento_id → atendimentos.contato_id), mais anotações,
// histórico, tags e segmentos. Recebimentos de webhook ficam, com o vínculo
// zerado (ON DELETE SET NULL).
//
// A exceção é `oportunidades.contato_id`, que NÃO tem ON DELETE: o Postgres
// recusa o DELETE enquanto houver negócio ligado ao contato. Isso é proposital
// e a gente confere ANTES, para responder com uma frase em vez do erro cru de
// chave estrangeira.

export type ResumoExclusao = {
  oportunidades: number;
  atendimentos: number;
  mensagens: number;
  anotacoes: number;
};

/**
 * O que a exclusão levaria junto. Serve ao rótulo do botão — a pessoa tem que
 * ler "apaga 34 mensagens" ANTES de clicar, não descobrir depois.
 */
export async function resumoExclusaoContato(
  id: string,
): Promise<ResumoExclusao> {
  await exigirModulo("inicio");
  const [linha] = await sql`
    SELECT
      (SELECT count(*) FROM oportunidades WHERE contato_id = ${id}) AS oportunidades,
      (SELECT count(*) FROM atendimentos  WHERE contato_id = ${id}) AS atendimentos,
      (SELECT count(*) FROM mensagens m
         JOIN atendimentos a ON a.id = m.atendimento_id
        WHERE a.contato_id = ${id})                                 AS mensagens,
      (SELECT count(*) FROM anotacoes    WHERE contato_id = ${id}) AS anotacoes`;

  return {
    oportunidades: Number(linha.oportunidades),
    atendimentos: Number(linha.atendimentos),
    mensagens: Number(linha.mensagens),
    anotacoes: Number(linha.anotacoes),
  };
}

export type ResultadoExclusao = { ok: boolean; erro?: string };

export async function excluirContato(id: string): Promise<ResultadoExclusao> {
  await exigirModulo("inicio");

  // Recontado aqui, e não confiando no número que a tela mostrou: entre abrir
  // a gaveta e clicar pode ter entrado uma oportunidade nova.
  const [{ oportunidades }] = await sql`
    SELECT count(*) AS oportunidades FROM oportunidades WHERE contato_id = ${id}`;

  const n = Number(oportunidades);
  if (n > 0) {
    return {
      ok: false,
      erro:
        n === 1
          ? "Este contato tem 1 oportunidade no funil. Exclua ou transfira a oportunidade antes."
          : `Este contato tem ${n} oportunidades no funil. Exclua ou transfira essas oportunidades antes.`,
    };
  }

  const apagadas = await sql`DELETE FROM contatos WHERE id = ${id} RETURNING id`;
  if (!apagadas.length) return { ok: false, erro: "Contato não encontrado." };

  // /chat também: a conversa da pessoa deixou de existir junto com ela.
  revalidatePath("/");
  revalidatePath("/chat");
  return { ok: true };
}
