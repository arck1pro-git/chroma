// Os comentários das postagens do Instagram no CRM (instagram_comentarios,
// migration-instagram.sql): responder pela equipe, abrir o direct a partir de
// um comentário, as regras da IA, marcar lidos, buscar na Meta o que faltou e
// as contagens do /chat. Desde 2026-10-26.
//
// O que a tela manda é só o uuid da linha: o id do comentário na Meta, a conta
// e o autor saem do banco (revisão de segurança, item 6). Erro esperado sobe
// como `Recusa` (lib/resultado-acao.ts), para a ação devolver como valor.
//
// RESERVAS (os índices únicos da migration são a trava, não a leitura antes):
//   · direct: uma vez por pessoa por postagem (ux_ig_direct_por_autor), IA ou
//     equipe — e a Meta só aceita um private reply por comentário, até 7 dias;
//   · nossa resposta pública nasce 'pendente' ANTES da Meta e termina
//     'enviado' (com o id da Meta) ou 'erro'.
import "server-only";
import { listaUuid, sql } from "@/lib/db";
import { podeOperar } from "@/lib/auth/permissoes";
import type { UsuarioLogado } from "@/lib/auth/dal";
import { Recusa, ehDuplicado } from "@/lib/resultado-acao";
import { ehUuid } from "@/lib/validacao";
import { validarAutomacaoComentario } from "@/lib/instagram-automacao";
import type { AutomacaoComentarioInstagram } from "@/lib/instagram-tipos";
import {
  comentariosDaPostagem,
  ehContaNossa,
  ehIdMeta,
  enviarDirectDoComentario,
  midiaEhDaConta,
  motivoDoErro as motivo,
  perfilDaConta,
  responderEmPublico,
} from "@/lib/instagram";
import {
  atualizarPerfilDoContato,
  contatoDoInstagram,
  conversaDoInstagram,
  registrarDirectEnviado,
} from "@/lib/instagram-conversa";

/**
 * Quem FALA PELA MARCA no Instagram: responde em público e liga ou desliga a
 * IA de comentários. É quem tem o módulo Meta (Admin e TI no seed; revisão de
 * segurança, item 13). Um predicado só: a ação confere com ele e a tela
 * (ComentariosDaConta.podeAdministrar) esconde os controles com ele.
 */
export function falaPelaMarca(usuario: Pick<UsuarioLogado, "modulos" | "permissoes"> | null | undefined, operacao: "criar" | "editar" = "editar"): boolean {
  return Boolean(usuario && podeOperar(usuario, "meta", operacao));
}

/** A Meta só aceita o direct a partir de um comentário até 7 dias depois dele. */
const PRAZO_DO_DIRECT_MS = 7 * 24 * 60 * 60 * 1000;
/** Limites de texto do Instagram: comentário e direct. */
const MAX_PUBLICO = 2200;
const MAX_DIRECT = 1000;

export type LinhaComentario = {
  id: string;
  conta_id: string;
  midia_id: string;
  midia_tipo: string | null;
  comentario_id: string | null;
  pai_id: string | null;
  autor_id: string | null;
  autor_usuario: string | null;
  texto: string;
  da_conta: boolean;
  data_criacao: Date;
  direct_em: Date | null;
};

export async function linhaDoComentario(linhaId: string): Promise<LinhaComentario | null> {
  if (!ehUuid(linhaId)) return null;
  const [l] = await sql`
    SELECT id, conta_id, midia_id, midia_tipo, comentario_id, pai_id, autor_id, autor_usuario,
           texto, da_conta, data_criacao, direct_em
      FROM instagram_comentarios WHERE id = ${linhaId}`;
  return (l as unknown as LinhaComentario) ?? null;
}

// ── Direct a partir do comentário ───────────────────────────────────────────

export type DirectAberto =
  | { ok: true; contatoId: string; atendimentoId: string }
  | { ok: false; erro: string; jaTinha?: boolean };

/**
 * Abre o direct com quem comentou (private reply), para a IA e para a equipe:
 * reserva no comentário, manda, e só então cria (ou acha) o contato pelo IGSID
 * que a Meta devolveu e registra a mensagem na conversa. Falhou o envio, a
 * reserva é desfeita.
 */
export async function abrirDirectDoComentario(
  linha: LinhaComentario,
  texto: string,
  por: { quem: "ia" | "crm"; usuarioId: string | null },
): Promise<DirectAberto> {
  const perfil = perfilDaConta(linha.conta_id);
  if (!perfil || linha.da_conta || !ehIdMeta(linha.comentario_id) || !ehIdMeta(linha.autor_id)) {
    return { ok: false, erro: "Este comentário não pode virar direct." };
  }
  if (Date.now() - new Date(linha.data_criacao).getTime() > PRAZO_DO_DIRECT_MS) {
    return { ok: false, erro: "O Instagram só deixa chamar no direct até 7 dias depois do comentário." };
  }

  let reservada = false;
  try {
    const r = await sql`
      UPDATE instagram_comentarios SET direct_em = now(), direct_por = ${por.quem}
       WHERE id = ${linha.id} AND direct_em IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM instagram_comentarios x
            WHERE x.conta_id = ${linha.conta_id} AND x.midia_id = ${linha.midia_id}
              AND x.autor_id = ${linha.autor_id} AND x.direct_em IS NOT NULL)
      RETURNING id`;
    reservada = r.length > 0;
  } catch (e) {
    // A trava do índice pegou a corrida que o NOT EXISTS não viu.
    if (!ehDuplicado(e)) throw e;
  }
  if (!reservada) {
    return { ok: false, erro: "Essa pessoa já foi chamada no direct por esta postagem. Continue pela conversa.", jaTinha: true };
  }

  let enviado;
  try {
    enviado = await enviarDirectDoComentario(perfil, linha.comentario_id, linha.autor_id, texto);
  } catch (e) {
    await sql`UPDATE instagram_comentarios SET direct_em = NULL, direct_por = NULL WHERE id = ${linha.id}`;
    return { ok: false, erro: motivo(e) };
  }

  // O IGSID que a Meta devolveu é o da conversa; sem ele, o do comentário.
  const igsid = enviado.recipientId ?? linha.autor_id;
  const contato = await contatoDoInstagram({ igsid, usuario: linha.autor_usuario });
  // O nome do perfil, como no contato que nasce de uma DM (nunca lança).
  if (contato.criado) await atualizarPerfilDoContato(contato.id, perfil, igsid);
  const atendimentoId = await conversaDoInstagram(contato.id, linha.conta_id, "nos");
  await registrarDirectEnviado({
    atendimentoId,
    texto: texto.trim(),
    idExterno: enviado.id,
    enviadaPor: por.quem,
    autorId: por.usuarioId,
  });
  // Os comentários dessa pessoa nesta conta passam a apontar para o contato.
  await sql`
    UPDATE instagram_comentarios SET contato_id = ${contato.id}
     WHERE conta_id = ${linha.conta_id} AND autor_id = ${linha.autor_id} AND contato_id IS NULL`;
  return { ok: true, contatoId: contato.id, atendimentoId };
}

// ── Resposta pública ────────────────────────────────────────────────────────

/**
 * A nossa resposta recebeu o id da Meta. O eco do webhook pode ter chegado
 * antes e virado uma linha 'aparelho' com o mesmo id: ela sai e a nossa fica
 * (mesmo arranjo de confirmarEnvio em lib/conversa-envio.ts).
 */
export async function confirmarRespostaPublica(linhaId: string, idMeta: string): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    await sql`
      DELETE FROM instagram_comentarios
       WHERE comentario_id = ${idMeta} AND id <> ${linhaId} AND da_conta AND enviada_por = 'aparelho'`;
    try {
      // data_registro anda: é o que o /api/chat/versao vê para a tela mostrar a resposta.
      await sql`
        UPDATE instagram_comentarios
           SET comentario_id = ${idMeta}, envio = 'enviado', erro = NULL, data_registro = now()
         WHERE id = ${linhaId}`;
      return;
    } catch (e) {
      // O eco entrou entre o DELETE e o UPDATE: mais uma volta.
      if (!ehDuplicado(e) || tentativa >= 2) throw e;
    }
  }
}

export async function marcarErroDaResposta(linhaId: string, e: unknown): Promise<void> {
  await sql`
    UPDATE instagram_comentarios SET envio = 'erro', erro = ${motivo(e)}, data_registro = now()
     WHERE id = ${linhaId}`;
}

// ── Pela equipe ─────────────────────────────────────────────────────────────

/**
 * A equipe responde a um comentário: em público (a ação confere antes que é
 * Admin ou TI) ou no direct. Lança `Recusa` com a frase para a tela.
 */
export async function responderComentarioPelaEquipe(
  linhaId: string,
  bruto: string,
  modo: "publico" | "direct",
  usuarioId: string,
): Promise<void> {
  const linha = await linhaDoComentario(linhaId);
  if (!linha || linha.da_conta || !ehIdMeta(linha.comentario_id)) throw new Recusa("Comentário não encontrado.");
  const perfil = perfilDaConta(linha.conta_id);
  if (!perfil) throw new Recusa("Este comentário não é de uma das contas do CRM.");
  if (!ehIdMeta(linha.autor_id)) throw new Recusa("Não sei quem fez este comentário: responda pelo Instagram.");
  const texto = bruto.trim();
  if (!texto) throw new Recusa("Escreva a resposta.");

  if (modo === "direct") {
    if (texto.length > MAX_DIRECT) throw new Recusa("O direct passa de 1.000 caracteres, o limite do Instagram.");
    const r = await abrirDirectDoComentario(linha, texto, { quem: "crm", usuarioId });
    if (!r.ok) throw new Recusa(r.erro);
    // Chamar no direct é assumir a conversa, como responder pelo chat.
    await sql`
      UPDATE atendimentos
         SET responsavel_id = COALESCE(responsavel_id, ${usuarioId}),
             status = CASE WHEN status = 'na_fila' THEN 'aberto' ELSE status END,
             lido_em = now(), data_atualizacao = now()
       WHERE id = ${r.atendimentoId}`;
  } else {
    if (texto.length > MAX_PUBLICO) throw new Recusa("A resposta passa de 2.200 caracteres, o limite do Instagram.");
    // O Instagram só tem um nível de resposta: responder a uma resposta é
    // responder ao comentário de cima.
    const alvo = linha.pai_id ?? linha.comentario_id;
    const [nossa] = await sql`
      INSERT INTO instagram_comentarios
        (conta_id, midia_id, midia_tipo, pai_id, autor_id, autor_usuario, texto, da_conta,
         enviada_por, envio, para_autor_id, lido_em)
      VALUES
        (${linha.conta_id}, ${linha.midia_id}, ${linha.midia_tipo}, ${alvo}, ${perfil.instagramId}, ${perfil.instagram},
         ${texto}, true, 'crm', 'pendente', ${linha.autor_id}, now())
      RETURNING id`;
    try {
      const r = await responderEmPublico(perfil, alvo, linha.autor_id, texto);
      await confirmarRespostaPublica(nossa.id as string, r.id);
    } catch (e) {
      await marcarErroDaResposta(nossa.id as string, e);
      throw new Recusa(motivo(e));
    }
  }
  await sql`UPDATE instagram_comentarios SET lido_em = now() WHERE id = ${linha.id} AND lido_em IS NULL`;
}

// ── Regras da IA ────────────────────────────────────────────────────────────

/**
 * Liga, desliga ou troca a IA de uma conta (midiaId null = todas as postagens)
 * ou de uma postagem. iaId null apaga a regra. A postagem é conferida como
 * desta conta na Meta. Quem pode é decidido na ação (Admin e TI).
 */
export async function salvarRegraIa(contaId: string, midiaId: string | null, iaId: string | null, ligada: boolean, configuracao?: AutomacaoComentarioInstagram): Promise<void> {
  const perfil = perfilDaConta(contaId);
  if (!perfil) throw new Recusa("Conta do Instagram inválida.");
  if (midiaId !== null && !ehIdMeta(midiaId)) throw new Recusa("Postagem inválida.");
  if (iaId === null && configuracao === undefined) {
    await sql`
      DELETE FROM instagram_ia_regras
       WHERE conta_id = ${perfil.instagramId} AND midia_id IS NOT DISTINCT FROM ${midiaId}::text`;
    return;
  }
  let automacao: AutomacaoComentarioInstagram | undefined;
  try { automacao = configuracao === undefined ? undefined : validarAutomacaoComentario(configuracao); }
  catch (e) { throw new Recusa(e instanceof Error ? e.message : "Automação inválida."); }
  const precisaIa = !automacao || automacao.modo === "ia" || automacao.continuarComIa;
  if ((precisaIa || iaId !== null) && !ehUuid(iaId)) throw new Recusa("IA inválida. Escolha a IA que continuará o atendimento.");
  if (typeof ligada !== "boolean") throw new Recusa("Diga se a IA fica ligada.");
  if (iaId !== null) {
    const [ia] = await sql`SELECT id FROM ias WHERE id = ${iaId}`;
    if (!ia) throw new Recusa("Essa IA não existe mais.");
  }
  // Só LIGAR exige a Meta confirmar o dono: desligar tem de funcionar mesmo com a
  // Graph fora ou a postagem fora das recentes (regra desligada é inofensiva).
  if (midiaId !== null && ligada && !(await midiaEhDaConta(perfil, midiaId))) {
    throw new Recusa("Não consegui confirmar na Meta que essa postagem é desta conta.");
  }
  await sql`
    INSERT INTO instagram_ia_regras (conta_id, midia_id, ia_id, ligada, automacao)
    VALUES (${perfil.instagramId}, ${midiaId}, ${iaId}, ${ligada}, ${sql.json(automacao ?? {})}::jsonb)
    ON CONFLICT (conta_id, midia_id) DO UPDATE
      SET ia_id = EXCLUDED.ia_id, ligada = EXCLUDED.ligada,
          automacao = CASE WHEN ${automacao !== undefined} THEN EXCLUDED.automacao ELSE instagram_ia_regras.automacao END`;
}

// ── Lidos e busca na Meta ───────────────────────────────────────────────────

export async function marcarComentariosLidos(contaId: string, midiaId: string, ids: string[]): Promise<void> {
  const perfil = perfilDaConta(contaId);
  if (!perfil) throw new Recusa("Conta do Instagram inválida.");
  if (!ehIdMeta(midiaId)) throw new Recusa("Postagem inválida.");
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some((id) => !ehUuid(id))) throw new Recusa("Comentários inválidos.");
  if (!ids.length) return;
  await sql`
    UPDATE instagram_comentarios SET lido_em = now()
     WHERE conta_id = ${perfil.instagramId} AND midia_id = ${midiaId} AND NOT da_conta AND lido_em IS NULL
       AND id = ANY(string_to_array(${listaUuid([...new Set(ids)])}, ',')::uuid[])`;
}

/**
 * Grava os comentários recentes da postagem que o webhook não trouxe (os de
 * antes da inscrição, ou um evento perdido). Busca manual só importa; o
 * agendador marca candidatos recentes para a fila persistida. Oculto não entra.
 */
export async function sincronizarComentarios(
  contaId: string, midiaId: string,
  automatico = false,
  midiaTipo: string | null = null,
): Promise<{ novos: number }> {
  const perfil = perfilDaConta(contaId);
  if (!perfil) throw new Recusa("Conta do Instagram inválida.");
  if (!ehIdMeta(midiaId)) throw new Recusa("Postagem inválida.");
  if (!(await midiaEhDaConta(perfil, midiaId))) throw new Recusa("Não consegui confirmar na Meta que essa postagem é desta conta.");

  let lista;
  try {
    lista = await comentariosDaPostagem(midiaId);
  } catch (e) {
    throw new Recusa(`A Meta não devolveu os comentários: ${motivo(e)}`);
  }
  const linhas = lista
    .filter((c) => !c.oculto)
    .map((c) => ({
      comentario_id: c.id,
      pai_id: c.paiId,
      autor_id: c.autorId,
      autor_usuario: c.autorUsuario,
      texto: c.texto,
      da_conta: ehContaNossa(c.autorId),
      quando: c.quando,
    }));
  if (!linhas.length) return { novos: 0 };

  // Comentário de uma das nossas contas que o CRM não registrou foi feito pelo
  // app do celular. O contato só é ligado se já existir (contato nasce no direct).
  const novos = await sql`
    INSERT INTO instagram_comentarios
      (conta_id, midia_id, midia_tipo, comentario_id, pai_id, autor_id, autor_usuario, texto, da_conta,
       enviada_por, lido_em, data_criacao, contato_id, automacao_pendente)
    SELECT ${perfil.instagramId}, ${midiaId}, ${midiaTipo}, x.comentario_id, x.pai_id, x.autor_id, x.autor_usuario,
           coalesce(x.texto, ''), x.da_conta,
           CASE WHEN x.da_conta THEN 'aparelho' END,
           CASE WHEN x.da_conta THEN now() END,
           coalesce(x.quando, now()),
           (SELECT c.id FROM contatos c
             WHERE c.campos ? 'instagram_id' AND c.campos->>'instagram_id' = x.autor_id),
           ${automatico} AND NOT x.da_conta AND x.pai_id IS NULL
             AND coalesce(x.quando >= now() - interval '10 minutes', false)
      FROM jsonb_to_recordset(${sql.json(linhas)})
        AS x(comentario_id text, pai_id text, autor_id text, autor_usuario text, texto text,
             da_conta boolean, quando timestamptz)
    ON CONFLICT (comentario_id) DO NOTHING
    RETURNING id, da_conta, pai_id, data_criacao`;
  return { novos: novos.length };
}

// ── Contagens do /chat ──────────────────────────────────────────────────────
//
// Sem a tabela (deploy antes da migration), o chat segue sem os comentários
// em vez de cair: as duas leituras abaixo devolvem vazio e registram no log.

/** Comentários de terceiros não lidos, por conta. */
export async function naoLidosPorConta(): Promise<Map<string, number>> {
  try {
    const linhas = await sql`
      SELECT conta_id, count(*)::int AS n FROM instagram_comentarios
       WHERE NOT da_conta AND lido_em IS NULL
       GROUP BY conta_id`;
    return new Map(linhas.map((l) => [l.conta_id as string, l.n as number]));
  } catch (e) {
    console.error("[instagram] não li os comentários não lidos:", motivo(e));
    return new Map();
  }
}

/** O pedaço dos comentários na assinatura do /api/chat/versao: o último registro e os não lidos. */
export async function assinaturaDosComentarios(): Promise<string> {
  try {
    const [r] = await sql`
      SELECT coalesce(to_char(max(data_registro), 'YYYYMMDDHH24MISSUS'), '')
               || ':' || (SELECT count(*) FROM instagram_comentarios WHERE NOT da_conta AND lido_em IS NULL) AS v
        FROM instagram_comentarios`;
    return (r?.v as string) ?? "";
  } catch (e) {
    console.error("[instagram] não li a assinatura dos comentários:", motivo(e));
    return "";
  }
}
