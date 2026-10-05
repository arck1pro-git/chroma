"use client";

import { useEffect, useMemo, useRef } from "react";
import { Repeat } from "lucide-react";
import type { AgendaGoogle, EventoAgenda, ReuniaoDoSistema } from "@/lib/agenda";
import { faixasDosDias, pedacosDoDia, type Pedaco } from "./disposicao";
import { diaCurto, diaDe, horaCurta, intervalo, minutosDe, numeroDoDia } from "./tempo";
import { useAgora } from "./relogio";
import { BORDA_COR, comCor, corDe, SeloSistema, TINTA, TINTA_HOVER } from "./visual";

// As visões Dia e Semana: colunas de dias sobre uma régua de 24 horas.

/** Altura de uma hora na grade. 52px deixa um evento de 30 min com duas linhas. */
const HORA = 52;
const HORAS = Array.from({ length: 24 }, (_, h) => h);

type Props = {
  dias: string[];
  eventos: EventoAgenda[];
  agendaPorId: Map<string, AgendaGoogle>;
  sistemaPorEvento: Map<string, ReuniaoDoSistema>;
  hoje: string;
  selecionado: string | null;
  aoAbrir: (eventoId: string) => void;
  aoIrParaDia: (data: string) => void;
};

export default function GradeHoras({
  dias,
  eventos,
  agendaPorId,
  sistemaPorEvento,
  hoje,
  selecionado,
  aoAbrir,
  aoIrParaDia,
}: Props) {
  const agora = useAgora();
  const rolagem = useRef<HTMLDivElement>(null);
  const umDia = dias.length === 1;

  const faixas = useMemo(() => faixasDosDias(eventos, dias), [eventos, dias]);
  const linhasDeFaixa = faixas.reduce((n, f) => Math.max(n, f.linha + 1), 0);
  const pedacos = useMemo(() => dias.map((d) => pedacosDoDia(eventos, d)), [eventos, dias]);

  // Abre no começo do expediente — ou perto de agora, se hoje está na tela.
  // Só na montagem: trocar de semana mantém a rolagem, como no Google.
  useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const alvo = dias.includes(hoje) ? Math.max(7 * 60, minutosDe(new Date()) - 90) : 7 * 60;
    el.scrollTop = (alvo / 60) * HORA - 8;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colunas = { gridTemplateColumns: `repeat(${dias.length}, minmax(0, 1fr))` };
  const minutoAgora = agora !== null ? minutosDe(new Date(agora)) : null;
  const diaAgora = agora !== null ? diaDe(new Date(agora)) : null;

  return (
    // Rolagem lateral só no celular: a semana pede ~42rem para os títulos
    // caberem; abaixo disso a grade desliza em vez de espremer.
    <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
      <div className={`flex min-h-0 flex-1 flex-col ${umDia ? "" : "min-w-[42rem]"}`}>
        {/* Cabeçalho dos dias */}
        <div className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-800">
          <div className="w-14 shrink-0" />
          <div className="grid flex-1" style={colunas}>
            {dias.map((d) => {
              const ehHoje = d === hoje;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => aoIrParaDia(d)}
                  disabled={umDia}
                  title={umDia ? undefined : "Ver o dia"}
                  className={`group flex flex-col items-center gap-0.5 border-l border-zinc-200 py-2 first:border-l-transparent disabled:cursor-default dark:border-zinc-800 ${
                    umDia ? "items-start pl-3" : ""
                  }`}
                >
                  <span
                    className={`text-[11px] font-medium uppercase tracking-wider ${
                      ehHoje ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    {diaCurto(d)}
                  </span>
                  <span
                    className={`flex size-8 items-center justify-center rounded-full text-[17px] font-semibold tabular-nums transition ${
                      ehHoje
                        ? "bg-red-600 text-white dark:bg-red-500"
                        : "text-zinc-900 group-enabled:group-hover:bg-zinc-100 dark:text-zinc-50 dark:group-enabled:group-hover:bg-zinc-800"
                    }`}
                  >
                    {numeroDoDia(d)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dia inteiro */}
        {linhasDeFaixa > 0 && (
          <div className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex w-14 shrink-0 items-start justify-end pr-2 pt-1.5 text-[10px] font-medium text-zinc-400">
              dia todo
            </div>
            <div
              className="grid flex-1 gap-y-1 py-1"
              style={{ ...colunas, gridTemplateRows: `repeat(${linhasDeFaixa}, 1.375rem)` }}
            >
              {faixas.map((f) => {
                const e = f.evento;
                const sistema = sistemaPorEvento.get(e.id);
                return (
                  <button
                    key={`${e.id}-${f.de}`}
                    type="button"
                    onClick={() => aoAbrir(e.id)}
                    style={{ ...comCor(corDe(e, agendaPorId.get(e.agendaId))), gridColumn: `${f.de + 1} / ${f.ate + 2}`, gridRow: f.linha + 1 }}
                    className={`mx-0.5 flex min-w-0 items-center gap-1 border-l-[3px] px-1.5 text-left text-[11px] font-medium text-zinc-900 transition dark:text-zinc-50 ${BORDA_COR} ${TINTA} ${TINTA_HOVER} ${
                      f.vemDeAntes ? "rounded-l-none" : "rounded-l-md"
                    } ${f.segueDepois ? "rounded-r-none" : "rounded-r-md"} ${selecionado === e.id ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : ""} ${e.ocupa ? "" : "opacity-70"}`}
                  >
                    {sistema && <SeloSistema reuniao={sistema} />}
                    <span className="truncate">{e.titulo}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Régua de horas */}
        <div ref={rolagem} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="relative flex" style={{ height: 24 * HORA }}>
            <div className="relative w-14 shrink-0 select-none" aria-hidden="true">
              {HORAS.slice(1).map((h) => (
                <span
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500"
                  style={{ top: h * HORA }}
                >
                  {String(h).padStart(2, "0")}:00
                </span>
              ))}
              {minutoAgora !== null && diaAgora !== null && dias.includes(diaAgora) && (
                <span
                  className="absolute right-1 z-20 -translate-y-1/2 rounded bg-red-600 px-1 text-[10px] font-semibold tabular-nums text-white dark:bg-red-500"
                  style={{ top: (minutoAgora / 60) * HORA }}
                >
                  {String(Math.floor(minutoAgora / 60)).padStart(2, "0")}:{String(minutoAgora % 60).padStart(2, "0")}
                </span>
              )}
            </div>

            <div className="relative grid flex-1" style={colunas}>
              {/* Linhas das horas e meias-horas, por trás de tudo. */}
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                {HORAS.map((h) => (
                  <div key={h}>
                    <div className="absolute inset-x-0 border-t border-zinc-200 dark:border-zinc-800" style={{ top: h * HORA }} />
                    <div
                      className="absolute inset-x-0 border-t border-dashed border-zinc-100 dark:border-zinc-900"
                      style={{ top: h * HORA + HORA / 2 }}
                    />
                  </div>
                ))}
              </div>

              {dias.map((d, i) => (
                <div
                  key={d}
                  className={`relative border-l border-zinc-200 first:border-l-transparent dark:border-zinc-800 ${
                    d === hoje ? "bg-red-50/40 dark:bg-red-500/[0.04]" : ""
                  }`}
                >
                  {pedacos[i].map((p) => (
                    <CartaoNaGrade
                      key={`${p.evento.id}-${d}`}
                      pedaco={p}
                      agenda={agendaPorId.get(p.evento.agendaId)}
                      sistema={sistemaPorEvento.get(p.evento.id)}
                      largo={umDia}
                      passou={agora !== null && new Date(p.evento.fim).getTime() <= agora}
                      selecionado={selecionado === p.evento.id}
                      aoAbrir={aoAbrir}
                    />
                  ))}

                  {minutoAgora !== null && diaAgora === d && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-red-600 dark:bg-red-500"
                      style={{ top: (minutoAgora / 60) * HORA - 1 }}
                      aria-hidden="true"
                    >
                      <span className="absolute -left-1.5 -top-[5px] size-3 rounded-full bg-red-600 dark:bg-red-500" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CartaoNaGrade({
  pedaco: p,
  agenda,
  sistema,
  largo,
  passou,
  selecionado,
  aoAbrir,
}: {
  pedaco: Pedaco;
  agenda: AgendaGoogle | undefined;
  sistema: ReuniaoDoSistema | undefined;
  largo: boolean;
  passou: boolean;
  selecionado: boolean;
  aoAbrir: (id: string) => void;
}) {
  const e = p.evento;
  const altura = Math.max(((p.fimMin - p.inicioMin) / 60) * HORA, 22);
  const curto = altura < 40;
  const cabeDetalhe = altura >= 64;
  // 2px de folga entre colunas; o último da fila encosta menos na borda.
  const largura = 100 / p.colunas;

  return (
    <button
      type="button"
      onClick={() => aoAbrir(e.id)}
      aria-label={`${e.titulo}, ${intervalo(e.inicio, e.fim, false)}${agenda ? `, ${agenda.nome}` : ""}${sistema ? ", agendada pelo Chroma" : ""}`}
      style={{
        ...comCor(corDe(e, agenda)),
        top: (p.inicioMin / 60) * HORA + 1,
        height: altura - 2,
        left: `calc(${p.coluna * largura}% + 2px)`,
        width: `calc(${largura}% - 4px)`,
      }}
      className={`absolute flex flex-col overflow-hidden border-l-[3px] px-1.5 text-left text-zinc-900 transition focus-visible:z-30 dark:text-zinc-50 ${BORDA_COR} ${TINTA} ${TINTA_HOVER} ${
        curto ? "justify-center py-0" : "py-1"
      } ${p.vemDeAntes ? "rounded-b-md" : p.segueDepois ? "rounded-t-md" : "rounded-md"} ${
        selecionado ? "z-30 shadow-lg ring-2 ring-zinc-900 dark:ring-zinc-100" : "hover:z-20 hover:shadow-md"
      } ${(!e.ocupa || passou) && !selecionado ? "opacity-60" : ""}`}
    >
      {curto ? (
        <span className="flex min-w-0 items-center gap-1 text-[11px] leading-none">
          {sistema && <SeloSistema reuniao={sistema} />}
          <span className="truncate font-semibold">{e.titulo}</span>
          <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">{horaCurta(e.inicio)}</span>
        </span>
      ) : (
        <>
          <span className="flex min-w-0 items-start gap-1">
            {sistema && <SeloSistema reuniao={sistema} className="mt-px size-3" />}
            <span className={`font-semibold leading-tight ${largo ? "text-[13px]" : "text-[12px]"} ${cabeDetalhe ? "line-clamp-2" : "truncate"}`}>
              {e.titulo}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] tabular-nums text-zinc-600 dark:text-zinc-300">
            {horaCurta(e.inicio)} – {horaCurta(e.fim)}
            {e.recorrente && <Repeat className="size-2.5 shrink-0" aria-label="Recorrente" role="img" />}
          </span>
          {cabeDetalhe && (sistema || e.local) && (
            <span className="mt-0.5 truncate text-[11px] text-zinc-600 dark:text-zinc-300">
              {sistema ? sistema.contato.nome : e.local}
            </span>
          )}
          {largo && cabeDetalhe && agenda && (
            <span className="mt-auto truncate text-[10px] text-zinc-500 dark:text-zinc-400">{agenda.nome}</span>
          )}
        </>
      )}
    </button>
  );
}
