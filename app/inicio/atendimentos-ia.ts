// Os números do gráfico de IA do dashboard: por dia, nos últimos
// DIAS_GRAFICO_IA dias, quantas conversas a IA atendeu e quantas reuniões ela
// marcou — POR FUNIL (pedido dele, 2026-10-21: "mostrar o desempenho da IA
// naquele funil"). Antes (2026-10-05) era um número só para o CRM inteiro, com
// todas as reuniões, inclusive as marcadas pela ficha.
//
// ATENDIMENTO DE IA = conversa com pelo menos uma mensagem da IA naquele dia
// (enviada_por = 'ia'). Conta a conversa uma vez por dia, não cada mensagem: a
// IA quebra a resposta em até três (lib/ia/atendente.ts, emPartes).
//
// DE QUAL FUNIL é a conversa: a conversa é do CONTATO, não da oportunidade
// (ver a gaveta). Vale a oportunidade mais recente dele criada ATÉ aquele dia —
// a mesma ligação pela data que a IA usa. Contato sem oportunidade não entra
// em funil nenhum.
//
// REUNIÃO DA IA = linha de agenda_reunioes sem autor (a ficha grava quem marcou;
// a IA marca com autor nulo), pelo dia em que foi MARCADA, não pelo dia em que
// acontece: é o resultado do atendimento daquele dia. O funil é o da
// oportunidade da reunião, ou, sem ela, o do contato pela mesma regra.
// Cancelada no Google continua contando — o cancelamento só existe lá.
//
// LEADS = contatos distintos que a IA atendeu no período, no funil. A soma dos
// atendimentos por dia conta a mesma conversa em cada dia em que ela andou; é
// sobre os leads que a taxa de reunião faz sentido.
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
  /** Reuniões que a IA marcou no dia. */
  reunioes: number;
};

export type IaDoFunil = { dias: DiaIa[]; leads: number };

/**
 * Por funil (TODOS os funis, inclusive os sem nada — o gráfico não pode pular
 * dia nem sumir), um item por dia, do mais antigo para hoje. Vem tudo de uma
 * vez: trocar de funil no quadro não busca de novo.
 *
 * `soMinhas` é o escopo 'proprio' do departamento (app/page.tsx): só o que cai
 * em oportunidade da pessoa, o mesmo corte do quadro.
 */
export async function carregarAtendimentosIa(soMinhas: string | null): Promise<Record<string, IaDoFunil>> {
  const linhas = await sql`
    WITH dias AS (
      SELECT generate_series(
               (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${DIAS_GRAFICO_IA - 1}::int,
               (now() AT TIME ZONE 'America/Sao_Paulo')::date,
               interval '1 day')::date AS dia
    ),
    -- Uma linha por conversa e dia em que a IA falou, já com o funil.
    conversas AS (
      SELECT c.dia, c.atendimento_id, c.contato_id, op.funil_id
        FROM (
          SELECT DISTINCT (m.data_criacao AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                 m.atendimento_id, a.contato_id
            FROM mensagens m
            JOIN atendimentos a ON a.id = m.atendimento_id
           WHERE m.enviada_por = 'ia'
             AND m.data_criacao >= now() - make_interval(days => ${DIAS_GRAFICO_IA + 1})
        ) c
        CROSS JOIN LATERAL (
          SELECT o.funil_id, o.responsavel_id
            FROM oportunidades o
           WHERE o.contato_id = c.contato_id
             AND (o.data_criacao AT TIME ZONE 'America/Sao_Paulo')::date <= c.dia
           ORDER BY o.data_criacao DESC
           LIMIT 1
        ) op
       WHERE ${soMinhas}::uuid IS NULL OR op.responsavel_id = ${soMinhas}::uuid
    ),
    ia AS (
      SELECT dia, funil_id, count(DISTINCT atendimento_id)::int AS n
        FROM conversas GROUP BY 1, 2
    ),
    leads AS (
      SELECT funil_id, count(DISTINCT contato_id)::int AS n
        FROM conversas WHERE dia >= (SELECT min(dia) FROM dias) GROUP BY 1
    ),
    reunioes AS (
      SELECT r.dia, coalesce(o.funil_id, op.funil_id) AS funil_id, count(*)::int AS n
        FROM (
          SELECT oportunidade_id, contato_id, (data_criacao AT TIME ZONE 'America/Sao_Paulo')::date AS dia
            FROM agenda_reunioes
           WHERE autor_id IS NULL
             AND data_criacao >= now() - make_interval(days => ${DIAS_GRAFICO_IA + 1})
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
           coalesce(ia.n, 0) AS atendimentos,
           coalesce(reunioes.n, 0) AS reunioes,
           coalesce(leads.n, 0) AS leads
      FROM funis f
      CROSS JOIN dias d
      LEFT JOIN ia ON ia.funil_id = f.id AND ia.dia = d.dia
      LEFT JOIN reunioes ON reunioes.funil_id = f.id AND reunioes.dia = d.dia
      LEFT JOIN leads ON leads.funil_id = f.id
     ORDER BY f.id, d.dia`;

  const porFunil: Record<string, IaDoFunil> = {};
  for (const l of linhas) {
    const funil = (porFunil[l.funil_id as string] ??= { dias: [], leads: Number(l.leads) });
    funil.dias.push({ dia: l.dia as string, atendimentos: Number(l.atendimentos), reunioes: Number(l.reunioes) });
  }
  return porFunil;
}
