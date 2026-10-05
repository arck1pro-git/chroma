"use client";

import { useMemo } from "react";
import type { AgendaGoogle, EventoAgenda, ReuniaoDoSistema } from "@/lib/agenda";
import { ehDeFaixa, eventosDoDia } from "./disposicao";
import { DIAS_CURTOS, horaCurta, numeroDoDia } from "./tempo";
import { useAgora } from "./relogio";
import { BORDA_COR, comCor, corDe, PONTO_COR, SeloSistema, TINTA, TINTA_HOVER } from "./visual";

// A visão Mês: seis semanas, segunda a domingo. Cada dia mostra até três
// compromissos; o resto vira "+N", que abre o dia.

const POR_DIA = 3;
// Segunda primeiro, como a semana da grade.
const CABECALHO = [1, 2, 3, 4, 5, 6, 0].map((i) => DIAS_CURTOS[i]);

type Props = {
  dias: string[];
  /** "2026-10" — os dias fora dele aparecem apagados. */
  mes: string;
  eventos: EventoAgenda[];
  agendaPorId: Map<string, AgendaGoogle>;
  sistemaPorEvento: Map<string, ReuniaoDoSistema>;
  hoje: string;
  selecionado: string | null;
  aoAbrir: (eventoId: string) => void;
  aoIrParaDia: (data: string) => void;
};

export default function GradeMes({
  dias,
  mes,
  eventos,
  agendaPorId,
  sistemaPorEvento,
  hoje,
  selecionado,
  aoAbrir,
  aoIrParaDia,
}: Props) {
  const agora = useAgora();
  const porDia = useMemo(() => new Map(dias.map((d) => [d, eventosDoDia(eventos, d)])), [dias, eventos]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
      <div className="flex min-h-0 min-w-[42rem] flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-7 border-b border-zinc-200 dark:border-zinc-800">
          {CABECALHO.map((d) => (
            <span
              key={d}
              className="py-2 text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
            >
              {d}
            </span>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
          {dias.map((d, i) => {
            const doDia = porDia.get(d) ?? [];
            const visiveis = doDia.slice(0, POR_DIA);
            const resto = doDia.length - visiveis.length;
            const foraDoMes = !d.startsWith(mes);
            const ehHoje = d === hoje;
            return (
              <div
                key={d}
                className={`flex min-h-[6.5rem] min-w-0 flex-col gap-0.5 border-zinc-200 p-1 dark:border-zinc-800 ${
                  i % 7 ? "border-l" : ""
                } ${i >= 7 ? "border-t" : ""} ${foraDoMes ? "bg-zinc-50/70 dark:bg-zinc-900/30" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => aoIrParaDia(d)}
                  title="Ver o dia"
                  className={`mb-0.5 flex size-6 items-center justify-center self-center rounded-full text-[12px] font-semibold tabular-nums transition ${
                    ehHoje
                      ? "bg-red-600 text-white dark:bg-red-500"
                      : foraDoMes
                        ? "text-zinc-400 hover:bg-zinc-100 dark:text-zinc-600 dark:hover:bg-zinc-800"
                        : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  }`}
                >
                  {numeroDoDia(d)}
                </button>

                {visiveis.map((e) => {
                  const agenda = agendaPorId.get(e.agendaId);
                  const sistema = sistemaPorEvento.get(e.id);
                  const faixa = ehDeFaixa(e);
                  const passou = agora !== null && new Date(e.fim).getTime() <= agora;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => aoAbrir(e.id)}
                      style={comCor(corDe(e, agenda))}
                      title={e.titulo}
                      className={`flex min-w-0 items-center gap-1 rounded px-1 py-px text-left text-[11px] leading-[1.15rem] text-zinc-900 transition dark:text-zinc-50 ${
                        faixa ? `border-l-[3px] font-medium ${BORDA_COR} ${TINTA} ${TINTA_HOVER}` : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      } ${selecionado === e.id ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : ""} ${
                        (passou || !e.ocupa) && selecionado !== e.id ? "opacity-60" : ""
                      }`}
                    >
                      {!faixa && <span className={`size-2 shrink-0 rounded-full ${PONTO_COR}`} aria-hidden="true" />}
                      {sistema && <SeloSistema reuniao={sistema} />}
                      {!faixa && (
                        <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">{horaCurta(e.inicio)}</span>
                      )}
                      <span className={`truncate ${faixa ? "" : "font-medium"}`}>{e.titulo}</span>
                    </button>
                  );
                })}

                {resto > 0 && (
                  <button
                    type="button"
                    onClick={() => aoIrParaDia(d)}
                    className="rounded px-1 text-left text-[11px] font-semibold text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                  >
                    +{resto} {resto === 1 ? "outro" : "outros"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
