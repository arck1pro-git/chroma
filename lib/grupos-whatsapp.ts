// Os GRUPOS do WhatsApp Web no chat (2026-10-29, pedido dele: "captar quando
// for um grupo [...] os grupos vão aparecer destacados e com possibilidade de
// fixar no chat"). Até aqui o webhook da uazapi descartava toda mensagem de
// grupo (@g.us).
//
// O grupo tem tabela própria (grupos_whatsapp, decisão dele) e a conversa dele
// é um atendimento com grupo_id no lugar de contato_id: o chat lista e mostra
// como qualquer conversa, mas nada que é do CONTATO o alcança — IA, cadência,
// campanha, funil, MCP e métricas leem atendimentos com JOIN contatos e não
// veem grupo. Quem falou fica em mensagens.remetente_nome.
//
// O nome do grupo vem do evento (chat.name) e, quando não vem, de
// POST /group/info (completarGrupo, depois da resposta ao webhook).
import "server-only";
import { sql } from "@/lib/db";
import { soDigitos } from "@/lib/telefone";
import { infoDoGrupo } from "@/lib/uazapi";

export const ehJidDeGrupo = (jid: string | null | undefined) => /@g\.us$/i.test(jid ?? "");

/**
 * Um nome que a uazapi mandou serve como nome do grupo? Vazio, o próprio jid
 * ou só dígitos (o fallback dela quando não sabe o nome) não servem.
 */
export function nomeValido(nome: unknown, jid: string): string {
  const n = typeof nome === "string" ? nome.trim() : "";
  if (!n || n.toLowerCase() === jid.toLowerCase() || /^[\d\s+@.-]+$/.test(n)) return "";
  return n.slice(0, 200);
}

/**
 * Quem mandou a mensagem no grupo: o nome que a pessoa usa no WhatsApp, ou o
 * fim do número dela quando ele não vem. null no que saiu do nosso número.
 */
export function remetenteDoGrupo(ev: { fromMe?: unknown; senderName?: unknown; pushName?: unknown; sender_pn?: unknown; sender?: unknown }): string | null {
  if (ev.fromMe === true) return null;
  const nome = [ev.senderName, ev.pushName].find((n) => typeof n === "string" && n.trim());
  if (typeof nome === "string") return nome.trim().slice(0, 120);
  const numero = soDigitos(String(ev.sender_pn ?? ev.sender ?? ""));
  return numero ? `…${numero.slice(-4)}` : "Participante";
}

/**
 * A conversa do grupo `jid` no número nosso `numeroInstancia`: acha ou cria o
 * grupo e a conversa, numa ida cada. Conversa encerrada volta para a fila,
 * como a do contato. Devolve o id da conversa e se o grupo ainda está sem nome
 * (quem chama completa depois da resposta).
 */
export async function conversaDoGrupo(e: {
  jid: string;
  nome: string;
  foto: string | null;
  numeroInstancia: string | null;
}): Promise<{ atendimentoId: string; grupoId: string; semNome: boolean }> {
  const jid = e.jid.toLowerCase();
  // Nome que chegou atualiza (o grupo pode ter sido renomeado); vazio não apaga o que havia.
  const [g] = await sql`
    INSERT INTO grupos_whatsapp (jid, nome, foto_url)
    VALUES (${jid}, ${e.nome}, ${e.foto})
    ON CONFLICT (jid) DO UPDATE
      SET nome = CASE WHEN EXCLUDED.nome <> '' THEN EXCLUDED.nome ELSE grupos_whatsapp.nome END,
          foto_url = COALESCE(EXCLUDED.foto_url, grupos_whatsapp.foto_url)
    RETURNING id, nome`;
  const [at] = await sql`
    INSERT INTO atendimentos (grupo_id, status, canal, numero_instancia)
    VALUES (${g.id}, 'na_fila', 'whatsapp', ${e.numeroInstancia})
    ON CONFLICT (grupo_id, numero_instancia) WHERE grupo_id IS NOT NULL DO UPDATE
      SET status = CASE WHEN atendimentos.status = 'encerrado' THEN 'na_fila' ELSE atendimentos.status END,
          data_atualizacao = now()
    RETURNING id`;
  return { atendimentoId: at.id as string, grupoId: g.id as string, semNome: !g.nome };
}

/**
 * Busca na uazapi o nome e a foto do grupo que chegou sem nome. Falha só vai
 * para o log: o grupo aparece pelo fim do id até a próxima mensagem tentar de novo.
 */
export async function completarGrupo(grupoId: string, jid: string, numeroInstancia: string | null): Promise<void> {
  if (!numeroInstancia) return;
  try {
    const info = await infoDoGrupo(numeroInstancia, jid);
    const nome = nomeValido(info.nome, jid);
    if (!nome && !info.foto) return;
    await sql`
      UPDATE grupos_whatsapp
         SET nome = CASE WHEN ${nome} <> '' THEN ${nome} ELSE nome END,
             foto_url = COALESCE(${info.foto}, foto_url)
       WHERE id = ${grupoId}`;
  } catch (e) {
    console.error("[grupos] não li o grupo na uazapi:", e instanceof Error ? e.message : e);
  }
}
