"use server";

// Mutações do Financeiro, as duas pelo salvamento automático da tela:
//   · salvarPagamentoDaLinha — tipo, valor hora, valor mês e PIX, direto na
//     linha da folha. Não recarrega a página: a tela já refaz os totais
//     sozinha, e recarregar tirava o foco de quem segue digitando na próxima
//     linha (2026-11-04, "ta muito travada");
//   · salvarLinhaDaFolha — a ficha do colaborador: tudo da linha, mais setor,
//     atividade, taxa de deslocamento, adicional e descontos do mês. Recarrega a
//     página, porque o setor muda o agrupamento da folha.
// As duas gravam a foto do mês aberto; o padrão do cadastro só muda no mês
// corrente ou num futuro (lib/financeiro-pagamentos.ts).
//
// Quem grava precisa do módulo E da permissão de editar nele. O colaborador
// tem que existir no app de ponto: nada vindo do navegador decide quem é.
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { conferirFicha, conferirLinha, salvarFicha, salvarLinha } from "@/lib/financeiro-pagamentos";
import { ehMes, existeColaborador, mesAtual } from "@/lib/ponto";
import { comoResultado, Recusa, type ResultadoAcao } from "@/lib/resultado-acao";

const SEM_TABELA = "A folha ainda não está pronta neste banco: falta rodar as migrations do Financeiro.";
const SEM_PERMISSAO = "Você não tem permissão para editar no Financeiro.";

export async function salvarPagamentoDaLinha(dados: {
  mes: unknown;
  pessoaId: unknown;
  tipo: unknown;
  valorHora: unknown;
  valorMes: unknown;
  taxaDeslocamento: unknown;
  pix: unknown;
}): Promise<ResultadoAcao> {
  const { usuario } = await exigirModulo("financeiro");
  if (!podeOperar(usuario, "financeiro", "editar")) return { ok: false, erro: SEM_PERMISSAO };
  if (!ehMes(dados.mes)) return { ok: false, erro: "Mês inválido." };
  const mes = dados.mes;
  return comoResultado(async () => {
    const linha = conferirLinha(dados);
    if (!(await existeColaborador(linha.pessoaId))) throw new Recusa("Este colaborador não está no app de ponto.");
    if (!(await salvarLinha(mes, linha, mes >= mesAtual()))) throw new Recusa(SEM_TABELA);
  });
}

export async function salvarLinhaDaFolha(dados: {
  mes: unknown;
  pessoaId: unknown;
  setor: unknown;
  atividade: unknown;
  tipo: unknown;
  valorHora: unknown;
  valorMes: unknown;
  taxaDeslocamento: unknown;
  pix: unknown;
  adicional: unknown;
  descontos: unknown;
}): Promise<ResultadoAcao> {
  const { usuario } = await exigirModulo("financeiro");
  if (!podeOperar(usuario, "financeiro", "editar")) return { ok: false, erro: SEM_PERMISSAO };
  if (!ehMes(dados.mes)) return { ok: false, erro: "Mês inválido." };
  const mes = dados.mes;
  return comoResultado(async () => {
    const ficha = conferirFicha(dados);
    if (!(await existeColaborador(ficha.pessoaId))) throw new Recusa("Este colaborador não está no app de ponto.");
    if (!(await salvarFicha(mes, ficha, mes >= mesAtual()))) throw new Recusa(SEM_TABELA);
    revalidatePath("/financeiro");
  });
}
