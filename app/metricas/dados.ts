// Leitura das Métricas. Só importado pelo page.tsx (server).
//
// O ESCOPO ENTRA NO SQL, e essa é a regra inteira deste arquivo. Com escopo
// 'proprio' o WHERE recusa a linha de qualquer outra pessoa — em vez de trazer
// todo mundo e esconder no React. Filtrar na renderização deixaria o número do
// colega viajar no HTML, e aí basta abrir o DevTools pra ler.
//
// SÓ O QUE O BANCO RESPONDE HOJE. Não há "ganhas" nem "perdidas" aqui porque
// `oportunidades.status` é 'aberta' em toda linha da base — nada escreve outro
// valor (ver a varredura em docs/acessos.md). E não há conversão histórica
// porque não existe registro de quando a oportunidade mudou de etapa; a mesma
// limitação que app/inicio/metricas.ts já declara. Inventar as duas daria uma
// tela bonita mentindo com convicção.
import { sql } from "@/lib/db";
import type { Escopo } from "@/lib/auth/modulos";

export type MetricaPessoa = {
  usuarioId: string;
  nome: string;
  iniciais: string;
  /** Oportunidades em aberto sob responsabilidade da pessoa. */
  carteira: number;
  valorAberto: number;
  ticketMedio: number;
  /** Média de dias desde a criação das oportunidades em aberto. */
  diasMedio: number;
  criadasNoPeriodo: number;
  atendimentosAbertos: number;
  atendimentosEncerrados: number;
  mensagensEnviadas: number;
};

export type DadosMetricas = {
  pessoas: MetricaPessoa[];
  /** Soma de todas as linhas acima — o cabeçalho da tela. */
  total: Omit<MetricaPessoa, "usuarioId" | "nome" | "iniciais">;
  dias: number;
};

// Períodos oferecidos. Lista fechada e não número livre da URL: `?dias=99999`
// varreria a tabela de mensagens inteira a cada carga.
export const PERIODOS = [7, 30, 90] as const;
export type Periodo = (typeof PERIODOS)[number];

export function periodoValido(valor: string | undefined): Periodo {
  const n = Number(valor);
  return (PERIODOS as readonly number[]).includes(n) ? (n as Periodo) : 30;
}

type LinhaCarteira = {
  responsavel_id: string;
  carteira: number;
  valor: number;
  dias: number;
};
type LinhaContagem = { id: string; qtd: number };
type LinhaAtendimento = {
  responsavel_id: string;
  abertos: number;
  encerrados: number;
};
type LinhaUsuario = { id: string; nome: string; iniciais: string };

export async function carregarMetricas(
  escopo: Escopo,
  usuarioId: string,
  dias: Periodo,
): Promise<DadosMetricas> {
  // `todos` neutraliza o filtro de dono sem precisar de duas versões de cada
  // consulta: `(true OR responsavel_id = ...)` é sempre verdadeiro, e o
  // planejador do Postgres descarta o teste. Fragmento condicional de SQL faria
  // o mesmo, e com dois caminhos pra manter — e um deles sem filtro nenhum, que
  // é exatamente o que não pode escapar numa revisão futura.
  const todos = escopo === "todos";

  const [pessoas, carteira, criadas, atendimentos, mensagens] =
    await Promise.all([
      // Quem aparece na tabela. Todo usuário ATIVO, e não "quem está no
      // departamento Comercial": departamento é dado que o TI muda na tela, e
      // uma consulta presa ao slug 'comercial' quebraria calada no dia em que
      // ele renomear o time ou criar um segundo. Quem não vendeu nada aparece
      // com zeros — o que também é informação.
      sql`
        SELECT id, nome, iniciais
          FROM usuarios
         WHERE ativo = true
           AND (${todos}::boolean OR id = ${usuarioId})
         ORDER BY nome
      ` as Promise<LinhaUsuario[]>,

      sql`
        SELECT responsavel_id,
               count(*)::int                                        AS carteira,
               COALESCE(sum(valor), 0)::float8                      AS valor,
               COALESCE(avg(CURRENT_DATE - data_criacao::date), 0)::float8 AS dias
          FROM oportunidades
         WHERE status = 'aberta'
           AND responsavel_id IS NOT NULL
           AND (${todos}::boolean OR responsavel_id = ${usuarioId})
         GROUP BY responsavel_id
      ` as Promise<LinhaCarteira[]>,

      sql`
        SELECT responsavel_id AS id, count(*)::int AS qtd
          FROM oportunidades
         WHERE responsavel_id IS NOT NULL
           AND data_criacao >= now() - make_interval(days => ${dias}::int)
           AND (${todos}::boolean OR responsavel_id = ${usuarioId})
         GROUP BY responsavel_id
      ` as Promise<LinhaContagem[]>,

      // 'na_fila' conta como aberto: é atendimento vivo esperando alguém. Só
      // entra aqui quem já tem responsável — o que está na fila SEM dono não é
      // de ninguém e não pode inflar a coluna de nenhuma pessoa.
      sql`
        SELECT responsavel_id,
               count(*) FILTER (WHERE status IN ('aberto', 'na_fila'))::int AS abertos,
               count(*) FILTER (WHERE status = 'encerrado')::int            AS encerrados
          FROM atendimentos
         WHERE responsavel_id IS NOT NULL
           AND (${todos}::boolean OR responsavel_id = ${usuarioId})
         GROUP BY responsavel_id
      ` as Promise<LinhaAtendimento[]>,

      // origem='agente' e autor_id não nulo: mensagem que o CRM mandou sozinho
      // (cadência, automação) não tem autor e não vira produtividade de
      // ninguém. Contar disparo de robô como trabalho de gente é o jeito mais
      // rápido de tornar esta tela inútil.
      sql`
        SELECT autor_id AS id, count(*)::int AS qtd
          FROM mensagens
         WHERE origem = 'agente'
           AND autor_id IS NOT NULL
           AND data_criacao >= now() - make_interval(days => ${dias}::int)
           AND (${todos}::boolean OR autor_id = ${usuarioId})
         GROUP BY autor_id
      ` as Promise<LinhaContagem[]>,
    ]);

  const porCarteira = new Map(carteira.map((c) => [c.responsavel_id, c]));
  const porCriadas = new Map(criadas.map((c) => [c.id, c.qtd]));
  const porAtendimento = new Map(atendimentos.map((a) => [a.responsavel_id, a]));
  const porMensagem = new Map(mensagens.map((m) => [m.id, m.qtd]));

  const linhas: MetricaPessoa[] = pessoas.map((u) => {
    const c = porCarteira.get(u.id);
    const a = porAtendimento.get(u.id);
    const valorAberto = c?.valor ?? 0;
    const qtdCarteira = c?.carteira ?? 0;

    return {
      usuarioId: u.id,
      nome: u.nome,
      iniciais: u.iniciais,
      carteira: qtdCarteira,
      valorAberto,
      ticketMedio: qtdCarteira > 0 ? Math.round(valorAberto / qtdCarteira) : 0,
      diasMedio: Math.round(c?.dias ?? 0),
      criadasNoPeriodo: porCriadas.get(u.id) ?? 0,
      atendimentosAbertos: a?.abertos ?? 0,
      atendimentosEncerrados: a?.encerrados ?? 0,
      mensagensEnviadas: porMensagem.get(u.id) ?? 0,
    };
  });

  const soma = (pegar: (p: MetricaPessoa) => number) =>
    linhas.reduce((s, p) => s + pegar(p), 0);

  const carteiraTotal = soma((p) => p.carteira);
  const valorTotal = soma((p) => p.valorAberto);
  // Média PONDERADA pela carteira, não média das médias: quem tem 1 oportunidade
  // parada há 300 dias não pode pesar o mesmo que quem tem 40 em dia.
  const diasPonderado = soma((p) => p.diasMedio * p.carteira);

  return {
    pessoas: linhas,
    total: {
      carteira: carteiraTotal,
      valorAberto: valorTotal,
      ticketMedio: carteiraTotal > 0 ? Math.round(valorTotal / carteiraTotal) : 0,
      diasMedio: carteiraTotal > 0 ? Math.round(diasPonderado / carteiraTotal) : 0,
      criadasNoPeriodo: soma((p) => p.criadasNoPeriodo),
      atendimentosAbertos: soma((p) => p.atendimentosAbertos),
      atendimentosEncerrados: soma((p) => p.atendimentosEncerrados),
      mensagensEnviadas: soma((p) => p.mensagensEnviadas),
    },
    dias,
  };
}
