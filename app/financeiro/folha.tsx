// A folha do mês, no topo do Financeiro (2026-11-04: o cabeçalho com o
// "Adicionar colaborador", a folha logo abaixo e o Ponto embaixo dela): o que
// pagar a cada profissional, agrupado por setor, com o total do setor e o total
// dos pagamentos do pessoal. Aqui, no servidor, só se montam as linhas; a
// tabela e a gaveta do pagamento são do navegador (./area-da-folha.tsx).
//
// Cada linha leva os valores QUE VALEM NO MÊS (a foto do mês, ou o padrão do
// colaborador se o mês ainda não foi lançado, lib/financeiro-tipos.ts), as
// horas e os dias presenciais do ponto, o adicional e os descontos do mês.
//
// Aparece quem bateu ponto no mês OU tem cadastro na folha (o fixo recebe mesmo
// sem batida), venha do app de ponto ou de uma conta do AmaanOffice. O
// "Adicionar colaborador" oferece os demais cadastros do app de ponto e as
// contas ativas do AmaanOffice que ainda não estão na folha; a conta com o
// mesmo e-mail de alguém do ponto fica de fora, porque é a mesma pessoa e pelo
// ponto ela entra com as horas.
import type { ReactNode } from "react";
import type { Folha } from "@/lib/financeiro-pagamentos";
import { origemDe, SEM_LANCAMENTO, valoresDoMes } from "@/lib/financeiro-tipos";
import { mesAtual, type DadosPonto } from "@/lib/ponto";
import { AlertTriangle } from "@/app/components/icones";
import AreaDaFolha from "./area-da-folha";
import { CabecalhoFinanceiro, cartao, nomeDoMes } from "./comum";
import type { LinhaFolha } from "./tabela-da-folha";

export default function FolhaDoMes({
  dados,
  folha,
  podeEditar,
  legenda,
  navegacao,
}: {
  dados: DadosPonto;
  /** null = falta rodar as migrations da folha neste banco. */
  folha: Folha | null;
  podeEditar: boolean;
  legenda: ReactNode;
  navegacao: ReactNode;
}) {
  if (!folha) {
    return (
      <>
        <CabecalhoFinanceiro legenda={legenda} navegacao={navegacao} />
        <p className={`${cartao} flex items-start gap-2 px-4 py-3 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300`}>
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          A folha ainda não está disponível neste banco: falta rodar as migrations do Financeiro.
        </p>
      </>
    );
  }

  const resumo = new Map(dados.resumos.map((r) => [r.pessoaId, r]));
  const linhaDe = (p: { id: string; nome: string }): LinhaFolha => {
    const cadastro = folha.cadastros.get(p.id) ?? null;
    const lancamento = folha.lancamentos.get(p.id) ?? SEM_LANCAMENTO;
    const r = resumo.get(p.id);
    return {
      pessoa: { id: p.id, nome: p.nome },
      origem: origemDe(p.id),
      temCadastro: Boolean(cadastro),
      setor: cadastro?.setor ?? null,
      atividade: cadastro?.atividade ?? null,
      pix: cadastro?.pix ?? null,
      valores: valoresDoMes(cadastro, lancamento),
      daFoto: Boolean(lancamento.valores),
      adicional: lancamento.adicional,
      descontos: lancamento.descontos,
      minutos: r?.minutos ?? 0,
      presencial: r?.presencial ?? 0,
      pendencias: r?.pendencias ?? 0,
    };
  };
  const naFolha = (p: { id: string }) => resumo.has(p.id) || folha.cadastros.has(p.id);
  const emailsDoPonto = new Set(dados.pessoas.map((p) => p.email?.trim().toLowerCase()).filter(Boolean));
  const contaParaAdicionar = (c: Folha["contas"][number]) =>
    c.ativo && !folha.cadastros.has(c.id) && !(c.email && emailsDoPonto.has(c.email.trim().toLowerCase()));
  const setores = [...new Set([...folha.cadastros.values()].map((c) => c.setor).filter((s): s is string => Boolean(s)))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  return (
    <AreaDaFolha
      mes={dados.mes}
      mesNome={nomeDoMes(dados.mes)}
      linhas={[...dados.pessoas.filter(naFolha), ...folha.contas.filter((c) => folha.cadastros.has(c.id))].map(linhaDe)}
      fora={[...dados.pessoas.filter((p) => !naFolha(p)), ...folha.contas.filter(contaParaAdicionar)].map(linhaDe)}
      setores={setores}
      mudaPadrao={dados.mes >= mesAtual()}
      podeEditar={podeEditar}
      legenda={legenda}
      navegacao={navegacao}
    />
  );
}
