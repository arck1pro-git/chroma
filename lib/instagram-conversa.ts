// O direct do Instagram dentro das conversas do CRM: o contato, a conversa e a
// mensagem que NÓS mandamos por fora do compositor (o direct aberto a partir
// de um comentário). Desde 2026-10-26.
//
// O CONTATO É O IGSID (contatos.campos.instagram_id), com índice único na
// expressão (migration-instagram.sql). O @ (instagram_usuario) é só exibição:
// pode mudar quando a pessoa quiser, e nunca serve de chave. Contato só nasce
// quando HÁ direct (mensagem dela, eco nosso ou o private reply que devolve o
// IGSID); antes disso o autor de um comentário fica só na linha do comentário.
//
// O contato que nasce aqui vem com ia = NULL e sem oportunidade: a IA de
// atendimento NÃO responde a ele por padrão (iaQueAtende devolve nenhuma). Só
// a IA de comentário, com regra ligada por Admin ou TI, liga a IA dela no
// contato (lib/ia/comentarios.ts).
import "server-only";
import { sql } from "@/lib/db";
import { ehIdMeta, motivoDoErro, NOME_PROVISORIO, perfilDoUsuario, usuarioValido } from "@/lib/instagram";
import type { Perfil } from "@/lib/social/perfis";

/** O contato daquele IGSID, o que existe ou um novo. `criado` = nasceu agora. */
export async function contatoDoInstagram(e: { igsid: string; usuario: string | null }): Promise<{ id: string; criado: boolean }> {
  if (!ehIdMeta(e.igsid)) throw new Error("IGSID inválido.");
  const usuario = usuarioValido(e.usuario);
  const campos = usuario ? { instagram_id: e.igsid, instagram_usuario: usuario } : { instagram_id: e.igsid };
  // ON CONFLICT no índice da expressão, com o mesmo predicado: é o que deixa
  // dois eventos da mesma pessoa no mesmo instante virarem UM contato.
  // O nome NÃO é o @: o @ fica só em campos (que o conector MCP mascara, item 14
  // da revisão). O nome de verdade chega com o perfil (atualizarPerfilDoContato).
  const [c] = await sql`
    INSERT INTO contatos (nome, campos)
    VALUES (${NOME_PROVISORIO}, ${sql.json(campos)})
    ON CONFLICT ((campos->>'instagram_id')) WHERE campos ? 'instagram_id'
    DO UPDATE SET campos = CASE
                    WHEN ${usuario}::text IS NULL THEN contatos.campos
                    ELSE contatos.campos || jsonb_build_object('instagram_usuario', ${usuario}::text)
                  END
    RETURNING id, (xmax = 0) AS criado`;
  return { id: c.id as string, criado: c.criado === true };
}

/**
 * Nome e @ do perfil do Instagram no contato que ainda tem o nome provisório.
 * Nome que alguém da equipe escreveu não é trocado; perfil sem nome deixa o
 * provisório (o @ não vira nome). Nunca lança: sem o perfil, o contato segue
 * com o que tem.
 */
export async function atualizarPerfilDoContato(contatoId: string, perfil: Perfil, igsid: string): Promise<void> {
  try {
    const p = await perfilDoUsuario(perfil, igsid);
    const nome = p.nome;
    if (!nome && !p.usuario) return;
    await sql`
      UPDATE contatos
         SET nome = CASE WHEN ${nome}::text IS NOT NULL AND (nome = ${NOME_PROVISORIO} OR nome LIKE '@%')
                         THEN ${nome}::text ELSE nome END,
             campos = CASE WHEN ${p.usuario}::text IS NULL THEN campos
                           ELSE campos || jsonb_build_object('instagram_usuario', ${p.usuario}::text) END
       WHERE id = ${contatoId} AND campos->>'instagram_id' = ${igsid}`;
  } catch (e) {
    console.error("[instagram] não li o perfil do contato", contatoId, motivoDoErro(e));
  }
}

/**
 * A conversa do contato com a conta: uma por par (contato, conta), pela mesma
 * trava das outras (ux_atendimento_contato_numero).
 *   · 'contato' → ele escreveu: encerrada (ou aberta sem dono) volta para a fila;
 *   · 'nos'     → nós escrevemos (IA, equipe, celular): nasce aberta e sem dono.
 */
export async function conversaDoInstagram(contatoId: string, contaId: string, quem: "contato" | "nos"): Promise<string> {
  if (!ehIdMeta(contaId)) throw new Error("Conta do Instagram inválida.");
  const [at] =
    quem === "contato"
      ? await sql`
          INSERT INTO atendimentos (contato_id, status, canal, numero_instancia)
          VALUES (${contatoId}, 'na_fila', 'instagram', ${contaId})
          ON CONFLICT (contato_id, numero_instancia) WHERE contato_id IS NOT NULL DO UPDATE
            SET status = CASE
                  WHEN atendimentos.status = 'encerrado'
                    OR (atendimentos.status = 'aberto' AND atendimentos.responsavel_id IS NULL)
                  THEN 'na_fila'
                  ELSE atendimentos.status
                END,
                canal = 'instagram',
                data_atualizacao = now()
          RETURNING id`
      : await sql`
          INSERT INTO atendimentos (contato_id, status, canal, numero_instancia)
          VALUES (${contatoId}, 'aberto', 'instagram', ${contaId})
          ON CONFLICT (contato_id, numero_instancia) WHERE contato_id IS NOT NULL DO UPDATE
            SET data_atualizacao = now()
          RETURNING id`;
  return at.id as string;
}

/**
 * Registra na conversa um direct que saiu por fora do compositor (o aberto a
 * partir de um comentário). O eco da Meta pode ter chegado antes e virado uma
 * linha 'aparelho' com o mesmo id: a nossa vence, com quem enviou de verdade.
 */
export async function registrarDirectEnviado(e: {
  atendimentoId: string;
  texto: string;
  idExterno: string;
  enviadaPor: "ia" | "crm";
  autorId: string | null;
}): Promise<void> {
  await sql`
    INSERT INTO mensagens (atendimento_id, origem, autor_id, texto, status, id_externo, enviada_por)
    VALUES (${e.atendimentoId}, 'agente', ${e.autorId}, ${e.texto}, 'enviado', ${e.idExterno}, ${e.enviadaPor})
    ON CONFLICT (id_externo) WHERE id_externo IS NOT NULL DO UPDATE
      SET enviada_por = EXCLUDED.enviada_por, autor_id = EXCLUDED.autor_id
      WHERE mensagens.origem = 'agente' AND mensagens.enviada_por = 'aparelho'`;
  await sql`UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${e.atendimentoId}`;
}
