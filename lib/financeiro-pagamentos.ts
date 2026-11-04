// A folha do pessoal no banco do CRM (migration-financeiro-colaboradores.sql e
// migration-financeiro-mes.sql), para o Financeiro: a folha do mês e o
// pagamento de cada colaborador, editado numa gaveta. Pedido dele, 2026-11-03.
//
//   · financeiro_colaboradores: o cadastro de cada pessoa. Setor, atividade e
//     PIX valem para todos os meses; tipo, valor hora, valor mês e taxa de
//     deslocamento são o PADRÃO dos meses ainda não lançados;
//   · financeiro_lancamentos: por pessoa e mês, o adicional, os descontos e a
//     FOTO dos valores com que o mês foi lançado.
//
// A FOTO DO MÊS (2026-11-04, "se já foi lançado um mês no passado não é
// dinâmico, fica naquele mês"): salvar num mês grava a foto daquele mês. O
// padrão do cadastro só muda quando se salva o mês corrente ou um futuro:
// corrigir outubro não mexe no que vale para dezembro. Quem ainda não tinha
// cadastro nasce com os valores salvos, de qualquer mês.
//
// A conta (referência, deslocamento, total do profissional, do setor e geral)
// é feita em lib/financeiro-tipos.ts, com as horas e os dias presenciais do
// ponto (lib/ponto.ts).
//
// O colaborador é o cadastro do app de ponto (users.id de lá), uma conta do
// AmaanOffice ("amaanoffice:<id>") ou alguém cadastrado à mão ("manual:<uuid>",
// com o nome na coluna `nome`), lib/financeiro-tipos.ts. A ação confere que ele
// existe, ou sorteia o id do cadastrado à mão novo (`resolverColaborador`),
// antes de gravar.
import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import {
  NOVO_MANUAL,
  origemDe,
  PREFIXO_AMAANOFFICE,
  PREFIXO_MANUAL,
  TAXA_PRESENCIAL,
  type CadastroPagamento,
  type LancamentoMes,
  type ValoresPagamento,
} from "@/lib/financeiro-tipos";
import { existeColaborador } from "@/lib/ponto";
import { Recusa } from "@/lib/resultado-acao";
import { ehUuid } from "@/lib/validacao";

const TETO_VALOR = 1_000_000;
const TETO = { nome: 120, setor: 80, atividade: 120, pix: 140 };

/** 42P01 = falta a tabela; 42703 = falta a coluna (uma das migrations da folha não rodou neste banco). */
function faltaMigration(e: unknown): boolean {
  const codigo = typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codigo === "42P01" || codigo === "42703";
}

const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v)); // numeric chega como texto

function valoresDaLinha(l: Record<string, unknown>): ValoresPagamento {
  return {
    tipo: l.tipo === "fixo" ? "fixo" : "hora",
    valorHora: numero(l.valor_hora),
    valorMes: numero(l.valor_mes),
    taxaDeslocamento: numero(l.taxa_deslocamento),
  };
}

/** Uma conta do AmaanOffice, com o id já no formato da folha ("amaanoffice:<id>"). */
export type ContaAmaanOffice = { id: string; nome: string; email: string | null; ativo: boolean };

export type Folha = {
  cadastros: Map<string, CadastroPagamento>;
  lancamentos: Map<string, LancamentoMes>;
  /** As contas do AmaanOffice: o nome de quem entrou na folha por elas e as que dá para adicionar. */
  contas: ContaAmaanOffice[];
};

/** Os cadastros de todos, os lançamentos do mês e as contas do AmaanOffice. null = falta rodar as migrations da folha neste banco. */
export async function carregarFolha(mes: string): Promise<Folha | null> {
  try {
    const [cadastros, lancamentos, contas] = await Promise.all([
      sql`SELECT pessoa_id, nome, setor, atividade, tipo, valor_hora, valor_mes, taxa_deslocamento, pix FROM financeiro_colaboradores`,
      sql`SELECT pessoa_id, adicional, descontos, tipo, valor_hora, valor_mes, taxa_deslocamento FROM financeiro_lancamentos WHERE mes = ${mes}`,
      sql`SELECT id, nome, email, ativo FROM usuarios ORDER BY nome`,
    ]);
    return {
      contas: contas.map((c) => ({
        id: `${PREFIXO_AMAANOFFICE}${c.id as string}`,
        nome: c.nome as string,
        email: (c.email as string | null) ?? null,
        ativo: Boolean(c.ativo),
      })),
      cadastros: new Map(
        cadastros.map((l) => [
          l.pessoa_id as string,
          {
            pessoaId: l.pessoa_id as string,
            nome: (l.nome as string | null) ?? null,
            setor: (l.setor as string | null) ?? null,
            atividade: (l.atividade as string | null) ?? null,
            pix: (l.pix as string | null) ?? null,
            ...valoresDaLinha(l),
          } satisfies CadastroPagamento,
        ]),
      ),
      lancamentos: new Map(
        lancamentos.map((l) => [
          l.pessoa_id as string,
          { adicional: Number(l.adicional), descontos: Number(l.descontos), valores: l.tipo ? valoresDaLinha(l) : null } satisfies LancamentoMes,
        ]),
      ),
    };
  } catch (e) {
    if (faltaMigration(e)) return null;
    throw e;
  }
}

/**
 * A pessoa pode estar na folha? Do app de ponto, o cadastro de lá tem que
 * existir; do AmaanOffice, a conta; cadastrada à mão, o cadastro na folha. Uma
 * conta desativada continua valendo, para corrigir os meses em que ela
 * trabalhou.
 */
export async function colaboradorExiste(pessoaId: string): Promise<boolean> {
  const origem = origemDe(pessoaId);
  if (origem === "ponto") return existeColaborador(pessoaId);
  if (origem === "manual") {
    if (!ehUuid(pessoaId.slice(PREFIXO_MANUAL.length))) return false;
    const [cadastro] = await sql`SELECT 1 FROM financeiro_colaboradores WHERE pessoa_id = ${pessoaId}`;
    return Boolean(cadastro);
  }
  const id = pessoaId.slice(PREFIXO_AMAANOFFICE.length);
  if (!ehUuid(id)) return false;
  const [conta] = await sql`SELECT 1 FROM usuarios WHERE id = ${id}`;
  return Boolean(conta);
}

/**
 * O id com que a ficha grava: o cadastrado à mão novo (`NOVO_MANUAL`) ganha um
 * id sorteado aqui, no servidor; os demais têm que existir. null = não existe.
 */
export async function resolverColaborador(pessoaId: string): Promise<string | null> {
  if (pessoaId === NOVO_MANUAL) return `${PREFIXO_MANUAL}${randomUUID()}`;
  return (await colaboradorExiste(pessoaId)) ? pessoaId : null;
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

function lerPessoa(bruto: unknown): string {
  if (typeof bruto !== "string" || !bruto || bruto.length > 64) throw new Recusa("Colaborador inválido.");
  return bruto;
}

/** Tipo, valor hora, valor mês e se o deslocamento conta, vindos da tela. Lança Recusa com a frase para a pessoa ler. */
function conferirValores(dados: Record<string, unknown>): ValoresPagamento {
  const { tipo, deslocamento } = dados;
  if (tipo !== "hora" && tipo !== "fixo") throw new Recusa("Escolha se a pessoa recebe por hora ou fixo.");
  const valorHora = lerValor(dados.valorHora, "Valor hora");
  const valorMes = lerValor(dados.valorMes, "Valor mês");
  if (tipo === "hora" && valorHora === null) throw new Recusa("Quem recebe por hora precisa do valor hora.");
  if (tipo === "fixo" && valorMes === null) throw new Recusa("Quem recebe fixo precisa do valor mês.");
  // O DESLOCAMENTO É UM CHECK NO CADASTRO (2026-11-04, "é definido ali se o
  // sistema vai contabilizar isso ou não"): a tela diz só se conta, e o valor
  // do dia é o da regra, decidido aqui. Marcado grava a taxa com o número (o
  // mês lançado guarda o que valeu, mesmo que a regra mude); desmarcado grava 0.
  if (typeof deslocamento !== "boolean") throw new Recusa("Marque se o deslocamento entra na conta.");
  return { tipo, valorHora, valorMes, taxaDeslocamento: deslocamento ? TAXA_PRESENCIAL : 0 };
}

/** O que a gaveta do pagamento manda: o cadastro, os valores do mês, o adicional e os descontos do mês. */
export type DadosDaFicha = {
  pessoaId: string;
  /** Só de quem é cadastrado à mão (obrigatório); null para o ponto e o AmaanOffice. */
  nome: string | null;
  valores: ValoresPagamento;
  pix: string | null;
  setor: string | null;
  atividade: string | null;
  adicional: number;
  descontos: number;
};

export function conferirFicha(dados: Record<string, unknown>): DadosDaFicha {
  const pessoaId = lerPessoa(dados.pessoaId);
  const nome = origemDe(pessoaId) === "manual" ? lerTexto(dados.nome, "Nome", TETO.nome) : null;
  if (origemDe(pessoaId) === "manual" && !nome) throw new Recusa("Escreva o nome do colaborador.");
  return {
    pessoaId,
    nome,
    valores: conferirValores(dados),
    pix: lerTexto(dados.pix, "Chave PIX", TETO.pix),
    setor: lerTexto(dados.setor, "Setor", TETO.setor),
    atividade: lerTexto(dados.atividade, "Atividade principal", TETO.atividade),
    adicional: lerValor(dados.adicional, "Adicional") ?? 0,
    descontos: lerValor(dados.descontos, "Descontos") ?? 0,
  };
}

/**
 * Grava pela gaveta do pagamento: nome (de quem é cadastrado à mão), setor,
 * atividade e PIX no cadastro; a foto dos valores, o adicional e os descontos
 * no mês; e o padrão do cadastro se `padrao` (mês corrente ou futuro). false =
 * falta migration.
 */
export async function salvarFicha(mes: string, d: DadosDaFicha, padrao: boolean): Promise<boolean> {
  const v = d.valores;
  try {
    await sql.begin(async (t: typeof sql) => {
      await t`
        INSERT INTO financeiro_colaboradores (pessoa_id, nome, setor, atividade, tipo, valor_hora, valor_mes, taxa_deslocamento, pix)
        VALUES (${d.pessoaId}, ${d.nome}, ${d.setor}, ${d.atividade}, ${v.tipo}, ${v.valorHora}, ${v.valorMes}, ${v.taxaDeslocamento}, ${d.pix})
        ON CONFLICT (pessoa_id) DO UPDATE SET
          nome = EXCLUDED.nome, setor = EXCLUDED.setor, atividade = EXCLUDED.atividade, pix = EXCLUDED.pix,
          tipo = CASE WHEN ${padrao}::boolean THEN EXCLUDED.tipo ELSE financeiro_colaboradores.tipo END,
          valor_hora = CASE WHEN ${padrao}::boolean THEN EXCLUDED.valor_hora ELSE financeiro_colaboradores.valor_hora END,
          valor_mes = CASE WHEN ${padrao}::boolean THEN EXCLUDED.valor_mes ELSE financeiro_colaboradores.valor_mes END,
          taxa_deslocamento = CASE WHEN ${padrao}::boolean THEN EXCLUDED.taxa_deslocamento ELSE financeiro_colaboradores.taxa_deslocamento END`;
      await t`
        INSERT INTO financeiro_lancamentos (pessoa_id, mes, adicional, descontos, tipo, valor_hora, valor_mes, taxa_deslocamento)
        VALUES (${d.pessoaId}, ${mes}, ${d.adicional}, ${d.descontos}, ${v.tipo}, ${v.valorHora}, ${v.valorMes}, ${v.taxaDeslocamento})
        ON CONFLICT (pessoa_id, mes) DO UPDATE SET
          adicional = EXCLUDED.adicional, descontos = EXCLUDED.descontos,
          tipo = EXCLUDED.tipo, valor_hora = EXCLUDED.valor_hora,
          valor_mes = EXCLUDED.valor_mes, taxa_deslocamento = EXCLUDED.taxa_deslocamento`;
    });
    return true;
  } catch (e) {
    if (faltaMigration(e)) return false;
    throw e;
  }
}
