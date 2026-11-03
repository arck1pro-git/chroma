import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { carregarFolha } from "@/lib/financeiro-pagamentos";
import { carregarPonto, ehMes, mesAtual } from "@/lib/ponto";
import { temBasePonto } from "@/lib/ponto-db";
import type { Aba } from "./comum";
import PainelFinanceiro from "./painel";

export const metadata: Metadata = {
  title: "Financeiro · AmaanOffice",
};

export const dynamic = "force-dynamic";

// O módulo Financeiro (pedido dele, 2026-11-03), em duas abas: o Ponto, lido do
// app de ponto a cada abertura (lib/ponto.ts), e a Folha, com o que pagar a
// cada profissional (lib/financeiro-pagamentos.ts), que usa as horas do ponto
// como referência. A aba, o mês e a pessoa moram na URL
// (?aba=folha&mes=AAAA-MM&pessoa=<id>), como em /videos: o link leva direto ao
// que se estava vendo. Nasce sem ninguém: o TI marca quem vê em Configurações ›
// Acessos; editar a folha pede a operação "editar" do módulo.
export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; mes?: string; pessoa?: string }>;
}) {
  const { usuario } = await exigirModulo("financeiro");
  const { aba: abaPedida, mes: pedido, pessoa } = await searchParams;
  const aba: Aba = abaPedida === "folha" ? "folha" : "ponto";
  const mes = ehMes(pedido) ? pedido : mesAtual();
  const podeEditar = podeOperar(usuario, "financeiro", "editar");

  if (!temBasePonto()) return <PainelFinanceiro aba={aba} mes={mes} problema="sem_base" />;

  const [dados, folha] = await Promise.all([
    // A base do ponto é de outro sistema: fora do ar, a tela diz isso em vez de cair.
    carregarPonto(mes).catch((e) => {
      console.error("[financeiro] ponto:", e);
      return null;
    }),
    aba === "folha" ? carregarFolha(mes) : Promise.resolve(undefined),
  ]);
  if (!dados) return <PainelFinanceiro aba={aba} mes={mes} problema="sem_resposta" />;

  // Só vale pessoa que existe no cadastro do ponto; o resto da URL é ignorado.
  const pessoaId = dados.pessoas.some((p) => p.id === pessoa) ? (pessoa as string) : null;
  return <PainelFinanceiro aba={aba} mes={mes} dados={dados} folha={folha} pessoaId={pessoaId} podeEditar={podeEditar} />;
}
