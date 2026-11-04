"use client";

// A tabela da folha do mês: as linhas por setor (./linha-da-folha.tsx), o total
// de cada setor, o total dos pagamentos do pessoal e, no cabeçalho, o resumo
// (base, deslocamento, adicionais, descontos). Só para ler: o Editar de cada
// linha abre a gaveta do pagamento por cima (./area-da-folha.tsx), e salvar
// lá recarrega a folha com os números novos. A conta é a mesma do servidor
// (lib/financeiro-tipos.ts).
//
// A coluna de checks (validação · NF · pagamento) se marca direto na linha
// (./checks-da-folha.tsx). Os setores da casa da Pati vão no fim
// (compararSetores, 2026-11-04).
import { useMemo } from "react";
import { compararSetores, contaDoMes, reais, SEM_SETOR, type ChecksDoMes, type OrigemColaborador, type ValoresPagamento } from "@/lib/financeiro-tipos";
import { cartao, SO_PARA_VER } from "./comum";
import LinhaDaFolha from "./linha-da-folha";

export type LinhaFolha = {
  pessoa: { id: string; nome: string };
  /** Do app de ponto (tem horas), uma conta do AmaanOffice ou um cadastro feito à mão na folha (os dois sem ponto). */
  origem: OrigemColaborador;
  /** Tem cadastro na folha (setor, PIX, valores padrão). */
  temCadastro: boolean;
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
  /** Os três checks do mês (validação, NF, pagamento). */
  checks: ChecksDoMes;
};

/**
 * As linhas por setor, na ordem da folha: setores em ordem alfabética, depois
 * "Sem setor" e, por último, os da casa da Pati (com "Casa" no nome,
 * 2026-11-04); as pessoas pelo nome. A tabela e o CSV usam a mesma.
 */
export function agruparPorSetor(linhas: LinhaFolha[]): Array<[string, LinhaFolha[]]> {
  const grupos = new Map<string, LinhaFolha[]>();
  for (const l of linhas) grupos.set(l.setor ?? SEM_SETOR, [...(grupos.get(l.setor ?? SEM_SETOR) ?? []), l]);
  for (const g of grupos.values()) g.sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"));
  return [...grupos.entries()].sort(([a], [b]) => compararSetores(a, b));
}

function Resumo({ rotulo, valor, destaque = false }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{rotulo}</p>
      <p className={`tabular-nums tracking-tight ${destaque ? "text-[18px] font-semibold text-zinc-900 dark:text-zinc-50" : "text-[13.5px] font-medium text-zinc-700 dark:text-zinc-300"}`}>{valor}</p>
    </div>
  );
}

export default function TabelaDaFolha({
  mes,
  mesNome,
  linhas,
  salva,
  podeEditar,
  aoEditar,
}: {
  mes: string;
  mesNome: string;
  linhas: LinhaFolha[];
  /** A pessoa que acabou de ser salva na gaveta. */
  salva: string | null;
  podeEditar: boolean;
  aoEditar: (pessoaId: string) => void;
}) {
  const contas = useMemo(() => new Map(linhas.map((l) => [l.pessoa.id, contaDoMes(l.valores, l.minutos, l.presencial, l)])), [linhas]);
  const porSetor = useMemo(() => agruparPorSetor(linhas), [linhas]);

  const comTotal = linhas.filter((l) => contas.get(l.pessoa.id)?.total !== null);
  const soma = (ls: LinhaFolha[], campo: "total" | "base" | "deslocamento" | "adicional" | "descontos") =>
    ls.reduce((s, l) => s + (contas.get(l.pessoa.id)?.[campo] ?? 0), 0);
  const semValor = linhas.length - comTotal.length;
  const colunas = podeEditar ? 10 : 9;

  return (
    <section className={cartao}>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-zinc-100 px-4 py-3.5 dark:border-zinc-800">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">Folha de {mesNome.toLowerCase()}</h2>
          <p className="mt-0.5 max-w-xl text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">
            {podeEditar ? "Editar (ou o nome) abre o pagamento por cima: setor, PIX, valores, deslocamento e lançamentos do mês." : SO_PARA_VER}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
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
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-2 pl-4 pr-2 font-medium">Profissional</th>
                <th className="px-2 py-2 font-medium">Tipo</th>
                <th className="px-2 py-2 text-right font-medium">Valor hora</th>
                <th className="px-2 py-2 text-right font-medium">Valor mês</th>
                <th className="px-2 py-2 text-right font-medium">Referência</th>
                <th className="px-2 py-2 text-right font-medium">Adicionais</th>
                <th className="px-2 py-2 text-right font-medium">Descontos</th>
                <th className="py-2 pl-2 pr-3 text-right font-medium">Valor total</th>
                <th className="px-2 py-2 text-center font-medium">Validação · NF · Pagamento</th>
                {podeEditar && (
                  <th className="py-2 pl-1 pr-4">
                    <span className="sr-only">Editar</span>
                  </th>
                )}
              </tr>
            </thead>
            {porSetor.map(([setor, doSetor]) => (
              <tbody key={setor} className="divide-y divide-zinc-100 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                <tr className="bg-zinc-50/80 dark:bg-zinc-800/40">
                  <th colSpan={7} scope="rowgroup" className="px-4 py-1.5 text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">
                    {setor} <span className="font-normal text-zinc-400 dark:text-zinc-500">· {doSetor.length}</span>
                  </th>
                  {/* O total fica sob "Valor total"; os checks e o Editar, à direita, ficam vazios. */}
                  <td className="whitespace-nowrap py-1.5 pl-2 pr-3 text-right text-[12px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                    <span className="mr-1.5 font-normal text-zinc-400 dark:text-zinc-500">total do setor</span>
                    {reais(soma(doSetor, "total"))}
                  </td>
                  <td colSpan={colunas - 8} />
                </tr>
                {doSetor.map((l) => (
                  <LinhaDaFolha
                    key={l.pessoa.id}
                    mes={mes}
                    mesNome={mesNome}
                    linha={l}
                    conta={contas.get(l.pessoa.id)!}
                    salva={l.pessoa.id === salva}
                    podeEditar={podeEditar}
                    aoEditar={aoEditar}
                  />
                ))}
              </tbody>
            ))}
            <tfoot className="border-t-2 border-zinc-200 dark:border-zinc-700">
              <tr>
                <th colSpan={7} scope="row" className="px-4 py-3 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                  Valor total dos pagamentos do pessoal
                </th>
                <td className="whitespace-nowrap py-3 pl-2 pr-3 text-right text-[14px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {reais(soma(comTotal, "total"))}
                </td>
                <td colSpan={colunas - 8} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
