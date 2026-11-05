import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { carregarFolha, resumoDosMeses } from "@/lib/financeiro-pagamentos";
import { carregarPonto, ehMes, mesAtual, mesesComPonto } from "@/lib/ponto";
import { temBasePonto } from "@/lib/ponto-db";
import EscolherMes from "./escolher-mes";
import PainelFinanceiro from "./painel";

export const metadata: Metadata = {
  title: "Financeiro · AmaanOffice",
};

export const dynamic = "force-dynamic";

// O módulo Financeiro (pedido dele, 2026-11-03): o ponto da equipe, lido do app
// de ponto a cada abertura (lib/ponto.ts), e a folha do mês
// (lib/financeiro-pagamentos.ts), que usa as horas do ponto como referência. O
// mês e a pessoa moram na URL (?mes=AAAA-MM&pessoa=<id>), como em /videos: o
// link leva direto ao que se estava vendo. Sem ?mes=, a primeira tela é a
// escolha do mês de competência (./escolher-mes.tsx). Nasce sem ninguém: o TI marca quem
// vê em Configurações › Acessos; editar o pagamento pede a operação "editar".
export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; pessoa?: string }>;
}) {
  const { usuario } = await exigirModulo("financeiro");
  const { mes: pedido, pessoa } = await searchParams;
  const podeEditar = podeOperar(usuario, "financeiro", "editar");

  // Sem mês na URL, a escolha do mês de competência (2026-11-05): a página não
  // entra mais sozinha no mês corrente.
  if (!ehMes(pedido)) {
    const atual = mesAtual();
    const [doPonto, resumos] = await Promise.all([
      temBasePonto()
        ? mesesComPonto().catch((e) => {
            console.error("[financeiro] meses do ponto:", e);
            return [] as string[];
          })
        : Promise.resolve([] as string[]),
      resumoDosMeses(),
    ]);
    const anterior = mesAtual(new Date(Date.UTC(Number(atual.slice(0, 4)), Number(atual.slice(5, 7)) - 2, 15)));
    const meses = [...new Set([atual, anterior, ...doPonto, ...resumos.keys()])].filter(ehMes).sort().reverse();
    return (
      <EscolherMes
        atual={atual}
        meses={meses.map((m) => ({ mes: m, resumo: resumos.get(m) ?? null, temPonto: doPonto.includes(m) }))}
      />
    );
  }
  const mes = pedido;

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
