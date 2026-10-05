"use client";

import { useMemo } from "react";
import { CalendarX2, MapPin, Repeat, Video } from "lucide-react";
import type { AgendaGoogle, EventoAgenda, ReuniaoDoSistema } from "@/lib/agenda";
import { eventosDoDia } from "./disposicao";
import { DIAS_DA_LISTA, diaCurto, diaEMes, diaPorExtenso, intervalo, numeroDoDia } from "./tempo";
import { useAgora } from "./relogio";
import { comCor, corDe, PONTO_COR, quemMarcou, SeloSistema } from "./visual";

// A visão Lista: os próximos 14 dias, só os que têm compromisso. É a leitura
// mais rápida de "o que vem por aí" — e a que melhor cabe no celular.

type Props = {
  dias: string[];
  eventos: EventoAgenda[];
  agendaPorId: Map<string, AgendaGoogle>;
  sistemaPorEvento: Map<string, ReuniaoDoSistema>;
  hoje: string;
  selecionado: string | null;
  aoAbrir: (eventoId: string) => void;
};

export default function Lista({ dias, eventos, agendaPorId, sistemaPorEvento, hoje, selecionado, aoAbrir }: Props) {
  const agora = useAgora();
  const grupos = useMemo(
    () => dias.map((d) => ({ dia: d, eventos: eventosDoDia(eventos, d) })).filter((g) => g.eventos.length > 0),
    [dias, eventos],
  );

  if (grupos.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <CalendarX2 className="size-8 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
        <p className="text-[14px] font-medium text-zinc-700 dark:text-zinc-200">Nada nos próximos {DIAS_DA_LISTA} dias</p>
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
          De {diaEMes(dias[0])} a {diaEMes(dias[dias.length - 1])}, nas agendas marcadas.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ol className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
        {grupos.map(({ dia, eventos: doDia }) => {
          const ehHoje = dia === hoje;
          return (
            <li key={dia} className="flex gap-4 border-b border-zinc-100 py-3 last:border-b-0 dark:border-zinc-900">
              {/* O dia, à esquerda, como numa agenda de papel. */}
              <div className="w-14 shrink-0 pt-1 text-center">
                <span
                  className={`mx-auto flex size-9 items-center justify-center rounded-full text-[17px] font-semibold tabular-nums ${
                    ehHoje ? "bg-red-600 text-white dark:bg-red-500" : "text-zinc-900 dark:text-zinc-50"
                  }`}
                >
                  {numeroDoDia(dia)}
                </span>
                <span
                  className={`mt-0.5 block text-[11px] font-medium uppercase tracking-wider ${
                    ehHoje ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {diaCurto(dia)}
                </span>
              </div>

              <ul className="min-w-0 flex-1" aria-label={diaPorExtenso(dia)}>
                {doDia.map((e) => {
                  const agenda = agendaPorId.get(e.agendaId);
                  const sistema = sistemaPorEvento.get(e.id);
                  const passou = agora !== null && new Date(e.fim).getTime() <= agora;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => aoAbrir(e.id)}
                        style={comCor(corDe(e, agenda))}
                        className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                          selecionado === e.id ? "bg-zinc-100 ring-1 ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-700" : ""
                        } ${(passou || !e.ocupa) && selecionado !== e.id ? "opacity-60" : ""}`}
                      >
                        <span className="w-32 shrink-0 pt-0.5 text-[12px] tabular-nums text-zinc-600 dark:text-zinc-300">
                          {intervalo(e.inicio, e.fim, e.diaInteiro)}
                        </span>
                        <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${PONTO_COR}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{e.titulo}</span>
                            {e.recorrente && (
                              <Repeat className="size-3 shrink-0 text-zinc-400" aria-label="Recorrente" role="img" />
                            )}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {agenda && <span className="truncate">{agenda.nome}</span>}
                            {sistema && (
                              <span className="inline-flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-200">
                                <SeloSistema reuniao={sistema} />
                                {sistema.contato.nome} · agendada {quemMarcou(sistema)}
                              </span>
                            )}
                            {e.local && (
                              <span className="inline-flex min-w-0 items-center gap-1">
                                <MapPin className="size-3 shrink-0" aria-hidden="true" />
                                <span className="truncate">{e.local}</span>
                              </span>
                            )}
                          </span>
                        </span>
                        {e.meet && <Video className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-label="Com Google Meet" role="img" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
