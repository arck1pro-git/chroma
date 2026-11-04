"use client";

// A janela de "quando retomar o contato", aberta ao mover para uma etapa que
// pede retorno (a "interesse futuro", 2026-11-04: "para mover o lead para ali é
// preciso selecionar o tempo de interesse futuro"). Serve ao arraste do quadro
// (app/inicio/inicio.tsx) e ao "Mover para a etapa" da seleção
// (./barra-selecao.tsx). Sem escolher, não move: Cancelar desfaz.
//
// Os prazos são contados de hoje em Brasília (lib/formato.ts); "Outra data"
// aceita de amanhã até 5 anos, a mesma conta que o servidor confere
// (conferirRetomarEm, lib/mover-etapa.ts).
import { useEffect, useState } from "react";
import { dataCurta, hojeEmBrasilia, somarMeses } from "@/lib/formato";
import { CalendarClock, Check, Loader2, X } from "@/app/components/icones";

const PRAZOS = [
  { meses: 1, rotulo: "1 mês" },
  { meses: 3, rotulo: "3 meses" },
  { meses: 6, rotulo: "6 meses" },
  { meses: 12, rotulo: "1 ano" },
];

export default function EscolherRetorno({
  etapaNome,
  quantas = 1,
  ocupado = false,
  erro = null,
  aoConfirmar,
  aoCancelar,
}: {
  etapaNome: string;
  /** Quantas oportunidades vão (a seleção do quadro); 1 no arraste. */
  quantas?: number;
  ocupado?: boolean;
  erro?: string | null;
  aoConfirmar: (retomarEm: string) => void;
  aoCancelar: () => void;
}) {
  const hoje = hojeEmBrasilia();
  const amanha = somarDias(hoje, 1);
  const teto = somarMeses(hoje, 60);
  const [data, setData] = useState("");
  const valida = data >= amanha && data <= teto;

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !ocupado) aoCancelar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoCancelar, ocupado]);

  return (
    <div
      className="veu-surge fixed inset-0 z-[310] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onClick={() => !ocupado && aoCancelar()}
      role="dialog"
      aria-modal="true"
      aria-label={`Quando retomar o contato, em ${etapaNome}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              <CalendarClock className="size-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
              Quando retomar o contato?
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {quantas === 1 ? "O lead vai" : `${quantas} leads vão`} para “{etapaNome}”. No dia, o card avisa para retomar.
            </p>
          </div>
          <button
            type="button"
            onClick={aoCancelar}
            disabled={ocupado}
            aria-label="Cancelar"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            {PRAZOS.map((p) => {
              const dia = somarMeses(hoje, p.meses);
              const escolhido = data === dia;
              return (
                <button
                  key={p.meses}
                  type="button"
                  onClick={() => setData(dia)}
                  aria-pressed={escolhido}
                  className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition ${
                    escolhido
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-200 text-zinc-800 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500"
                  }`}
                >
                  <span className="text-[13px] font-semibold">Daqui a {p.rotulo}</span>
                  <span className={`text-[11px] tabular-nums ${escolhido ? "text-white/70 dark:text-zinc-900/70" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {dataCurta(dia)}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-400">Ou outra data</span>
            <input
              type="date"
              value={data}
              min={amanha}
              max={teto}
              onChange={(e) => setData(e.target.value)}
              aria-label="Outra data para retomar o contato"
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/5 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:[color-scheme:dark] dark:focus:border-zinc-500 dark:focus:ring-white/5"
            />
          </label>

          {erro && (
            <p role="alert" className="text-[12px] text-red-600 dark:text-red-400">
              {erro}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-1.5 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={aoCancelar}
            disabled={ocupado}
            className="rounded-lg px-3 py-1.5 text-[13px] text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => valida && aoConfirmar(data)}
            disabled={!valida || ocupado}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {ocupado ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
            {valida ? `Mover · retomar em ${dataCurta(data)}` : "Mover"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** 'AAAA-MM-DD' + n dias, data pura. */
function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}
