// Os números do gráfico do topo do quadro: por dia, POR FUNIL, quantos leads
// entraram no funil, quantas reuniões a IA marcou e quantas a equipe marcou
// (pedido dele, 2026-10-29: "leads que entrou no funil x reuniões IA x reuniões
// humanas"). Até então (2026-10-21) eram os atendimentos da IA e as reuniões
// dela; antes ainda (2026-10-05), um número só para o CRM inteiro.
//
// PERÍODO (2026-10-29, mesmo dia): a carga da tela traz os últimos
// DIAS_GRAFICO_FUNIL dias de todos os funis (a "Semana" sai deles); o
// "Personalizado" pede um intervalo de um funil só (diasDoFunil, pela ação em
// ./acoes-grafico.ts). Junto vêm os TOTAIS do funil, desde sempre: leads e
// reuniões agendadas, para o canto do gráfico.
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
/** O maior intervalo do "Personalizado": um ponto por dia. */
export const MAXIMO_DIAS_PERSONALIZADO = 366;

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

/** Desde sempre, no escopo de quem vê: os cards do funil e as reuniões ligadas a ele. */
export type TotaisDoFunil = { leads: number; agendadas: number };

export type GraficoDoFunil = { dias: DiaDoFunil[]; totais: TotaisDoFunil };

/**
 * As reuniões já com o funil (a da oportunidade ou, sem ela, a do contato pela
 * data), no escopo de quem vê. `de`/`ate` null = desde sempre.
 */
const reunioesComFunil = (de: string | null, ate: string | null, soMinhas: string | null) => sql`
  SELECT r.dia, r.autor_id, coalesce(o.funil_id, op.funil_id) AS funil_id
    FROM (
      SELECT oportunidade_id, contato_id, autor_id, (data_criacao AT TIME ZONE 'America/Sao_Paulo')::date AS dia
        FROM agenda_reunioes
       WHERE (${de}::date IS NULL OR data_criacao >= (${de}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo')
         AND (${ate}::date IS NULL OR data_criacao < (${ate}::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
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
   WHERE ${soMinhas}::uuid IS NULL OR coalesce(o.responsavel_id, op.responsavel_id) = ${soMinhas}::uuid`;

/**
 * Por funil (`funilId` null = TODOS, inclusive os sem nada — o gráfico não pode
 * pular dia nem sumir), um item por dia de `de` a `ate`, do mais antigo para o
 * mais novo.
 */
async function consultarDias(e: { de: string; ate: string; funilId: string | null; soMinhas: string | null }): Promise<Map<string, DiaDoFunil[]>> {
  const linhas = await sql`
    WITH dias AS (
      SELECT generate_series(${e.de}::date, ${e.ate}::date, interval '1 day')::date AS dia
    ),
    leads AS (
      SELECT (o.data_criacao AT TIME ZONE 'America/Sao_Paulo')::date AS dia, o.funil_id, count(*)::int AS n
        FROM oportunidades o
       WHERE o.data_criacao >= (${e.de}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
         AND o.data_criacao < (${e.ate}::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'
         AND (${e.funilId}::uuid IS NULL OR o.funil_id = ${e.funilId}::uuid)
         AND (${e.soMinhas}::uuid IS NULL OR o.responsavel_id = ${e.soMinhas}::uuid)
       GROUP BY 1, 2
    ),
    reunioes AS (
      SELECT dia, funil_id,
             count(*) FILTER (WHERE autor_id IS NULL)::int AS ia,
             count(*) FILTER (WHERE autor_id IS NOT NULL)::int AS equipe
        FROM (${reunioesComFunil(e.de, e.ate, e.soMinhas)}) r
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
     WHERE ${e.funilId}::uuid IS NULL OR f.id = ${e.funilId}::uuid
     ORDER BY f.id, d.dia`;

  const porFunil = new Map<string, DiaDoFunil[]>();
  for (const l of linhas) {
    const dias = porFunil.get(l.funil_id as string) ?? porFunil.set(l.funil_id as string, []).get(l.funil_id as string)!;
    dias.push({
      dia: l.dia as string,
      leads: Number(l.leads),
      reunioesIa: Number(l.reunioes_ia),
      reunioesEquipe: Number(l.reunioes_equipe),
    });
  }
  return porFunil;
}

/**
 * A carga da tela: os últimos DIAS_GRAFICO_FUNIL dias e os totais de TODOS os
 * funis, de uma vez — trocar de funil no quadro não busca de novo.
 *
 * `soMinhas` é o escopo 'proprio' do departamento (app/page.tsx): só o que cai
 * em oportunidade da pessoa, o mesmo corte do quadro.
 */
export async function carregarGraficoDoFunil(soMinhas: string | null): Promise<Record<string, GraficoDoFunil>> {
  const [[hoje], totais] = await Promise.all([
    sql`SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS ate,
               to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - ${DIAS_GRAFICO_FUNIL - 1}::int, 'YYYY-MM-DD') AS de`,
    sql`
      SELECT f.id AS funil_id,
             (SELECT count(*)::int FROM oportunidades o
               WHERE o.funil_id = f.id AND (${soMinhas}::uuid IS NULL OR o.responsavel_id = ${soMinhas}::uuid)) AS leads,
             (SELECT count(*)::int FROM (${reunioesComFunil(null, null, soMinhas)}) r WHERE r.funil_id = f.id) AS agendadas
        FROM funis f`,
  ]);
  const dias = await consultarDias({ de: hoje.de as string, ate: hoje.ate as string, funilId: null, soMinhas });
  const porFunil: Record<string, GraficoDoFunil> = {};
  for (const t of totais) {
    porFunil[t.funil_id as string] = {
      dias: dias.get(t.funil_id as string) ?? [],
      totais: { leads: Number(t.leads), agendadas: Number(t.agendadas) },
    };
  }
  return porFunil;
}

/** O "Personalizado": os dias de `de` a `ate` de um funil. Quem chama já conferiu as datas. */
export async function diasDoFunil(funilId: string, de: string, ate: string, soMinhas: string | null): Promise<DiaDoFunil[]> {
  return (await consultarDias({ de, ate, funilId, soMinhas })).get(funilId) ?? [];
}
