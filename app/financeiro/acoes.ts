"use server";

// Mutação do Financeiro: salvarLinhaDaFolha, chamada pela gaveta do pagamento
// (./gaveta-pagamento.tsx), que abre por cima da folha no Editar e no
// "Adicionar colaborador" (2026-11-04). Grava setor, atividade, PIX, tipo,
// valor hora, valor mês, taxa de deslocamento, adicional e descontos do mês.
// Recarrega a página, porque o setor muda o agrupamento da folha.
// Grava a foto do mês aberto; o padrão do cadastro só muda no mês corrente ou
// num futuro (lib/financeiro-pagamentos.ts).
//
// Quem grava precisa do módulo E da permissão de editar nele. O colaborador
// tem que existir no app de ponto ou no AmaanOffice: nada vindo do navegador
// decide quem é.
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { colaboradorExiste, conferirFicha, salvarFicha } from "@/lib/financeiro-pagamentos";
import { ehMes, mesAtual } from "@/lib/ponto";
import { comoResultado, Recusa, type ResultadoAcao } from "@/lib/resultado-acao";

const SEM_TABELA = "A folha ainda não está pronta neste banco: falta rodar as migrations do Financeiro.";
const SEM_PERMISSAO = "Você não tem permissão para editar no Financeiro.";

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
    if (!(await colaboradorExiste(ficha.pessoaId))) throw new Recusa("Este colaborador não está no app de ponto nem no AmaanOffice.");
    if (!(await salvarFicha(mes, ficha, mes >= mesAtual()))) throw new Recusa(SEM_TABELA);
    revalidatePath("/financeiro");
  });
}
