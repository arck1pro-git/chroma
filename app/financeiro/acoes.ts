"use server";

// Mutação do Financeiro: salvarLinhaDaFolha, chamada pela gaveta do pagamento
// (./gaveta-pagamento.tsx), que abre por cima da folha no Editar e no
// "Adicionar colaborador" (2026-11-04). Grava nome (de quem é cadastrado à
// mão), setor, atividade, PIX, tipo, valor hora, valor mês, se o deslocamento
// conta (o check; o valor do dia é a regra do servidor), adicional e descontos
// do mês. Recarrega a página, porque o
// setor muda o agrupamento da folha. Grava a foto do mês aberto; o padrão do
// cadastro só muda no mês corrente ou num futuro (lib/financeiro-pagamentos.ts).
//
// Quem grava precisa do módulo E da permissão de editar nele. O colaborador
// tem que existir no app de ponto, no AmaanOffice ou na folha; o cadastrado à
// mão novo ganha o id no servidor (`resolverColaborador`), e a ação devolve o
// id gravado para a tela marcar a linha. Nada vindo do navegador decide quem é.
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { colaboradorExiste, conferirFicha, marcarCheck, resolverColaborador, salvarFicha } from "@/lib/financeiro-pagamentos";
import { CHECKS_DA_FOLHA, type CheckDaFolha } from "@/lib/financeiro-tipos";
import { ehMes, mesAtual } from "@/lib/ponto";
import { comoResultado, Recusa, type ResultadoAcao } from "@/lib/resultado-acao";

const SEM_TABELA = "A folha ainda não está pronta neste banco: falta rodar as migrations do Financeiro.";
const SEM_PERMISSAO = "Você não tem permissão para editar no Financeiro.";

export async function salvarLinhaDaFolha(dados: {
  mes: unknown;
  pessoaId: unknown;
  nome: unknown;
  setor: unknown;
  atividade: unknown;
  tipo: unknown;
  valorHora: unknown;
  valorMes: unknown;
  deslocamento: unknown;
  pix: unknown;
  adicional: unknown;
  descontos: unknown;
}): Promise<ResultadoAcao<{ pessoaId: string }>> {
  const { usuario } = await exigirModulo("financeiro");
  if (!podeOperar(usuario, "financeiro", "editar")) return { ok: false, erro: SEM_PERMISSAO };
  if (!ehMes(dados.mes)) return { ok: false, erro: "Mês inválido." };
  const mes = dados.mes;
  return comoResultado(async () => {
    const ficha = conferirFicha(dados);
    const pessoaId = await resolverColaborador(ficha.pessoaId);
    if (!pessoaId) throw new Recusa("Este colaborador não está no app de ponto, no AmaanOffice nem na folha.");
    if (!(await salvarFicha(mes, { ...ficha, pessoaId }, mes >= mesAtual()))) throw new Recusa(SEM_TABELA);
    revalidatePath("/financeiro");
    return { pessoaId };
  });
}

/**
 * Marca ou desmarca um dos três checks do mês (validação da Patricia, NF do
 * prestador, pagamento enviado; 2026-11-04). Quem tem Editar no Financeiro
 * marca; a ordem é conferida no servidor (marcarCheck). Quem marcou é a conta
 * da sessão, nunca o que o navegador diz.
 */
export async function marcarCheckDaFolha(dados: { mes: unknown; pessoaId: unknown; check: unknown; marcar: unknown }): Promise<ResultadoAcao> {
  const { usuario } = await exigirModulo("financeiro");
  if (!podeOperar(usuario, "financeiro", "editar")) return { ok: false, erro: SEM_PERMISSAO };
  const { mes, pessoaId, check, marcar } = dados;
  if (!ehMes(mes)) return { ok: false, erro: "Mês inválido." };
  if (!CHECKS_DA_FOLHA.includes(check as CheckDaFolha) || typeof marcar !== "boolean") return { ok: false, erro: "Check inválido." };
  if (typeof pessoaId !== "string" || !pessoaId || pessoaId.length > 64) return { ok: false, erro: "Colaborador inválido." };
  return comoResultado(async () => {
    if (!(await colaboradorExiste(pessoaId))) throw new Recusa("Este colaborador não está no app de ponto, no AmaanOffice nem na folha.");
    if (!(await marcarCheck(mes, pessoaId, check as CheckDaFolha, marcar, usuario.id))) throw new Recusa(SEM_TABELA);
    revalidatePath("/financeiro");
  });
}
