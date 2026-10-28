// Os NÚMEROS do motor das campanhas em blocos (lib/campanhas-whatsapp.ts
// explica o motor inteiro): os totais gravados na campanha a cada rodada e as
// métricas do canvas (quantos estão em cada bloco, quantos passaram, quantos
// saíram por cada saída). O gasto e o funil da campanha são de
// lib/campanhas-metricas.ts. Dividido do motor em 2026-10-28.
import "server-only";
import { listaUuid, sql } from "@/lib/db";
import { ID_AGUARDAR_ANTIGO, ID_ENVIO_ANTIGO, type FluxoCampanha } from "@/lib/campanhas-fluxo";

export async function atualizarTotais() {
  await sql`UPDATE campanhas_whatsapp c SET
    enviados=(SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.enviado_em IS NOT NULL),
    total=(SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id),
    status=c.status,
    data_conclusao=c.data_conclusao
    WHERE c.status IN ('ativa','processando')`;
}

export type MetricasDoFluxo = {
  /** Por bloco: quantos estão nele agora e quantos já passaram por ele. */
  porBloco: Record<string, { agora: number; passaram: number }>;
  /** Por `${blocoId}|${saidaId}`: quantos saíram por ali. */
  porSaida: Record<string, number>;
};

/**
 * Pelos eventos 'bloco' e pelo bloco_atual. Campanha do formato antigo conta
 * também os eventos de antes (mensagem_enviada, resposta_recebida,
 * prazo_expirado) nos blocos da conversão: senão o canvas dela abriria zerado.
 */
export async function metricasDasCampanhas(campanhas: Array<{ id: string; definicao: FluxoCampanha }>): Promise<Map<string, MetricasDoFluxo>> {
  const saida = new Map<string, MetricasDoFluxo>();
  if (!campanhas.length) return saida;
  const ids = listaUuid(campanhas.map((c) => c.id));
  const [agora, passaram, saidas] = (await Promise.all([
    sql`SELECT campanha_id::text, estado, bloco_atual, count(*)::int AS n
          FROM campanha_whatsapp_execucoes
         WHERE campanha_id = ANY(string_to_array(${ids}, ',')::uuid[])
           AND estado IN ('na_fila', 'enviando', 'aguardando_resposta', 'em_andamento')
         GROUP BY 1, 2, 3`,
    sql`SELECT campanha_id::text, bloco, count(DISTINCT execucao_id)::int AS n FROM (
          SELECT campanha_id, execucao_id,
                 CASE tipo WHEN 'bloco' THEN detalhe->>'bloco' WHEN 'mensagem_enviada' THEN ${ID_ENVIO_ANTIGO} END AS bloco
            FROM campanha_whatsapp_eventos
           WHERE campanha_id = ANY(string_to_array(${ids}, ',')::uuid[]) AND tipo IN ('bloco', 'mensagem_enviada')
          UNION ALL
          SELECT campanha_id, execucao_id, ${ID_AGUARDAR_ANTIGO}
            FROM campanha_whatsapp_eventos
           WHERE campanha_id = ANY(string_to_array(${ids}, ',')::uuid[]) AND tipo = 'mensagem_enviada'
        ) x WHERE bloco IS NOT NULL GROUP BY 1, 2`,
    sql`SELECT campanha_id::text, bloco, saida, count(*)::int AS n FROM (
          SELECT campanha_id,
                 CASE tipo WHEN 'bloco' THEN detalhe->>'bloco' WHEN 'mensagem_enviada' THEN ${ID_ENVIO_ANTIGO} ELSE ${ID_AGUARDAR_ANTIGO} END AS bloco,
                 CASE tipo WHEN 'bloco' THEN detalhe->>'saida' WHEN 'mensagem_enviada' THEN 'proximo'
                           WHEN 'resposta_recebida' THEN 'outra' ELSE 'sem_resposta' END AS saida
            FROM campanha_whatsapp_eventos
           WHERE campanha_id = ANY(string_to_array(${ids}, ',')::uuid[])
             AND tipo IN ('bloco', 'mensagem_enviada', 'resposta_recebida', 'prazo_expirado')
        ) x WHERE bloco IS NOT NULL AND saida IS NOT NULL GROUP BY 1, 2, 3`,
  ])) as [
    Array<{ campanha_id: string; estado: string; bloco_atual: string | null; n: number }>,
    Array<{ campanha_id: string; bloco: string; n: number }>,
    Array<{ campanha_id: string; bloco: string; saida: string; n: number }>,
  ];
  for (const c of campanhas) {
    const porBloco = new Map<string, { agora: number; passaram: number }>();
    const no = (bloco: string) => porBloco.get(bloco) ?? porBloco.set(bloco, { agora: 0, passaram: 0 }).get(bloco)!;
    for (const l of agora.filter((x) => x.campanha_id === c.id)) {
      // Execução antiga sem bloco_atual conta pelo estado; a da fila, no primeiro bloco.
      const bloco =
        l.bloco_atual ??
        (l.estado === "aguardando_resposta" ? ID_AGUARDAR_ANTIGO : l.estado === "enviando" ? ID_ENVIO_ANTIGO : c.definicao.inicio);
      if (bloco) no(bloco).agora += l.n;
    }
    for (const l of passaram.filter((x) => x.campanha_id === c.id)) no(l.bloco).passaram += l.n;
    const porSaida = new Map<string, number>();
    for (const l of saidas.filter((x) => x.campanha_id === c.id)) {
      const chave = `${l.bloco}|${l.saida}`;
      porSaida.set(chave, (porSaida.get(chave) ?? 0) + l.n);
    }
    // fromEntries define a chave como própria, mesmo um id estranho vindo de evento antigo.
    saida.set(c.id, { porBloco: Object.fromEntries(porBloco), porSaida: Object.fromEntries(porSaida) });
  }
  return saida;
}
