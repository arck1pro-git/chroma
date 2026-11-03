"use server";

// Mutações do Financeiro. Hoje uma: gravar o pagamento do colaborador (o
// cadastro e o adicional e os descontos do mês), pela ficha dele na aba Ponto.
//
// Quem grava precisa do módulo E da permissão de editar nele. O colaborador
// tem que existir no app de ponto: nada vindo do navegador decide quem é.
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { conferirFolha, salvarFolha } from "@/lib/financeiro-pagamentos";
import { ehMes, existeColaborador } from "@/lib/ponto";
import { comoResultado, Recusa, type ResultadoAcao } from "@/lib/resultado-acao";

const SEM_TABELA = "As tabelas da folha ainda não existem neste banco: rode a migration-financeiro-colaboradores.sql.";

export async function salvarLinhaDaFolha(dados: {
  mes: unknown;
  pessoaId: unknown;
  setor: unknown;
  atividade: unknown;
  tipo: unknown;
  valorHora: unknown;
  valorMes: unknown;
  pix: unknown;
  adicional: unknown;
  descontos: unknown;
}): Promise<ResultadoAcao> {
  const { usuario } = await exigirModulo("financeiro");
  if (!podeOperar(usuario, "financeiro", "editar")) {
    return { ok: false, erro: "Você não tem permissão para editar no Financeiro." };
  }
  if (!ehMes(dados.mes)) return { ok: false, erro: "Mês inválido." };
  const mes = dados.mes;
  return comoResultado(async () => {
    const { cadastro, lancamento } = conferirFolha(dados);
    if (!(await existeColaborador(cadastro.pessoaId))) throw new Recusa("Este colaborador não está no app de ponto.");
    if (!(await salvarFolha(cadastro, mes, lancamento))) throw new Recusa(SEM_TABELA);
    revalidatePath("/financeiro");
  });
}
