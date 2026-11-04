// A folha do pessoal, sem nada de servidor: a tela (a prévia e os totais que
// mudam enquanto se digita) e o servidor (lib/financeiro-pagamentos.ts) fazem a
// MESMA conta por aqui.
//
// OS VALORES SÃO DO MÊS (2026-11-04): o tipo, o valor hora, o valor mês e a
// taxa de deslocamento com que um mês foi lançado ficam nele (a "foto" em
// LancamentoMes.valores). Mês sem foto usa o padrão do cadastro do colaborador.

export type TipoPagamento = "hora" | "fixo";

// O COLABORADOR DA FOLHA vem de um de dois lugares (2026-11-04, "sendo ele do
// ponto ou do amaanoffice"): o app de ponto (o id do cadastro de lá, como
// sempre) ou uma conta do AmaanOffice que não bate ponto, gravada como
// "amaanoffice:<id do usuário>". Assim o pessoa_id diz de onde a pessoa vem e
// o nome sai da fonte, sem coluna nova.
export const PREFIXO_AMAANOFFICE = "amaanoffice:";

// OU CADASTRADO À MÃO (2026-11-04, "para poder cadastrar um também"): quem não
// está em nenhum dos dois ganha o id "manual:<uuid>", sorteado pelo servidor, e
// o nome fica no cadastro da folha (migration-financeiro-nome.sql). A gaveta
// manda `NOVO_MANUAL` para pedir um id novo.
export const PREFIXO_MANUAL = "manual:";
export const NOVO_MANUAL = `${PREFIXO_MANUAL}novo`;

export type OrigemColaborador = "ponto" | "amaanoffice" | "manual";

export function origemDe(pessoaId: string): OrigemColaborador {
  return pessoaId.startsWith(PREFIXO_AMAANOFFICE) ? "amaanoffice" : pessoaId.startsWith(PREFIXO_MANUAL) ? "manual" : "ponto";
}

// O DIA PRESENCIAL VALE R$ 15 A MAIS (2026-11-04, "tem que usar a modalidade
// para calcular o adicional. cada presencial é 15 a mais"): o deslocamento do
// mês é a taxa × os dias com modalidade presencial no ponto, e a taxa de quem
// não tem uma gravada (os cadastros e meses de antes da regra) é esta. Taxa 0 =
// não recebe. Desde 2026-11-04 quem decide é o check "Contabilizar
// deslocamento" do cadastro: marcado grava esta taxa, desmarcado grava 0. Salvar
// grava a taxa que valeu, para o mês lançado não mudar se a regra mudar
// (lib/financeiro-pagamentos.ts).
export const TAXA_PRESENCIAL = 15;

/** O que decide a conta: o tipo, os dois valores e a taxa por dia presencial (null = `TAXA_PRESENCIAL`; 0 = não recebe). */
export type ValoresPagamento = {
  tipo: TipoPagamento;
  valorHora: number | null;
  valorMes: number | null;
  taxaDeslocamento: number | null;
};

/** O cadastro do colaborador: os valores PADRÃO (os dos meses ainda não lançados) e o que não muda por mês. */
export type CadastroPagamento = ValoresPagamento & {
  /** O id do cadastro no app de ponto, "amaanoffice:<id do usuário>" ou "manual:<uuid>" (`origemDe`). */
  pessoaId: string;
  /** Só de quem foi cadastrado à mão; do ponto e do AmaanOffice o nome vem da fonte (null). */
  nome: string | null;
  setor: string | null;
  atividade: string | null;
  pix: string | null;
};

/** O que é lançado em cada mês. `valores`: a foto do mês (null = mês ainda não lançado, vale o padrão). */
export type LancamentoMes = { adicional: number; descontos: number; valores: ValoresPagamento | null };

export const SEM_LANCAMENTO: LancamentoMes = { adicional: 0, descontos: 0, valores: null };

// OS TRÊS CHECKS DO MÊS (2026-11-04): a Patricia validou, o prestador enviou a
// NF, o pagamento foi enviado. Em sequência (decisão dele): marca-se na ordem e
// desmarca-se do último para o primeiro. A tela e o servidor
// (lib/financeiro-pagamentos.ts, marcarCheck) seguem a mesma regra.
export const CHECKS_DA_FOLHA = ["validado", "nf", "pago"] as const;
export type CheckDaFolha = (typeof CHECKS_DA_FOLHA)[number];

export const ROTULO_CHECK: Record<CheckDaFolha, { curto: string; longo: string }> = {
  validado: { curto: "Validado", longo: "Validado pela Patricia" },
  nf: { curto: "NF", longo: "NF enviada pelo prestador" },
  pago: { curto: "Pago", longo: "Pagamento enviado" },
};

/** Quando foi marcado (instante ISO) e por quem (o nome da conta; null se a conta sumiu). */
export type MarcaDoCheck = { em: string; por: string | null };
export type ChecksDoMes = Record<CheckDaFolha, MarcaDoCheck | null>;

export const SEM_CHECKS: ChecksDoMes = { validado: null, nf: null, pago: null };

/**
 * O check pode mudar agora? Marcar pede o anterior marcado; desmarcar pede o
 * seguinte desmarcado. Devolve null (pode) ou a frase do motivo.
 */
export function motivoParaNaoMudar(checks: ChecksDoMes, check: CheckDaFolha): string | null {
  const i = CHECKS_DA_FOLHA.indexOf(check);
  const anterior = CHECKS_DA_FOLHA[i - 1];
  const seguinte = CHECKS_DA_FOLHA[i + 1];
  if (checks[check]) return seguinte && checks[seguinte] ? `Desmarque antes: ${ROTULO_CHECK[seguinte].longo.toLowerCase()}.` : null;
  return anterior && !checks[anterior] ? `Falta antes: ${ROTULO_CHECK[anterior].longo.toLowerCase()}.` : null;
}

/**
 * Setor da casa da Pati (2026-11-04, "deixar o pessoal dos setores da casa da
 * Pati por último"): o que tem a palavra "casa" no nome, sem olhar acento nem
 * maiúscula. Vai para o fim da folha e da lista de horas do Ponto.
 */
export function ehSetorDaCasa(setor: string | null | undefined): boolean {
  if (!setor) return false;
  return /\bcasa\b/.test(setor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
}

/** O grupo de quem está sem setor na folha. */
export const SEM_SETOR = "Sem setor";

/** A ordem dos setores na folha: os demais em ordem alfabética, depois "Sem setor" e, por último, os da casa. */
export function compararSetores(a: string, b: string): number {
  const peso = (setor: string) => (ehSetorDaCasa(setor) ? 2 : setor === SEM_SETOR ? 1 : 0);
  return peso(a) - peso(b) || a.localeCompare(b, "pt-BR");
}

/** Os valores que valem no mês: a foto dele, ou o padrão do cadastro. null = sem cadastro. */
export function valoresDoMes(cadastro: CadastroPagamento | null | undefined, lancamento: LancamentoMes | null | undefined): ValoresPagamento | null {
  if (lancamento?.valores) return lancamento.valores;
  if (!cadastro) return null;
  return { tipo: cadastro.tipo, valorHora: cadastro.valorHora, valorMes: cadastro.valorMes, taxaDeslocamento: cadastro.taxaDeslocamento };
}

/** O valor de cada dia presencial: a taxa gravada, ou a da regra (`TAXA_PRESENCIAL`). */
export function taxaPresencial(valores: Pick<ValoresPagamento, "taxaDeslocamento">): number {
  return valores.taxaDeslocamento ?? TAXA_PRESENCIAL;
}

/**
 * A conta do profissional no mês: a base (por hora, horas × valor hora; fixo, o
 * valor mês, trabalhe quanto trabalhar), mais o deslocamento (taxa × dias com
 * modalidade presencial no ponto), mais o adicional, menos os descontos. `base`
 * e `total` são null quando falta o cadastro ou o valor do tipo.
 */
export function contaDoMes(
  valores: ValoresPagamento | null | undefined,
  minutos: number,
  diasPresenciais: number,
  lancamento: Pick<LancamentoMes, "adicional" | "descontos"> = SEM_LANCAMENTO,
): { base: number | null; deslocamento: number; adicional: number; descontos: number; total: number | null } {
  const base = !valores
    ? null
    : valores.tipo === "fixo"
      ? valores.valorMes
      : valores.valorHora === null
        ? null
        : centavos((minutos / 60) * valores.valorHora);
  const deslocamento = valores ? centavos(taxaPresencial(valores) * diasPresenciais) : 0;
  const { adicional, descontos } = lancamento;
  return { base, deslocamento, adicional, descontos, total: base === null ? null : centavos(base + deslocamento + adicional - descontos) };
}

function centavos(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 25.5 → "25,50" (o valor no campo de digitar). */
export function paraCampo(v: number | null): string {
  return v === null ? "" : v.toFixed(2).replace(".", ",");
}

/**
 * O valor digitado em reais, como se escreve no Brasil ("1.500,00", "25,5" ou
 * "25.50"): número, null (vazio) ou undefined (não é um valor).
 */
export function lerReais(texto: string): number | null | undefined {
  const s = texto.replace(/[R$\s]/g, "");
  if (!s) return null;
  // Com vírgula, ela é o decimal e os pontos são milhar; sem vírgula, um ponto com até dois dígitos depois é decimal.
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d+\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, "");
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

const REAIS = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 1234.5 → "R$ 1.234,50". */
export function reais(valor: number): string {
  return REAIS.format(valor);
}
