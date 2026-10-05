// Os números do gráfico "Atendimentos de IA e reuniões" do dashboard (pedido
// dele, 2026-10-05): por dia, nos últimos DIAS_GRAFICO_IA dias, quantas
// conversas a IA atendeu e quantas reuniões foram marcadas.
//
// ATENDIMENTO DE IA = conversa com pelo menos uma mensagem da IA naquele dia
// (enviada_por = 'ia'). Conta a conversa uma vez por dia, não cada mensagem: a
// IA quebra a resposta em até três (lib/ia/atendente.ts, emPartes).
//
// REUNIÃO = linha de agenda_reunioes, pelo dia em que foi MARCADA, não pelo
// dia em que acontece: é o resultado do atendimento daquele dia. Conta as da
// IA e as marcadas pela ficha; quantas foram da IA vai à parte (autor_id
// nulo). Cancelada no Google continua contando — o cancelamento só existe lá.
//
// Dia no horário de Brasília: o servidor (e o banco) estão em UTC, e uma
// mensagem das 22h cairia no dia seguinte.
import "server-only";
import { sql } from "@/lib/db";

export const DIAS_GRAFICO_IA = 30;

export type DiaIa = {
  /** 'YYYY-MM-DD', em Brasília. */
  dia: string;
  atendimentos: number;
  reunioes: number;
  /** Das reuniões do dia, quantas a IA marcou. */
  reunioesIa: number;
};

/**
 * Um item por dia, do mais antigo para hoje, com zero nos dias sem nada — o
 * gráfico não pode pular dia. `soMinhas` é o escopo 'proprio' do departamento
 * (app/page.tsx): só conversas e reuniões de contatos com oportunidade da
 * pessoa, o mesmo corte do quadro.
 */
export async function carregarAtendimentosIa(soMinhas: string | null): Promise<DiaIa[]> {
  const linhas = await sql`
    WITH dias AS (
      SELECT generate_series(
               (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${DIAS_GRAFICO_IA - 1}::int,
               (now() AT TIME ZONE 'America/Sao_Paulo')::date,
               interval '1 day')::date AS dia
    ),
    ia AS (
      SELECT (m.data_criacao AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
             count(DISTINCT m.atendimento_id)::int AS n
        FROM mensagens m
        JOIN atendimentos a ON a.id = m.atendimento_id
       WHERE m.enviada_por = 'ia'
         AND m.data_criacao >= now() - make_interval(days => ${DIAS_GRAFICO_IA + 1})
         AND (${soMinhas}::uuid IS NULL OR EXISTS (
               SELECT 1 FROM oportunidades o
                WHERE o.contato_id = a.contato_id AND o.responsavel_id = ${soMinhas}::uuid))
       GROUP BY 1
    ),
    reunioes AS (
      SELECT (r.data_criacao AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
             count(*)::int AS n,
             count(*) FILTER (WHERE r.autor_id IS NULL)::int AS n_ia
        FROM agenda_reunioes r
        LEFT JOIN oportunidades o ON o.id = r.oportunidade_id
       WHERE r.data_criacao >= now() - make_interval(days => ${DIAS_GRAFICO_IA + 1})
         AND (${soMinhas}::uuid IS NULL OR o.responsavel_id = ${soMinhas}::uuid)
       GROUP BY 1
    )
    SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
           coalesce(ia.n, 0) AS atendimentos,
           coalesce(reunioes.n, 0) AS reunioes,
           coalesce(reunioes.n_ia, 0) AS reunioes_ia
      FROM dias d
      LEFT JOIN ia USING (dia)
      LEFT JOIN reunioes USING (dia)
     ORDER BY d.dia`;
  return linhas.map((l) => ({
    dia: l.dia as string,
    atendimentos: Number(l.atendimentos),
    reunioes: Number(l.reunioes),
    reunioesIa: Number(l.reunioes_ia),
  }));
}
