// Leituras do módulo Formulários Meta. A configuração de cada formulário mora
// nas tabelas de webhook (lib/meta-leads.ts explica por quê): aqui ela é lida
// já no formato da tela — o que cada pergunta vira, a etapa, o segmento.
import "server-only";
import { sql } from "@/lib/db";
import type { DestinoCampo } from "@/lib/webhooks";
import { formularioDoSlug, PREFIXO_FORMULARIO, slugDoFormulario } from "@/lib/meta-leads";

/** O que a lista mostra de cada formulário configurado. */
export type ResumoDaConfig = {
  ativo: boolean;
  criarOportunidade: boolean;
  funil: string | null;
  etapa: string | null;
  segmento: string | null;
  /** Leads que entraram nos últimos 7 dias. */
  recebidos7d: number;
};

export async function resumoDasConfigs(): Promise<Record<string, ResumoDaConfig>> {
  const linhas = await sql`
    SELECT w.slug, w.ativo,
           COALESCE(a.criar_oportunidade, false) AS criar_oportunidade,
           f.nome AS funil, e.nome AS etapa,
           (SELECT s.nome FROM webhook_acoes x JOIN segmentos s ON s.id = x.segmento_id
             WHERE x.webhook_id = w.id AND x.tipo = 'adicionar_segmento' LIMIT 1) AS segmento,
           (SELECT count(*)::int FROM webhook_recebimentos r
             WHERE r.webhook_id = w.id AND r.estado = 'ok'
               AND r.data_criacao > now() - interval '7 days') AS recebidos_7d
      FROM webhooks w
      LEFT JOIN webhook_acoes a ON a.webhook_id = w.id AND a.tipo = 'criar_lead'
      LEFT JOIN funis f ON f.id = a.funil_id
      LEFT JOIN etapas e ON e.id = a.etapa_id
     WHERE w.slug LIKE ${PREFIXO_FORMULARIO + "%"}`;
  const resumo: Record<string, ResumoDaConfig> = {};
  for (const l of linhas) {
    const formId = formularioDoSlug(l.slug as string);
    if (!formId) continue;
    resumo[formId] = {
      ativo: l.ativo as boolean,
      criarOportunidade: l.criar_oportunidade as boolean,
      funil: (l.funil as string | null) ?? null,
      etapa: (l.etapa as string | null) ?? null,
      segmento: (l.segmento as string | null) ?? null,
      recebidos7d: l.recebidos_7d as number,
    };
  }
  return resumo;
}

export type ConfigDoFormulario = {
  webhookId: string;
  ativo: boolean;
  /** As perguntas com destino declarado. A que não está aqui é "só guardar na ficha". */
  campos: Array<{ chave: string; destino: DestinoCampo; destinoChave: string | null }>;
  criarOportunidade: boolean;
  funilId: string | null;
  etapaId: string | null;
  responsavelId: string | null;
  responsavelAlternadoId: string | null;
  segmentoId: string | null;
  recebidos: { total: number; ok: number; falhas: number; ultimo: string | null };
  recentes: Array<{
    id: string;
    estado: "ok" | "recusado" | "erro";
    resumo: string | null;
    erro: string | null;
    contatoId: string | null;
    contatoNome: string | null;
    quando: string;
  }>;
};

export async function configDoFormulario(formId: string): Promise<ConfigDoFormulario | null> {
  const [w] = await sql`SELECT id, ativo FROM webhooks WHERE slug = ${slugDoFormulario(formId)}`;
  if (!w) return null;
  const id = w.id as string;

  const [campos, acoes, totais, recentes] = await Promise.all([
    sql`SELECT chave, destino, destino_chave FROM webhook_campos WHERE webhook_id = ${id} ORDER BY ordem, chave`,
    sql`
      SELECT tipo, criar_oportunidade, funil_id, etapa_id, responsavel_id,
             responsavel_alternado_id, segmento_id
        FROM webhook_acoes WHERE webhook_id = ${id}`,
    sql`
      SELECT count(*)::int AS total,
             COALESCE(SUM((estado = 'ok')::int), 0)::int AS ok,
             COALESCE(SUM((estado <> 'ok')::int), 0)::int AS falhas,
             to_char(max(data_criacao) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ultimo
        FROM webhook_recebimentos WHERE webhook_id = ${id}`,
    sql`
      SELECT r.id, r.estado, r.resumo, r.erro, r.contato_id, c.nome AS contato_nome,
             to_char(r.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS quando
        FROM webhook_recebimentos r
        LEFT JOIN contatos c ON c.id = r.contato_id
       WHERE r.webhook_id = ${id}
       ORDER BY r.data_criacao DESC LIMIT 20`,
  ]);

  const criar = acoes.find((a) => a.tipo === "criar_lead");
  const segmento = acoes.find((a) => a.tipo === "adicionar_segmento");
  const t = totais[0];

  return {
    webhookId: id,
    ativo: w.ativo as boolean,
    campos: campos.map((c) => ({
      chave: c.chave as string,
      destino: c.destino as DestinoCampo,
      destinoChave: (c.destino_chave as string | null) ?? null,
    })),
    criarOportunidade: Boolean(criar?.criar_oportunidade),
    funilId: (criar?.funil_id as string | null) ?? null,
    etapaId: (criar?.etapa_id as string | null) ?? null,
    responsavelId: (criar?.responsavel_id as string | null) ?? null,
    responsavelAlternadoId: (criar?.responsavel_alternado_id as string | null) ?? null,
    segmentoId: (segmento?.segmento_id as string | null) ?? null,
    recebidos: {
      total: t.total as number,
      ok: t.ok as number,
      falhas: t.falhas as number,
      ultimo: (t.ultimo as string | null) ?? null,
    },
    recentes: recentes.map((r) => ({
      id: r.id as string,
      estado: r.estado as "ok" | "recusado" | "erro",
      resumo: (r.resumo as string | null) ?? null,
      erro: (r.erro as string | null) ?? null,
      contatoId: (r.contato_id as string | null) ?? null,
      contatoNome: (r.contato_nome as string | null) ?? null,
      quando: r.quando as string,
    })),
  };
}
