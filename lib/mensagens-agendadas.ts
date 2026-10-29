// MENSAGENS AGENDADAS nos grupos do WhatsApp (2026-10-29, pedido dele: "dentro
// de um grupo tenha um botão de mensagens agendadas. ali defino dia e hora que
// uma mensagem vai ser mandada nesse grupo"). Texto ou arquivo da biblioteca.
//
// Guardadas em mensagens_agendadas; quem manda é a rodada de cada minuto
// (enviarAgendadasVencidas), chamada pelo n8n em /api/chat/agendadas/enviar
// (lib/mensagens-agendadas-agendador.ts). O envio é o mesmo do chat
// (lib/conversa-envio.ts), em nome de quem agendou.
//
// SEM ENVIO DUPLICADO: a rodada reserva as vencidas ('enviando', com
// FOR UPDATE SKIP LOCKED) antes de mandar, então duas rodadas ao mesmo tempo não
// pegam a mesma. Reservada há mais de 10 minutos sem terminar (a função caiu no
// meio) vira erro e não é reenviada: pode ter saído, e repetir no grupo é pior
// que avisar.
import "server-only";
import { sql } from "@/lib/db";
import { comCaminho } from "@/lib/documentos";
import { enviarDocumentoNaConversa, enviarTextoNaConversa } from "@/lib/conversa-envio";
import { Recusa } from "@/lib/resultado-acao";
import { ehUuid } from "@/lib/validacao";

/** Uma mensagem agendada como a tela mostra. */
export type MensagemAgendada = {
  id: string;
  texto: string;
  documento: { id: string; nome: string; tipo: string } | null;
  enviarEm: string;
  estado: "agendada" | "enviando" | "enviada" | "erro" | "cancelada";
  erro: string | null;
  autor: string | null;
};

export const LIMITE_AGENDADA = {
  /** Texto sozinho: o limite do WhatsApp. */
  texto: 4096,
  /** Com arquivo, o texto é a legenda. */
  legenda: 1024,
  /** Até quando dá para agendar. */
  dias: 365,
};

const LOTE = 20;

/**
 * Agenda uma mensagem na conversa de GRUPO `atendimentoId`. Recusa (Recusa,
 * dentro de comoResultado) o que não serve: conversa que não é de grupo, hora
 * passada ou longe demais, texto vazio ou comprido, arquivo que não está na
 * biblioteca.
 */
export async function agendarMensagem(e: {
  atendimentoId: string;
  texto: string;
  documentoId: string | null;
  enviarEm: string;
  usuarioId: string;
}): Promise<{ id: string }> {
  if (!ehUuid(e.atendimentoId)) throw new Recusa("Conversa inválida.");
  const texto = e.texto.trim();
  const documentoId = e.documentoId && e.documentoId.trim() ? e.documentoId.trim() : null;
  if (!texto && !documentoId) throw new Recusa("Escreva a mensagem ou escolha um arquivo.");
  if (documentoId && texto.length > LIMITE_AGENDADA.legenda)
    throw new Recusa(`Com arquivo, o texto vai como legenda e tem até ${LIMITE_AGENDADA.legenda.toLocaleString("pt-BR")} caracteres.`);
  if (texto.length > LIMITE_AGENDADA.texto)
    throw new Recusa(`A mensagem passa de ${LIMITE_AGENDADA.texto.toLocaleString("pt-BR")} caracteres, o limite do WhatsApp.`);

  const quando = new Date(e.enviarEm);
  if (Number.isNaN(quando.getTime())) throw new Recusa("Escolha o dia e a hora do envio.");
  if (quando.getTime() < Date.now() + 30_000) throw new Recusa("Escolha um horário no futuro.");
  if (quando.getTime() > Date.now() + LIMITE_AGENDADA.dias * 86_400_000) throw new Recusa("Agende para até um ano a partir de hoje.");

  const [conversa] = await sql`SELECT grupo_id, canal FROM atendimentos WHERE id = ${e.atendimentoId}`;
  if (!conversa) throw new Recusa("Conversa não encontrada.");
  if (!conversa.grupo_id || conversa.canal !== "whatsapp") throw new Recusa("Mensagem agendada é só para grupo do WhatsApp.");

  if (documentoId) {
    const doc = ehUuid(documentoId) ? await comCaminho(documentoId) : null;
    if (!doc) throw new Recusa("O arquivo não está na biblioteca.");
    if (doc.arquivado) throw new Recusa("O arquivo foi arquivado na biblioteca.");
  }

  const [nova] = await sql`
    INSERT INTO mensagens_agendadas (atendimento_id, texto, documento_id, enviar_em, criado_por)
    VALUES (${e.atendimentoId}, ${texto}, ${documentoId}, ${quando}, ${e.usuarioId})
    RETURNING id`;
  return { id: nova.id as string };
}

/** Tira da fila a que ainda não saiu. false = já tinha saído, ou não existe. */
export async function cancelarAgendada(id: string): Promise<boolean> {
  if (!ehUuid(id)) return false;
  const feitas = await sql`UPDATE mensagens_agendadas SET estado = 'cancelada' WHERE id = ${id} AND estado = 'agendada' RETURNING id`;
  return feitas.length > 0;
}

/** As da conversa: as que vão sair, pela hora, e as 10 últimas que já terminaram. */
export async function agendadasDaConversa(atendimentoId: string): Promise<MensagemAgendada[]> {
  const linhas = await sql`
    (SELECT m.id, m.texto, m.estado, m.erro, m.enviar_em, d.id AS doc_id, d.nome AS doc_nome, d.tipo AS doc_tipo, u.nome AS autor
       FROM mensagens_agendadas m
       LEFT JOIN documentos d ON d.id = m.documento_id
       LEFT JOIN usuarios u ON u.id = m.criado_por
      WHERE m.atendimento_id = ${atendimentoId} AND m.estado IN ('agendada', 'enviando')
      ORDER BY m.enviar_em)
    UNION ALL
    (SELECT m.id, m.texto, m.estado, m.erro, m.enviar_em, d.id, d.nome, d.tipo, u.nome
       FROM mensagens_agendadas m
       LEFT JOIN documentos d ON d.id = m.documento_id
       LEFT JOIN usuarios u ON u.id = m.criado_por
      WHERE m.atendimento_id = ${atendimentoId} AND m.estado IN ('enviada', 'erro', 'cancelada')
      ORDER BY m.enviar_em DESC
      LIMIT 10)`;
  return linhas.map((l) => ({
    id: l.id as string,
    texto: l.texto as string,
    documento: l.doc_id ? { id: l.doc_id as string, nome: l.doc_nome as string, tipo: l.doc_tipo as string } : null,
    enviarEm: new Date(l.enviar_em as string).toISOString(),
    estado: l.estado as MensagemAgendada["estado"],
    erro: (l.erro as string | null) ?? null,
    autor: (l.autor as string | null) ?? null,
  }));
}

/**
 * A rodada: manda as que venceram, em lotes de 20, e devolve quantas saíram e
 * quantas deram erro. Uma rodada sem nada vencido é uma consulta no índice da fila.
 */
export async function enviarAgendadasVencidas(): Promise<{ enviadas: number; erros: number; presas: number }> {
  const presas = await sql`
    UPDATE mensagens_agendadas
       SET estado = 'erro',
           erro = 'O envio foi interrompido no meio. Confira no grupo se a mensagem saiu e agende de novo se precisar.'
     WHERE estado = 'enviando' AND enviada_em < now() - interval '10 minutes'
    RETURNING id`;

  const lote = await sql`
    UPDATE mensagens_agendadas
       SET estado = 'enviando', enviada_em = now()
     WHERE id IN (
       SELECT id FROM mensagens_agendadas
        WHERE estado = 'agendada' AND enviar_em <= now()
        ORDER BY enviar_em
        LIMIT ${LOTE}
          FOR UPDATE SKIP LOCKED)
    RETURNING id, atendimento_id, texto, documento_id, criado_por`;

  let enviadas = 0;
  let erros = 0;
  for (const m of lote) {
    const base = { atendimentoId: m.atendimento_id as string, autorId: (m.criado_por as string | null) ?? null };
    let r: { erro?: string; mensagemId?: string };
    if (!m.documento_id && !(m.texto as string).trim()) {
      r = { erro: "O arquivo foi apagado da biblioteca e a mensagem ficou vazia." };
    } else {
      try {
        r = m.documento_id
          ? await enviarDocumentoNaConversa({ ...base, documentoId: m.documento_id as string, legenda: m.texto as string, enviadaPor: "crm" })
          : await enviarTextoNaConversa({ ...base, texto: m.texto as string, enviadaPor: "crm" });
      } catch (e) {
        r = { erro: e instanceof Error ? e.message : String(e) };
      }
    }
    await sql`
      UPDATE mensagens_agendadas
         SET estado = ${r.erro ? "erro" : "enviada"}, erro = ${r.erro?.slice(0, 500) ?? null}, mensagem_id = ${r.mensagemId ?? null}
       WHERE id = ${m.id}`;
    if (r.erro) erros++;
    else enviadas++;
  }
  return { enviadas, erros, presas: presas.length };
}
