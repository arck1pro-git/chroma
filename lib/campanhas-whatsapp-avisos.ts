// Os AVISOS À EQUIPE do motor das campanhas em blocos (lib/campanhas-whatsapp.ts
// explica o motor inteiro): o bloco "Avisar a equipe" só enfileira
// ('aviso_pendente', lib/campanhas-whatsapp-acoes.ts) e a rodada do /processar
// manda aqui, juntos por instância e pessoa (lib/aviso-equipe-whatsapp.ts).
// Dividido do motor em 2026-10-28.
import "server-only";
import { sql } from "@/lib/db";
import { avisarEquipeNoWhatsApp, type LinhaDoAviso } from "@/lib/aviso-equipe-whatsapp";
import { MOTIVO_PRESA, RESERVA } from "@/lib/campanhas-whatsapp-base";

type AvisoReservado = {
  id: string;
  detalhe: { instanciaId?: unknown; usuarioIds?: unknown; texto?: unknown; atendimentoId?: unknown };
  nome: string | null;
};

/**
 * Os avisos enfileirados pelo bloco "Avisar a equipe", JUNTOS: uma chamada a
 * avisarEquipeNoWhatsApp por instância e pessoa, com todas as linhas dela. A
 * reserva troca o tipo do evento ('aviso_pendente' → 'aviso_enviando') numa
 * instrução, então duas rodadas nunca mandam o mesmo aviso; reservado há mais
 * de 15 min sem resultado vira 'aviso_falhou', sem reenvio. Só de campanha
 * ativa: pausada, o aviso espera a retomada.
 */
export async function enviarAvisosPendentes(limite = 200): Promise<{ avisos: number; mensagens: number; falhas: number }> {
  await sql`
    UPDATE campanha_whatsapp_eventos
       SET tipo = 'aviso_falhou', detalhe = detalhe || ${sql.json({ falhas: [MOTIVO_PRESA] } as never)}
     WHERE tipo = 'aviso_enviando' AND (detalhe->>'reservado_em')::timestamptz < now() - ${RESERVA}::interval`;
  const reservados = (await sql`
    UPDATE campanha_whatsapp_eventos ev
       SET tipo = 'aviso_enviando', detalhe = ev.detalhe || jsonb_build_object('reservado_em', now())
     WHERE ev.tipo = 'aviso_pendente'
       AND ev.id IN (SELECT p.id FROM campanha_whatsapp_eventos p
                       JOIN campanhas_whatsapp cw ON cw.id = p.campanha_id
                      WHERE p.tipo = 'aviso_pendente' AND cw.status = 'ativa'
                      ORDER BY p.id LIMIT ${limite})
    RETURNING ev.id::text AS id, ev.detalhe,
              (SELECT c.nome FROM campanha_whatsapp_execucoes x JOIN contatos c ON c.id = x.contato_id
                WHERE x.id = ev.execucao_id) AS nome`) as AvisoReservado[];
  if (!reservados.length) return { avisos: 0, mensagens: 0, falhas: 0 };

  // instância|pessoa → as linhas dela e os avisos de onde vieram.
  const grupos = new Map<string, { instanciaId: string; usuarioId: string; linhas: LinhaDoAviso[]; avisos: string[] }>();
  for (const a of reservados) {
    const instanciaId = typeof a.detalhe.instanciaId === "string" ? a.detalhe.instanciaId : "";
    const pessoas = Array.isArray(a.detalhe.usuarioIds) ? a.detalhe.usuarioIds.filter((u): u is string => typeof u === "string") : [];
    const linha: LinhaDoAviso = {
      texto: typeof a.detalhe.texto === "string" ? a.detalhe.texto : "",
      nome: a.nome,
      atendimentoId: typeof a.detalhe.atendimentoId === "string" ? a.detalhe.atendimentoId : null,
    };
    for (const usuarioId of pessoas) {
      const chave = `${instanciaId}|${usuarioId}`;
      const g = grupos.get(chave) ?? { instanciaId, usuarioId, linhas: [], avisos: [] };
      g.linhas.push(linha);
      g.avisos.push(a.id);
      grupos.set(chave, g);
    }
  }

  const resultado = new Map(reservados.map((a) => [a.id, { enviados: 0, falhas: [] as string[] }]));
  let mensagens = 0;
  for (const g of grupos.values()) {
    const r = await avisarEquipeNoWhatsApp({ instanciaId: g.instanciaId, usuarioIds: [g.usuarioId], linhas: g.linhas });
    mensagens += r.enviados;
    for (const id of g.avisos) {
      const x = resultado.get(id)!;
      x.enviados += r.enviados;
      x.falhas.push(...r.falhas);
    }
  }
  const linhas = [...resultado].map(([id, r]) => ({
    id,
    tipo: r.enviados > 0 ? "aviso_enviado" : "aviso_falhou",
    resultado: { enviados: r.enviados, falhas: [...new Set(r.falhas)].slice(0, 20) },
  }));
  await sql`
    UPDATE campanha_whatsapp_eventos ev SET tipo = x.tipo, detalhe = ev.detalhe || x.resultado
      FROM jsonb_to_recordset(${sql.json(linhas as never)}) AS x(id bigint, tipo text, resultado jsonb)
     WHERE ev.id = x.id AND ev.tipo = 'aviso_enviando'`;
  return { avisos: reservados.length, mensagens, falhas: linhas.filter((l) => l.tipo === "aviso_falhou").length };
}
