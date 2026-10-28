// A CAMPANHA como um todo no motor das campanhas em blocos
// (lib/campanhas-whatsapp.ts explica o motor inteiro): o template e o número
// dela, a inscrição dos contatos dos segmentos, a autoria (quem criou, ativou,
// pausou…) e pausar, editar e retomar. As rotas de app/api/meta/whatsapp/campanhas
// chamam daqui. Dividido do motor em 2026-10-28.
import "server-only";
import { listaUuid, sql } from "@/lib/db";
import { telefonesMeta } from "@/lib/meta";
import { ehUuid } from "@/lib/validacao";
import { ID_AGUARDAR_ANTIGO, primeiroTemplate, type FluxoCampanha, type ProblemaDoFluxo } from "@/lib/campanhas-fluxo";
import { fluxoGravado, lerDefinicao, travaDeIds, type Coluna } from "@/lib/campanhas-fluxo-entrada";
import { evento, type Detalhe } from "@/lib/campanhas-whatsapp-base";

// ── Definição ───────────────────────────────────────────────────────────────

/** O template das colunas da campanha (listas, ficha do contato): o primeiro pelo início, senão qualquer um do fluxo. */
export function templateDaCampanha(f: FluxoCampanha): { template_nome: string; template_idioma: string } {
  const primeiro = primeiroTemplate(f);
  if (primeiro) return primeiro;
  for (const b of Object.values(f.blocos)) {
    if (b.tipo === "enviar_template") return { template_nome: b.template_nome, template_idioma: b.template_idioma };
  }
  return { template_nome: "", template_idioma: "pt_BR" };
}

/**
 * O número que envia, conferido na conta: o id vem do navegador ou da IA e
 * entra no caminho da Graph. O nome exibido sai da Meta, não de quem pediu —
 * senão a tela mostraria um número e a campanha sairia por outro.
 */
export async function numeroDaConta(wabaId: string, telefoneId: string) {
  return (await telefonesMeta(wabaId)).find((t) => t.id === telefoneId) ?? null;
}

// ── Inscrição ───────────────────────────────────────────────────────────────

/**
 * Inscreve TODO contato com WhatsApp dos segmentos da campanha, numa instrução
 * (revisões de 2026-10-28: antes eram os 250 primeiros por nome, e ninguém
 * inscrevia o resto). Quem já tem execução nesta campanha fica de fora (UNIQUE
 * campanha+contato): serve à ativação e à retomada, que pega quem entrou no
 * segmento durante a pausa (o gatilho do banco só inscreve em campanha ativa).
 * Devolve quantos entraram agora.
 */
export async function inscreverDosSegmentos(db: typeof sql, campanhaId: string): Promise<number> {
  const novas = await db`
    INSERT INTO campanha_whatsapp_execucoes (campanha_id, contato_id)
    SELECT DISTINCT ${campanhaId}::uuid, c.id
      FROM campanha_whatsapp_segmentos cws
      JOIN contato_segmentos cs ON cs.segmento_id = cws.segmento_id
      JOIN contatos c ON c.id = cs.contato_id
     WHERE cws.campanha_id = ${campanhaId}::uuid AND c.whatsapp IS NOT NULL
    ON CONFLICT (campanha_id, contato_id) DO NOTHING
    RETURNING 1`;
  return novas.length;
}

/** Quantos contatos com WhatsApp há nos segmentos: os da campanha, ou os escolhidos antes de ela existir. */
export async function contatosNosSegmentos(de: { campanhaId: string } | { segmentoIds: string[] }): Promise<number> {
  const [r] =
    "campanhaId" in de
      ? await sql`
          SELECT count(DISTINCT c.id)::int AS n FROM campanha_whatsapp_segmentos cws
            JOIN contato_segmentos cs ON cs.segmento_id = cws.segmento_id
            JOIN contatos c ON c.id = cs.contato_id
           WHERE cws.campanha_id = ${de.campanhaId}::uuid AND c.whatsapp IS NOT NULL`
      : await sql`
          SELECT count(DISTINCT c.id)::int AS n FROM contato_segmentos cs
            JOIN contatos c ON c.id = cs.contato_id
           WHERE cs.segmento_id = ANY(string_to_array(${listaUuid(de.segmentoIds.filter(ehUuid))}, ',')::uuid[])
             AND c.whatsapp IS NOT NULL`;
  return (r?.n as number) ?? 0;
}

// ── Autoria ─────────────────────────────────────────────────────────────────

/** Quem criou, ativou, pausou, retomou ou editou: o motor roda sem sessão, a autoria fica aqui. */
export async function registrarNaCampanha(
  campanhaId: string,
  tipo: "campanha_criada" | "campanha_ativada" | "campanha_pausada" | "campanha_retomada" | "campanha_editada",
  usuarioId: string,
  extra: Detalhe = {},
) {
  await evento(campanhaId, null, tipo, { usuario: usuarioId, ...extra });
}

// ── Pausar, editar, retomar ─────────────────────────────────────────────────

/** Pausa sem mexer no n8n: o agendador segue chamando, e o motor não anda campanha que não está ativa. */
export async function pausarCampanha(id: string, usuarioId: string): Promise<boolean> {
  const [c] = await sql`UPDATE campanhas_whatsapp SET status = 'pausada' WHERE id = ${id}::uuid AND status = 'ativa' RETURNING id`;
  if (c) await registrarNaCampanha(id, "campanha_pausada", usuarioId);
  return !!c;
}

/**
 * Quem está num bloco que o fluxo não tem mais (ou aguardando num bloco que
 * deixou de ser "Aguardar resposta") termina como 'concluida', com evento. As
 * execuções antigas ganham antes o bloco pelo estado, para a conta valer para
 * elas também. Rodando agora ('enviando') fica de fora: a rodada estaciona e
 * esta conferência pega na próxima vez.
 */
async function concluirForaDoFluxo(tx: typeof sql, campanhaId: string, f: FluxoCampanha): Promise<number> {
  const blocos = Object.keys(f.blocos);
  const aguardar = blocos.filter((id) => f.blocos[id].tipo === "aguardar_resposta");
  await tx`
    UPDATE campanha_whatsapp_execucoes SET bloco_atual = ${ID_AGUARDAR_ANTIGO}
     WHERE campanha_id = ${campanhaId}::uuid AND bloco_atual IS NULL AND estado = 'aguardando_resposta'`;
  const fora = await tx`
    WITH fora AS (
      UPDATE campanha_whatsapp_execucoes e
         SET estado = 'concluida', prazo_resposta = NULL, finalizado_em = now()
       WHERE e.campanha_id = ${campanhaId}::uuid
         AND e.estado IN ('aguardando_resposta', 'em_andamento') AND e.bloco_atual IS NOT NULL
         AND (NOT (e.bloco_atual = ANY(string_to_array(${blocos.join(",")}, ',')))
           OR (e.estado = 'aguardando_resposta' AND NOT (e.bloco_atual = ANY(string_to_array(${aguardar.join(",")}, ',')))))
      RETURNING e.id, e.bloco_atual)
    INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
    SELECT ${campanhaId}::uuid, fora.id, 'bloco_removido', jsonb_build_object('bloco', fora.bloco_atual) FROM fora
    RETURNING id`;
  return fora.length;
}

/**
 * Grava o fluxo editado de uma campanha PAUSADA ou RASCUNHO (null = não está
 * em nenhum dos dois). Tudo numa transação: a definição nova e quem saiu do
 * fluxo por estar num bloco apagado.
 *
 * TRAVA DE ID (revisões de 2026-10-28): bloco que já existe na definição
 * gravada não muda de tipo, e id que já rodou e foi apagado não volta
 * (travaDeIds, lib/campanhas-fluxo-entrada.ts); devolve os `problemas` e não
 * grava. Aqui, e não só na rota, porque a linha fica travada (FOR UPDATE) entre
 * a comparação e a gravação: a definição conferida é a que é substituída,
 * venha a edição da tela, da IA do construtor ou de um PUT à mão.
 */
export async function salvarEdicao(e: {
  campanhaId: string;
  nome: string | null;
  fluxo: FluxoCampanha;
  usuarioId: string;
}): Promise<{ concluidas: number } | { problemas: ProblemaDoFluxo[] } | null> {
  const tpl = templateDaCampanha(e.fluxo);
  return sql.begin(async (tx: typeof sql) => {
    const [atual] = (await tx`
      SELECT status, definicao, template_nome, template_idioma FROM campanhas_whatsapp
       WHERE id = ${e.campanhaId}::uuid AND status IN ('pausada', 'rascunho')
         FOR UPDATE`) as unknown as Array<Coluna & { status: string; definicao: unknown }>;
    if (!atual) return null;
    const problemas = await travaDeIds(tx, e.campanhaId, fluxoGravado(atual), e.fluxo);
    if (problemas.length) return { problemas };
    const [c] = await tx`
      UPDATE campanhas_whatsapp
         SET definicao = ${sql.json(e.fluxo as never)},
             nome = COALESCE(${e.nome}::text, nome),
             template_nome = COALESCE(nullif(${tpl.template_nome}, ''), template_nome),
             template_idioma = COALESCE(nullif(${tpl.template_idioma}, ''), template_idioma)
       WHERE id = ${e.campanhaId}::uuid AND status IN ('pausada', 'rascunho')
      RETURNING id`;
    if (!c) return null;
    const concluidas = await concluirForaDoFluxo(tx, e.campanhaId, e.fluxo);
    await tx`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
             VALUES (${e.campanhaId}::uuid, NULL, 'campanha_editada', ${sql.json({ usuario: e.usuarioId, concluidas } as never)})`;
    return { concluidas };
  });
}

/** JSON com as chaves em ordem: o jsonb reordena as chaves, e comparar definições não pode depender disso. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Volta a campanha pausada para 'ativa' (quem chama já revalidou `fluxo`).
 * Na mesma transação, com a linha travada: confere que a definição gravada é
 * a que foi conferida (outra aba pode ter salvo no meio: 'mudou', e quem chama
 * confere de novo), conclui quem ficou fora do fluxo e inscreve quem entrou nos
 * segmentos durante a pausa (o gatilho só inscreve em campanha ativa).
 */
export async function retomarCampanha(
  id: string,
  fluxo: FluxoCampanha,
  usuarioId: string,
): Promise<{ estado: "retomada"; inscritas: number } | { estado: "nao_pausada" } | { estado: "mudou" }> {
  return sql.begin(async (tx: typeof sql) => {
    const [atual] = (await tx`
      SELECT status, definicao, template_nome, template_idioma FROM campanhas_whatsapp
       WHERE id = ${id}::uuid AND status = 'pausada'
         FOR UPDATE`) as unknown as Array<Coluna & { status: string; definicao: unknown }>;
    if (!atual) return { estado: "nao_pausada" as const };
    if (canonico(lerDefinicao(atual.definicao, atual)) !== canonico(fluxo)) return { estado: "mudou" as const };
    await tx`UPDATE campanhas_whatsapp SET status = 'ativa' WHERE id = ${id}::uuid`;
    const concluidas = await concluirForaDoFluxo(tx, id, fluxo);
    const inscritas = await inscreverDosSegmentos(tx, id);
    await tx`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
             VALUES (${id}::uuid, NULL, 'campanha_retomada', ${sql.json({ usuario: usuarioId, concluidas, inscritas } as never)})`;
    return { estado: "retomada" as const, inscritas };
  });
}
