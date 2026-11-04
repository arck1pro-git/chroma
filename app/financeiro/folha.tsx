// A folha do mês, embaixo do Ponto (pedido dele, 2026-11-03): o que pagar a
// cada profissional, agrupado por setor, com o total do setor e o total dos
// pagamentos do pessoal. Aqui, no servidor, só se montam as linhas; a tabela
// (./tabela-da-folha.tsx) é do navegador, para os totais acompanharem o que se
// digita sem recarregar a página.
//
// Cada linha leva os valores QUE VALEM NO MÊS (a foto do mês, ou o padrão do
// colaborador se o mês ainda não foi lançado, lib/financeiro-tipos.ts), as
// horas e os dias presenciais do ponto, o adicional e os descontos do mês.
//
// Aparece quem bateu ponto no mês OU tem cadastro na folha (o fixo recebe mesmo
// sem batida). Os demais cadastros do app de ponto ficam numa linha embaixo.
import { createHash } from "node:crypto";
import type { Folha } from "@/lib/financeiro-pagamentos";
import { SEM_LANCAMENTO, valoresDoMes } from "@/lib/financeiro-tipos";
import type { DadosPonto } from "@/lib/ponto";
import { AlertTriangle } from "@/app/components/icones";
import { cartao, nomeDoMes } from "./comum";
import TabelaDaFolha, { type LinhaFolha } from "./tabela-da-folha";

export default function FolhaDoMes({
  dados,
  folha,
  pessoaId,
  podeEditar,
}: {
  dados: DadosPonto;
  /** null = falta rodar as migrations da folha neste banco. */
  folha: Folha | null;
  pessoaId: string | null;
  podeEditar: boolean;
}) {
  if (!folha) {
    return (
      <p className={`${cartao} flex items-start gap-2 px-4 py-3 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300`}>
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
        A folha ainda não está disponível neste banco: falta rodar as migrations do Financeiro.
      </p>
    );
  }

  const resumo = new Map(dados.resumos.map((r) => [r.pessoaId, r]));
  const linhas: LinhaFolha[] = dados.pessoas
    .filter((p) => resumo.has(p.id) || folha.cadastros.has(p.id))
    .map((p) => {
      const cadastro = folha.cadastros.get(p.id) ?? null;
      const lancamento = folha.lancamentos.get(p.id) ?? SEM_LANCAMENTO;
      const r = resumo.get(p.id);
      return {
        pessoa: { id: p.id, nome: p.nome },
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
    });
  const fora = dados.pessoas.filter((p) => !resumo.has(p.id) && !folha.cadastros.has(p.id)).map((p) => ({ id: p.id, nome: p.nome }));
  // O que veio do servidor, resumido: quando muda (a ficha salvou, outro mês), a tabela recomeça dele.
  const versao = createHash("sha1").update(JSON.stringify([dados.mes, linhas])).digest("hex").slice(0, 12);

  return (
    <TabelaDaFolha
      key={versao}
      mes={dados.mes}
      mesNome={nomeDoMes(dados.mes)}
      linhas={linhas}
      fora={fora}
      pessoaId={pessoaId}
      podeEditar={podeEditar}
    />
  );
}
