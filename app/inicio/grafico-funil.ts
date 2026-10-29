// Os números do gráfico do topo do quadro: por dia, nos últimos
// DIAS_GRAFICO_FUNIL dias, POR FUNIL, quantos leads entraram no funil, quantas
// reuniões a IA marcou e quantas a equipe marcou (pedido dele, 2026-10-29:
// "leads que entrou no funil x reuniões IA x reuniões humanas"). Até então
// (2026-10-21) eram os atendimentos da IA e as reuniões dela; antes ainda
// (2026-10-05), um número só para o CRM inteiro.
//
// LEADS QUE ENTRARAM = oportunidades criadas no funil naquele dia. É o mesmo
// "lead no funil" do quadro: o card que nasceu ali (captação, webhook, ficha,
// importação com a data original).
//
// REUNIÃO = linha de agenda_reunioes, pelo dia em que foi MARCADA, não pelo dia
// em que acontece: é o resultado do trabalho daquele dia. Sem autor = a IA
// marcou; com autor = alguém da equipe marcou pela ficha. Reunião marcada direto
// no Google, por fora do CRM, não está na tabela e não entra. O funil é o da
// oportunidade da reunião, ou, sem ela, o da oportunidade mais recente do
// contato criada até aquele dia (a mesma ligação pela data que a IA usa).
// Cancelada no Google continua contando — o cancelamento só existe lá.
//
// Dia no horário de Brasília: o servidor (e o banco) estão em UTC, e um card das
// 22h cairia no dia seguinte.
import "server-only";
import { sql } from "@/lib/db";

export const DIAS_GRAFICO_FUNIL = 30;

export type DiaDoFunil = {
  /** 'YYYY-MM-DD', em Brasília. */
  dia: string;
  /** Oportunidades criadas no funil no dia. */
  leads: number;
  /** Reuniões que a IA marcou no dia. */
  reunioesIa: number;
  /** Reuniões que alguém da equipe marcou no dia. */
  reunioesEquipe: number;
};

export type GraficoDoFunil = { dias: DiaDoFunil[] };

/**
 * Por funil (TODOS os funis, inclusive os sem nada — o gráfico não pode pular
 * dia nem sumir), um item por dia, do mais antigo para hoje. Vem tudo de uma
 * vez: trocar de funil no quadro não busca de novo.
 *
 * `soMinhas` é o escopo 'proprio' do departamento (app/page.tsx): só o que cai
 * em oportunidade da pessoa, o mesmo corte do quadro.
 */
export async function carregarGraficoDoFunil(soMinhas: string | null): Promise<Record<string, GraficoDoFunil>> {
  const linhas = await sql`
    WITH dias AS (
      SELECT generate_series(
               (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${DIAS_GRAFICO_FUNIL - 1}::int,
               (now() AT TIME ZONE 'America/Sao_Paulo')::date,
               interval '1 day')::date AS dia
    ),
    leads AS (
      SELECT (o.data_criacao AT TIME ZONE 'America/Sao_Paulo')::date AS dia, o.funil_id, count(*)::int AS n
        FROM oportunidades o
       WHERE o.data_criacao >= now() - make_interval(days => ${DIAS_GRAFICO_FUNIL + 1})
         AND (${soMinhas}::uuid IS NULL OR o.responsavel_id = ${soMinhas}::uuid)
       GROUP BY 1, 2
    ),
    reunioes AS (
      SELECT r.dia, coalesce(o.funil_id, op.funil_id) AS funil_id,
             count(*) FILTER (WHERE r.autor_id IS NULL)::int AS ia,
             count(*) FILTER (WHERE r.autor_id IS NOT NULL)::int AS equipe
        FROM (
          SELECT oportunidade_id, contato_id, autor_id, (data_criacao AT TIME ZONE 'America/Sao_Paulo')::date AS dia
            FROM agenda_reunioes
           WHERE data_criacao >= now() - make_interval(days => ${DIAS_GRAFICO_FUNIL + 1})
        ) r
        LEFT JOIN oportunidades o ON o.id = r.oportunidade_id
        LEFT JOIN LATERAL (
          SELECT o2.funil_id, o2.responsavel_id
            FROM oportunidades o2
           WHERE r.oportunidade_id IS NULL
             AND o2.contato_id = r.contato_id
             AND (o2.data_criacao AT TIME ZONE 'America/Sao_Paulo')::date <= r.dia
           ORDER BY o2.data_criacao DESC
           LIMIT 1
        ) op ON true
       WHERE ${soMinhas}::uuid IS NULL OR coalesce(o.responsavel_id, op.responsavel_id) = ${soMinhas}::uuid
       GROUP BY 1, 2
    )
    SELECT f.id AS funil_id,
           to_char(d.dia, 'YYYY-MM-DD') AS dia,
           coalesce(leads.n, 0) AS leads,
           coalesce(reunioes.ia, 0) AS reunioes_ia,
           coalesce(reunioes.equipe, 0) AS reunioes_equipe
      FROM funis f
      CROSS JOIN dias d
      LEFT JOIN leads ON leads.funil_id = f.id AND leads.dia = d.dia
      LEFT JOIN reunioes ON reunioes.funil_id = f.id AND reunioes.dia = d.dia
     ORDER BY f.id, d.dia`;

  const porFunil: Record<string, GraficoDoFunil> = {};
  for (const l of linhas) {
    const funil = (porFunil[l.funil_id as string] ??= { dias: [] });
    funil.dias.push({
      dia: l.dia as string,
      leads: Number(l.leads),
      reunioesIa: Number(l.reunioes_ia),
      reunioesEquipe: Number(l.reunioes_equipe),
    });
  }
  return porFunil;
}
