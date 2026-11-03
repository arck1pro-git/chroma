import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { carregarFolha } from "@/lib/financeiro-pagamentos";
import { carregarPonto, ehMes, mesAtual } from "@/lib/ponto";
import { temBasePonto } from "@/lib/ponto-db";
import PainelFinanceiro from "./painel";

export const metadata: Metadata = {
  title: "Financeiro · AmaanOffice",
};

export const dynamic = "force-dynamic";

// O módulo Financeiro (pedido dele, 2026-11-03): o ponto da equipe, lido do app
// de ponto a cada abertura (lib/ponto.ts), e a folha do mês
// (lib/financeiro-pagamentos.ts), que usa as horas do ponto como referência. O
// mês e a pessoa moram na URL (?mes=AAAA-MM&pessoa=<id>), como em /videos: o
// link leva direto ao que se estava vendo. Nasce sem ninguém: o TI marca quem
// vê em Configurações › Acessos; editar o pagamento pede a operação "editar".
export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; pessoa?: string }>;
}) {
  const { usuario } = await exigirModulo("financeiro");
  const { mes: pedido, pessoa } = await searchParams;
  const mes = ehMes(pedido) ? pedido : mesAtual();
  const podeEditar = podeOperar(usuario, "financeiro", "editar");

  if (!temBasePonto()) return <PainelFinanceiro mes={mes} problema="sem_base" />;

  const [dados, folha] = await Promise.all([
    // A base do ponto é de outro sistema: fora do ar, a tela diz isso em vez de cair.
    carregarPonto(mes).catch((e) => {
      console.error("[financeiro] ponto:", e);
      return null;
    }),
    carregarFolha(mes),
  ]);
  if (!dados) return <PainelFinanceiro mes={mes} problema="sem_resposta" />;

  // Só vale pessoa que existe no cadastro do ponto; o resto da URL é ignorado.
  const pessoaId = dados.pessoas.some((p) => p.id === pessoa) ? (pessoa as string) : null;
  return <PainelFinanceiro mes={mes} dados={dados} folha={folha} pessoaId={pessoaId} podeEditar={podeEditar} />;
}
