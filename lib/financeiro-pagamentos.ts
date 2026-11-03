// A folha do pessoal no banco do CRM (migration-financeiro-colaboradores.sql),
// para o Financeiro (a folha embaixo do Ponto e o pagamento na ficha de cada
// colaborador). Pedido dele, 2026-11-03.
//
//   · financeiro_colaboradores: o cadastro de pagamento de cada pessoa (setor,
//     atividade, tipo, valor hora, valor mês, PIX), para todos os meses;
//   · financeiro_lancamentos: adicional e descontos de cada pessoa em cada mês.
//
// A conta (referência, total do profissional, do setor e geral) é feita em
// lib/financeiro-tipos.ts, com as horas do ponto (lib/ponto.ts). É uma previsão
// do que pagar: dia com batida faltando não vira hora, e a tela mostra as
// pendências do ponto ao lado.
//
// O colaborador é o cadastro do app de ponto (users.id de lá); quem confere que
// ele existe é a ação, antes de gravar.
import "server-only";
import { sql } from "@/lib/db";
import type { CadastroPagamento, LancamentoMes } from "@/lib/financeiro-tipos";
import { Recusa } from "@/lib/resultado-acao";

const TETO_VALOR = 1_000_000;
const TETO = { setor: 80, atividade: 120, pix: 140 };

/** 42P01 = a tabela ainda não existe (a migration não rodou neste banco). */
function faltaTabela(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01";
}

const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v)); // numeric chega como texto

export type Folha = { cadastros: Map<string, CadastroPagamento>; lancamentos: Map<string, LancamentoMes> };

/** Os cadastros de todos e os lançamentos do mês. null = a migration ainda não rodou neste banco. */
export async function carregarFolha(mes: string): Promise<Folha | null> {
  try {
    const [cadastros, lancamentos] = await Promise.all([
      sql`SELECT pessoa_id, setor, atividade, tipo, valor_hora, valor_mes, pix FROM financeiro_colaboradores`,
      sql`SELECT pessoa_id, adicional, descontos FROM financeiro_lancamentos WHERE mes = ${mes}`,
    ]);
    return {
      cadastros: new Map(
        cadastros.map((l) => [
          l.pessoa_id as string,
          {
            pessoaId: l.pessoa_id as string,
            setor: (l.setor as string | null) ?? null,
            atividade: (l.atividade as string | null) ?? null,
            tipo: l.tipo === "fixo" ? "fixo" : "hora",
            valorHora: numero(l.valor_hora),
            valorMes: numero(l.valor_mes),
            pix: (l.pix as string | null) ?? null,
          } satisfies CadastroPagamento,
        ]),
      ),
      lancamentos: new Map(
        lancamentos.map((l) => [l.pessoa_id as string, { adicional: Number(l.adicional), descontos: Number(l.descontos) }]),
      ),
    };
  } catch (e) {
    if (faltaTabela(e)) return null;
    throw e;
  }
}

/** Valor em reais vindo do navegador: número ≥ 0 até o teto, com até dois decimais, ou vazio. */
function lerValor(bruto: unknown, rotulo: string): number | null {
  if (bruto === null || bruto === undefined || bruto === "") return null;
  const n = typeof bruto === "number" ? bruto : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > TETO_VALOR) throw new Recusa(`${rotulo} inválido.`);
  return Math.round(n * 100) / 100;
}

/** Texto curto vindo do navegador: sem caractere de controle, aparado, com teto; vazio vira null. */
function lerTexto(bruto: unknown, rotulo: string, teto: number): string | null {
  const t = typeof bruto === "string" ? bruto.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  if (t.length > teto) throw new Recusa(`${rotulo}: no máximo ${teto} caracteres.`);
  return t || null;
}

/** Tipo, valor hora, valor mês e PIX: a parte do cadastro que decide a conta, e a que se edita na linha da folha. */
export type PagamentoDaLinha = Pick<CadastroPagamento, "pessoaId" | "tipo" | "valorHora" | "valorMes" | "pix">;

/** Confere tipo, valores e PIX vindos da tela. Lança Recusa com a frase para a pessoa ler. */
export function conferirPagamento(dados: Record<string, unknown>): PagamentoDaLinha {
  const { pessoaId, tipo } = dados;
  if (typeof pessoaId !== "string" || !pessoaId || pessoaId.length > 64) throw new Recusa("Colaborador inválido.");
  if (tipo !== "hora" && tipo !== "fixo") throw new Recusa("Escolha se a pessoa recebe por hora ou fixo.");
  const valorHora = lerValor(dados.valorHora, "Valor hora");
  const valorMes = lerValor(dados.valorMes, "Valor mês");
  if (tipo === "hora" && valorHora === null) throw new Recusa("Quem recebe por hora precisa do valor hora.");
  if (tipo === "fixo" && valorMes === null) throw new Recusa("Quem recebe fixo precisa do valor mês.");
  return { pessoaId, tipo, valorHora, valorMes, pix: lerTexto(dados.pix, "Chave PIX", TETO.pix) };
}

/**
 * Confere e normaliza o que veio da tela: o cadastro inteiro (com setor e
 * atividade) e o lançamento do mês. Lança Recusa com a frase para a pessoa ler
 * (a ação devolve como `erro`).
 */
export function conferirFolha(dados: Record<string, unknown>): { cadastro: CadastroPagamento; lancamento: LancamentoMes } {
  return {
    cadastro: {
      ...conferirPagamento(dados),
      setor: lerTexto(dados.setor, "Setor", TETO.setor),
      atividade: lerTexto(dados.atividade, "Atividade principal", TETO.atividade),
    },
    lancamento: { adicional: lerValor(dados.adicional, "Adicional") ?? 0, descontos: lerValor(dados.descontos, "Descontos") ?? 0 },
  };
}


/** Grava o cadastro e o lançamento do mês juntos. false = a migration ainda não rodou. */
export async function salvarFolha(c: CadastroPagamento, mes: string, l: LancamentoMes): Promise<boolean> {
  try {
    await sql.begin(async (t: typeof sql) => {
      await t`
        INSERT INTO financeiro_colaboradores (pessoa_id, setor, atividade, tipo, valor_hora, valor_mes, pix)
        VALUES (${c.pessoaId}, ${c.setor}, ${c.atividade}, ${c.tipo}, ${c.valorHora}, ${c.valorMes}, ${c.pix})
        ON CONFLICT (pessoa_id) DO UPDATE
           SET setor = EXCLUDED.setor, atividade = EXCLUDED.atividade, tipo = EXCLUDED.tipo,
               valor_hora = EXCLUDED.valor_hora, valor_mes = EXCLUDED.valor_mes, pix = EXCLUDED.pix`;
      await t`
        INSERT INTO financeiro_lancamentos (pessoa_id, mes, adicional, descontos)
        VALUES (${c.pessoaId}, ${mes}, ${l.adicional}, ${l.descontos})
        ON CONFLICT (pessoa_id, mes) DO UPDATE
           SET adicional = EXCLUDED.adicional, descontos = EXCLUDED.descontos`;
    });
    return true;
  } catch (e) {
    if (faltaTabela(e)) return false;
    throw e;
  }
}

/**
 * Grava só tipo, valores e PIX (o que se edita na linha da folha). Setor,
 * atividade e os lançamentos de quem já tinha cadastro ficam como estavam.
 * false = a migration ainda não rodou.
 */
export async function salvarPagamento(p: PagamentoDaLinha): Promise<boolean> {
  try {
    await sql`
      INSERT INTO financeiro_colaboradores (pessoa_id, tipo, valor_hora, valor_mes, pix)
      VALUES (${p.pessoaId}, ${p.tipo}, ${p.valorHora}, ${p.valorMes}, ${p.pix})
      ON CONFLICT (pessoa_id) DO UPDATE
         SET tipo = EXCLUDED.tipo, valor_hora = EXCLUDED.valor_hora, valor_mes = EXCLUDED.valor_mes, pix = EXCLUDED.pix`;
    return true;
  } catch (e) {
    if (faltaTabela(e)) return false;
    throw e;
  }
}
