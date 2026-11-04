"use client";

// A tabela da folha do mês, no navegador: as linhas por setor
// (./linha-da-folha.tsx), o total de cada setor, o total dos pagamentos do
// pessoal e, no cabeçalho, o resumo (base, deslocamento, adicionais,
// descontos). Os totais saem do que está digitado em cada linha, na hora, pela
// mesma conta do servidor (lib/financeiro-tipos.ts): salvar uma linha não
// recarrega a página (2026-11-04, "ta muito travada").
//
// Quando o servidor manda outra coisa (a ficha salvou, outro mês), a tabela é
// montada de novo com a `key` que ./folha.tsx calcula.
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { contaDoMes, reais, type ValoresPagamento } from "@/lib/financeiro-tipos";
import { cartao, endereco } from "./comum";
import LinhaDaFolha from "./linha-da-folha";

export type LinhaFolha = {
  pessoa: { id: string; nome: string };
  setor: string | null;
  atividade: string | null;
  pix: string | null;
  /** Os valores que valem no mês (a foto do mês ou o padrão do colaborador); null = sem cadastro. */
  valores: ValoresPagamento | null;
  /** O mês já foi lançado com estes valores (tem foto). */
  daFoto: boolean;
  adicional: number;
  descontos: number;
  minutos: number;
  presencial: number;
  pendencias: number;
};

const SEM_SETOR = "Sem setor";

function Resumo({ rotulo, valor, destaque = false }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{rotulo}</p>
      <p className={`tabular-nums tracking-tight ${destaque ? "text-[17px] font-semibold text-zinc-900 dark:text-zinc-50" : "text-[13px] font-medium text-zinc-700 dark:text-zinc-300"}`}>{valor}</p>
    </div>
  );
}

export default function TabelaDaFolha({
  mes,
  mesNome,
  linhas,
  fora,
  pessoaId,
  podeEditar,
}: {
  mes: string;
  mesNome: string;
  linhas: LinhaFolha[];
  fora: Array<{ id: string; nome: string }>;
  pessoaId: string | null;
  podeEditar: boolean;
}) {
  // O que cada linha tem digitado agora (começa no que veio do servidor).
  const [valores, setValores] = useState<Record<string, ValoresPagamento | null>>(() => Object.fromEntries(linhas.map((l) => [l.pessoa.id, l.valores])));
  const aoMudar = useCallback((id: string, v: ValoresPagamento | null) => setValores((atual) => (atual[id] === v ? atual : { ...atual, [id]: v })), []);

  const contas = useMemo(
    () => new Map(linhas.map((l) => [l.pessoa.id, contaDoMes(valores[l.pessoa.id], l.minutos, l.presencial, l)])),
    [linhas, valores],
  );
  const porSetor = useMemo(() => {
    const grupos = new Map<string, LinhaFolha[]>();
    for (const l of linhas) grupos.set(l.setor ?? SEM_SETOR, [...(grupos.get(l.setor ?? SEM_SETOR) ?? []), l]);
    for (const g of grupos.values()) g.sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"));
    return [...grupos.entries()].sort(([a], [b]) => (a === SEM_SETOR ? 1 : b === SEM_SETOR ? -1 : a.localeCompare(b, "pt-BR")));
  }, [linhas]);

  const comTotal = linhas.filter((l) => contas.get(l.pessoa.id)?.total !== null);
  const soma = (ls: LinhaFolha[], campo: "total" | "base" | "deslocamento" | "adicional" | "descontos") =>
    ls.reduce((s, l) => s + (contas.get(l.pessoa.id)?.[campo] ?? 0), 0);
  const semValor = linhas.length - comTotal.length;
  const colunas = 8;

  return (
    <section className={cartao}>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-zinc-100 px-4 py-3.5 dark:border-zinc-800">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Folha de {mesNome.toLowerCase()}</h2>
          <p className="mt-0.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
            {podeEditar ? "Tipo, valores e PIX direto na linha, salvos sozinhos. Setor, deslocamento e lançamentos na ficha (clique no nome)." : "Clique no nome para ver o andamento."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <Resumo rotulo="Base" valor={reais(soma(comTotal, "base"))} />
          <Resumo rotulo="Deslocamento" valor={reais(soma(comTotal, "deslocamento"))} />
          <Resumo rotulo="Adicionais" valor={reais(soma(comTotal, "adicional"))} />
          <Resumo rotulo="Descontos" valor={`− ${reais(soma(comTotal, "descontos"))}`} />
          <Resumo rotulo={semValor ? `Total · ${semValor} sem valor` : "Total do pessoal"} valor={reais(soma(comTotal, "total"))} destaque />
        </div>
      </header>

      {linhas.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-zinc-500 dark:text-zinc-400">Ninguém bateu ponto nem tem cadastro na folha neste mês.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-2 pl-4 pr-2 font-medium">Profissional</th>
                <th className="px-1.5 py-2 font-medium">Tipo</th>
                <th className="px-1.5 py-2 text-right font-medium">Valor hora</th>
                <th className="px-1.5 py-2 text-right font-medium">Valor mês</th>
                <th className="px-1.5 py-2 text-right font-medium">Referência</th>
                <th className="px-1.5 py-2 text-right font-medium">Adicionais</th>
                <th className="px-1.5 py-2 text-right font-medium">Descontos</th>
                <th className="py-2 pl-1.5 pr-4 text-right font-medium">Valor total</th>
              </tr>
            </thead>
            {porSetor.map(([setor, doSetor]) => (
              <tbody key={setor} className="divide-y divide-zinc-100 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                <tr className="bg-zinc-50/80 dark:bg-zinc-800/40">
                  <th colSpan={colunas - 1} scope="rowgroup" className="px-4 py-1.5 text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">
                    {setor} <span className="font-normal text-zinc-400 dark:text-zinc-500">· {doSetor.length}</span>
                  </th>
                  <td className="whitespace-nowrap px-4 py-1.5 text-right text-[12px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                    <span className="mr-1.5 font-normal text-zinc-400 dark:text-zinc-500">total do setor</span>
                    {reais(soma(doSetor, "total"))}
                  </td>
                </tr>
                {doSetor.map((l) => (
                  <LinhaDaFolha
                    key={l.pessoa.id}
                    mes={mes}
                    linha={l}
                    conta={contas.get(l.pessoa.id)!}
                    ativa={l.pessoa.id === pessoaId}
                    podeEditar={podeEditar}
                    aoMudar={aoMudar}
                  />
                ))}
              </tbody>
            ))}
            <tfoot className="border-t-2 border-zinc-200 dark:border-zinc-700">
              <tr>
                <th colSpan={colunas - 1} scope="row" className="px-4 py-3 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                  Valor total dos pagamentos do pessoal
                </th>
                <td className="whitespace-nowrap px-4 py-3 text-right text-[14px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{reais(soma(comTotal, "total"))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {fora.length > 0 && (
        <p className="border-t border-zinc-100 px-4 py-3 text-[12px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Sem ponto no mês e sem cadastro na folha:{" "}
          {fora.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link href={endereco(mes, p.id)} className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300">
                {p.nome}
              </Link>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
