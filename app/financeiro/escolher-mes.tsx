// A primeira tela do Financeiro (2026-11-05, "colocar para escolhermos o mês de
// competência e não entrar automático no mês... primeira tela ao entrar no
// financeiro e ali escolhermos o mês"): sem ?mes= na URL, a página mostra os
// meses de competência e cada um leva à folha e ao ponto dele (?mes=AAAA-MM).
//
// Os meses são os que têm batida no app de ponto, os que têm lançamento na
// folha e, sempre, o mês corrente e o anterior (a folha de outubro se fecha em
// novembro). Cada cartão diz se a folha foi lançada e quantos já foram pagos.
// Componente de servidor: só links.
import Link from "next/link";
import type { ResumoDoMes } from "@/lib/financeiro-pagamentos";
import { CalendarDays, CheckCircle2, ChevronRight } from "@/app/components/icones";
import { CabecalhoFinanceiro, cartao, endereco, nomeDoMes, PAGINA } from "./comum";

export type MesParaEscolher = { mes: string; resumo: ResumoDoMes | null; temPonto: boolean };

export default function EscolherMes({ meses, atual }: { meses: MesParaEscolher[]; atual: string }) {
  const porAno = new Map<string, MesParaEscolher[]>();
  for (const m of meses) porAno.set(m.mes.slice(0, 4), [...(porAno.get(m.mes.slice(0, 4)) ?? []), m]);

  return (
    <div className="flex-1 overflow-y-auto bg-conteudo px-4 py-6 sm:px-6 xl:px-8">
      <div className={PAGINA}>
        <CabecalhoFinanceiro legenda="Escolha o mês de competência para abrir a folha e o ponto dele." />
        {[...porAno].map(([ano, doAno]) => (
          <section key={ano} aria-labelledby={`ano-${ano}`} className="flex flex-col gap-3">
            <h2 id={`ano-${ano}`} className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">
              {ano}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {doAno.map(({ mes, resumo, temPonto }) => {
                const lancados = resumo?.lancados ?? 0;
                const pagos = resumo?.pagos ?? 0;
                return (
                  <Link
                    key={mes}
                    href={endereco(mes)}
                    className={`${cartao} group flex flex-col gap-2 px-4 py-3.5 transition hover:border-zinc-400 hover:shadow-sm dark:hover:border-zinc-600`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                        <CalendarDays className="size-3.5 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
                        {nomeDoMes(mes).split(" de ")[0]}
                      </span>
                      <ChevronRight className="size-3.5 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-300" aria-hidden="true" />
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                      {mes === atual && (
                        <span className="rounded-full bg-zinc-900 px-2 py-0.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">mês atual</span>
                      )}
                      {lancados > 0 ? (
                        <span className="text-zinc-600 dark:text-zinc-300">
                          Folha lançada · {lancados} {lancados === 1 ? "pessoa" : "pessoas"}
                        </span>
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-500">Folha a lançar</span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {pagos > 0 && (
                        <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="size-3" aria-hidden="true" />
                          {pagos} {pagos === 1 ? "pago" : "pagos"}
                        </span>
                      )}
                      {!temPonto && <span>sem registro de ponto</span>}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
