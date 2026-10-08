// Métricas: demandas GERADAS e ENTREGUES por dia, por semana e por mês, da
// equipe e de cada pessoa. Só importado pelo page.tsx (server).
//
// O QUE CONTA PARA QUEM (decisão dele, 2026-10-07 — "tira isso de
// departamento"):
//   · a EQUIPE: toda demanda criada é uma gerada; todo check é uma entrega;
//   · uma PESSOA: geradas são as criadas PARA ela; entregues, as que ELA
//     concluiu. O chamado do TI não é de ninguém até alguém concluir — aí conta
//     para quem concluiu, nas duas colunas (gerado no dia em que foi aberto,
//     entregue no dia do check).
//
// QUEM VÊ O QUÊ (2026-10-07): Admin e TI veem a equipe e filtram por pessoa;
// os demais, só os próprios números. A regra entra no SQL: para quem não vê a
// equipe só sobem do banco as demandas dela, e o número do colega nem chega ao
// servidor da tela.
//
// Semana começa na segunda. Tudo no fuso de Brasília.
import "server-only";
import { sql } from "@/lib/db";

/** Um ponto do gráfico: o dia em que o balde começa (o dia, a segunda da semana, o dia 1 do mês). */
export type Balde = { dia: string; geradas: number; entregues: number };
export type Contagem = { geradas: number; entregues: number };

export type Recorte = {
  hoje: Contagem;
  ontem: Contagem;
  semana: Contagem;
  semanaPassada: Contagem;
  mes: Contagem;
  mesPassado: Contagem;
  porDia: Balde[];
  porSemana: Balde[];
  porMes: Balde[];
};

export type PessoaDasMetricas = { id: string; nome: string; iniciais: string };

export type MetricasDemandas = {
  equipe: Recorte;
  /** Para quem vê a equipe, cada pessoa; para os demais, só a própria. */
  porPessoa: Record<string, Recorte>;
  pessoas: PessoaDasMetricas[];
  /** "2026-10-07", no fuso de Brasília. */
  hoje: string;
  /** migration-demandas.sql ainda não rodou. */
  faltaTabela: boolean;
};

type Linha = {
  responsavel_id: string | null;
  departamento_id: string | null;
  feita_por: string | null;
  dia_criada: string;
  dia_feita: string | null;
};

const FUSO = "America/Sao_Paulo";
const DIAS = 30, SEMANAS = 12, MESES = 12;

function meioDia(dia: string) {
  return new Date(`${dia}T12:00:00Z`);
}
function somarDias(dia: string, n: number) {
  const d = meioDia(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** A segunda-feira da semana do dia. */
function segunda(dia: string) {
  const semana = meioDia(dia).getUTCDay(); // 0 = domingo
  return somarDias(dia, -((semana + 6) % 7));
}
/** O dia 1 do mês do dia, e de `n` meses antes/depois. */
function primeiroDoMes(dia: string, n = 0) {
  const d = meioDia(`${dia.slice(0, 7)}-01`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** O recorte de quem `gerou` e `entregou` diz. */
function recortar(linhas: Linha[], gerou: (l: Linha) => boolean, entregou: (l: Linha) => boolean, hoje: string): Recorte {
  const geradas = linhas.filter(gerou).map((l) => l.dia_criada);
  const entregues = linhas.filter(entregou).map((l) => l.dia_feita!).filter(Boolean);

  const contar = (de: string, ate: string): Contagem => ({
    geradas: geradas.filter((d) => d >= de && d <= ate).length,
    entregues: entregues.filter((d) => d >= de && d <= ate).length,
  });

  const baldes = (inicios: string[], chave: (dia: string) => string): Balde[] => {
    const mapa = new Map(inicios.map((dia) => [dia, { dia, geradas: 0, entregues: 0 }]));
    for (const d of geradas) { const b = mapa.get(chave(d)); if (b) b.geradas++; }
    for (const d of entregues) { const b = mapa.get(chave(d)); if (b) b.entregues++; }
    return inicios.map((dia) => mapa.get(dia)!);
  };

  const ontem = somarDias(hoje, -1);
  const estaSegunda = segunda(hoje);
  const esteMes = primeiroDoMes(hoje);
  return {
    hoje: contar(hoje, hoje),
    ontem: contar(ontem, ontem),
    semana: contar(estaSegunda, hoje),
    semanaPassada: contar(somarDias(estaSegunda, -7), somarDias(estaSegunda, -1)),
    mes: contar(esteMes, hoje),
    mesPassado: contar(primeiroDoMes(hoje, -1), somarDias(esteMes, -1)),
    porDia: baldes(Array.from({ length: DIAS }, (_, i) => somarDias(hoje, i - (DIAS - 1))), (d) => d),
    porSemana: baldes(Array.from({ length: SEMANAS }, (_, i) => somarDias(estaSegunda, 7 * (i - (SEMANAS - 1)))), segunda),
    porMes: baldes(Array.from({ length: MESES }, (_, i) => primeiroDoMes(hoje, i - (MESES - 1))), (d) => primeiroDoMes(d)),
  };
}

export async function carregarMetricasDemandas(
  veEquipe: boolean,
  usuarioId: string,
  hoje: string,
): Promise<MetricasDemandas> {
  const todos = veEquipe;
  // O mais antigo que alguma conta lê: o primeiro mês do gráfico mensal.
  const desde = primeiroDoMes(hoje, -(MESES - 1));

  let linhas: Linha[], pessoas: PessoaDasMetricas[];
  try {
    [linhas, pessoas] = (await Promise.all([
      sql`
        SELECT d.responsavel_id, d.departamento_id, d.feita_por,
               to_char(d.data_criacao AT TIME ZONE ${FUSO}, 'YYYY-MM-DD') AS dia_criada,
               to_char(d.feita_em AT TIME ZONE ${FUSO}, 'YYYY-MM-DD')     AS dia_feita
          FROM demandas d
         WHERE (d.data_criacao >= (${desde}::date::timestamp AT TIME ZONE ${FUSO})
                OR d.feita_em >= (${desde}::date::timestamp AT TIME ZONE ${FUSO}))
           AND (${todos}::boolean OR d.responsavel_id = ${usuarioId} OR d.feita_por = ${usuarioId})`,
      // Quem aparece no filtro: quem pode receber demanda (ativo, com login e
      // com o módulo Demandas).
      sql`
        SELECT u.id, u.nome, u.iniciais
          FROM usuarios u
          JOIN departamento_modulos dm ON dm.departamento_id = u.departamento_id AND dm.modulo = 'demandas'
         WHERE u.ativo = true AND u.email IS NOT NULL
           AND (${todos}::boolean OR u.id = ${usuarioId})
         ORDER BY u.nome`,
    ])) as unknown as [Linha[], PessoaDasMetricas[]];
  } catch (e) {
    // 42P01 = undefined_table: a tela segue de pé, sem números.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01") {
      const vazio = recortar([], () => false, () => false, hoje);
      return { equipe: vazio, porPessoa: {}, pessoas: [], hoje, faltaTabela: true };
    }
    throw e;
  }

  const daPessoa = (id: string) => ({
    gerou: (l: Linha) => l.responsavel_id === id || (l.departamento_id !== null && l.feita_por === id),
    entregou: (l: Linha) => l.feita_por === id && l.dia_feita !== null,
  });

  const porPessoa: Record<string, Recorte> = {};
  for (const p of pessoas) {
    const r = daPessoa(p.id);
    porPessoa[p.id] = recortar(linhas, r.gerou, r.entregou, hoje);
  }

  // Para quem não vê a equipe, "a equipe" de quem olha é ela mesma.
  const eu = daPessoa(usuarioId);
  const equipe = todos
    ? recortar(linhas, () => true, (l) => l.dia_feita !== null, hoje)
    : recortar(linhas, eu.gerou, eu.entregou, hoje);

  return { equipe, porPessoa, pessoas, hoje, faltaTabela: false };
}
