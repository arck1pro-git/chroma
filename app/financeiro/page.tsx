import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { carregarPonto, ehMes, mesAtual, type DadosPonto } from "@/lib/ponto";
import { temBasePonto } from "@/lib/ponto-db";
import PainelFinanceiro from "./painel";

export const metadata: Metadata = {
  title: "Financeiro · AmaanOffice",
};

export const dynamic = "force-dynamic";

// O módulo Financeiro (pedido dele, 2026-11-03). Hoje uma aba: o Ponto, lido do
// app de ponto a cada abertura (lib/ponto.ts). O mês e a pessoa moram na URL
// (?mes=AAAA-MM&pessoa=<id>), como em /videos: o link leva direto ao que se
// estava vendo. Nasce sem ninguém: o TI marca quem vê em Configurações › Acessos.
export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; pessoa?: string }>;
}) {
  await exigirModulo("financeiro");
  const { mes: pedido, pessoa } = await searchParams;
  const mes = ehMes(pedido) ? pedido : mesAtual();

  if (!temBasePonto()) return <PainelFinanceiro mes={mes} problema="sem_base" />;

  let dados: DadosPonto;
  try {
    dados = await carregarPonto(mes);
  } catch (e) {
    // A base é de outro sistema: fora do ar, a tela diz isso em vez de cair.
    console.error("[financeiro] ponto:", e);
    return <PainelFinanceiro mes={mes} problema="sem_resposta" />;
  }
  // Só vale pessoa que existe no cadastro; o resto da URL é ignorado.
  const pessoaId = dados.pessoas.some((p) => p.id === pessoa) ? (pessoa as string) : null;
  return <PainelFinanceiro mes={mes} dados={dados} pessoaId={pessoaId} />;
}
