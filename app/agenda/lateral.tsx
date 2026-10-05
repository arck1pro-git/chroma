"use client";

import { useState } from "react";
import { Bot, CalendarCheck2, ChevronDown, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { AgendaGoogle, ReuniaoDoSistema } from "@/lib/agenda";
import {
  DIAS_CURTOS,
  diaDe,
  gradeDoMes,
  hora,
  janelaDa,
  nomeDoMes,
  numeroDoDia,
  primeiroDoMes,
  somarMeses,
  diaCurto,
  type Visao,
} from "./tempo";
import { comCor } from "./visual";

// A coluna da esquerda: mini calendário, as reuniões que o Chroma marcou e as
// agendas da conta. No desktop fica fixa; no celular abre por cima (agenda.tsx).

type Props = {
  visao: Visao;
  data: string;
  hoje: string;
  agendas: AgendaGoogle[];
  selecionadas: string[];
  podeListar: boolean;
  agendados: ReuniaoDoSistema[];
  soSistema: boolean;
  aoEscolherData: (data: string) => void;
  aoTrocarAgendas: (ids: string[]) => void;
  aoAbrirAgendado: (r: ReuniaoDoSistema) => void;
  aoAlternarSoSistema: () => void;
};

export default function Lateral(p: Props) {
  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <MiniCalendario visao={p.visao} data={p.data} hoje={p.hoje} aoEscolher={p.aoEscolherData} />
      <Agendados
        agendados={p.agendados}
        soSistema={p.soSistema}
        aoAbrir={p.aoAbrirAgendado}
        aoAlternar={p.aoAlternarSoSistema}
      />
      <Agendas
        agendas={p.agendas}
        selecionadas={p.selecionadas}
        podeListar={p.podeListar}
        aoTrocar={p.aoTrocarAgendas}
      />
    </div>
  );
}

// ── Mini calendário ───────────────────────────────────────────────────────────

const CABECALHO = [1, 2, 3, 4, 5, 6, 0].map((i) => DIAS_CURTOS[i][0].toUpperCase());

function MiniCalendario({
  visao,
  data,
  hoje,
  aoEscolher,
}: {
  visao: Visao;
  data: string;
  hoje: string;
  aoEscolher: (data: string) => void;
}) {
  // O mês que o mini calendário MOSTRA anda sozinho (folhear não navega); ele
  // volta a acompanhar a data da tela quando ela muda de mês.
  const [folha, setFolha] = useState<{ base: string; mes: string }>({ base: data, mes: primeiroDoMes(data) });
  const mes = folha.base === data ? folha.mes : primeiroDoMes(data);
  const dias = gradeDoMes(mes);
  const { dias: naTela } = janelaDa(visao, data);
  const destacar = new Set(visao === "mes" ? [] : naTela);

  return (
    <section aria-label="Calendário">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-semibold capitalize text-zinc-900 dark:text-zinc-50">
          {nomeDoMes(mes)} <span className="font-normal text-zinc-400">{mes.slice(0, 4)}</span>
        </p>
        <div className="flex">
          <button
            type="button"
            onClick={() => setFolha({ base: data, mes: somarMeses(mes, -1) })}
            aria-label="Mês anterior"
            className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setFolha({ base: data, mes: somarMeses(mes, 1) })}
            aria-label="Próximo mês"
            className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center">
        {CABECALHO.map((d, i) => (
          <span key={i} className="pb-1 text-[10px] font-semibold text-zinc-400" aria-hidden="true">
            {d}
          </span>
        ))}
        {dias.map((d) => {
          const fora = !d.startsWith(mes.slice(0, 7));
          const ehHoje = d === hoje;
          const naJanela = destacar.has(d);
          const escolhido = d === data;
          return (
            <button
              key={d}
              type="button"
              onClick={() => aoEscolher(d)}
              aria-label={`${diaCurto(d)}, ${numeroDoDia(d)} de ${nomeDoMes(d)}`}
              aria-current={escolhido ? "date" : undefined}
              className={`relative mx-auto my-px flex size-7 items-center justify-center rounded-full text-[12px] tabular-nums transition ${
                ehHoje
                  ? "bg-red-600 font-semibold text-white dark:bg-red-500"
                  : escolhido
                    ? "bg-zinc-900 font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : naJanela
                      ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : fora
                        ? "text-zinc-300 hover:bg-zinc-100 dark:text-zinc-700 dark:hover:bg-zinc-800"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {numeroDoDia(d)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Agendados pelo Chroma ─────────────────────────────────────────────────────

function Agendados({
  agendados,
  soSistema,
  aoAbrir,
  aoAlternar,
}: {
  agendados: ReuniaoDoSistema[];
  soSistema: boolean;
  aoAbrir: (r: ReuniaoDoSistema) => void;
  aoAlternar: () => void;
}) {
  const [verAnteriores, setVerAnteriores] = useState(false);
  const proximos = agendados.filter((r) => !r.passou);
  const anteriores = agendados.filter((r) => r.passou).reverse();

  return (
    <section aria-labelledby="agendados-titulo">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2
          id="agendados-titulo"
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          Agendados pelo Chroma
          {proximos.length > 0 && (
            <span className="rounded-full bg-zinc-900 px-1.5 text-[10px] tabular-nums text-white dark:bg-zinc-50 dark:text-zinc-900">
              {proximos.length}
            </span>
          )}
        </h2>
      </div>

      {/* Mostrar só eles na grade: o filtro de "o que a IA e a equipe marcaram". */}
      <button
        type="button"
        role="switch"
        aria-checked={soSistema}
        onClick={aoAlternar}
        className="mb-3 flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2.5 py-2 text-left text-[12px] text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        Só estes no calendário
        <span
          className={`relative h-4 w-7 shrink-0 rounded-full transition ${soSistema ? "bg-zinc-900 dark:bg-zinc-50" : "bg-zinc-200 dark:bg-zinc-700"}`}
          aria-hidden="true"
        >
          <span
            className={`absolute top-0.5 size-3 rounded-full bg-white shadow transition-all dark:bg-zinc-900 ${soSistema ? "left-3.5" : "left-0.5"}`}
          />
        </span>
      </button>

      {proximos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-3 text-[12px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Nenhuma reunião marcada pelo CRM daqui para frente. As que a IA comercial ou a ficha da oportunidade marcarem
          aparecem aqui.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {proximos.map((r) => (
            <ItemAgendado key={r.id} reuniao={r} aoAbrir={aoAbrir} />
          ))}
        </ul>
      )}

      {anteriores.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setVerAnteriores((v) => !v)}
            aria-expanded={verAnteriores}
            className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            <ChevronDown className={`size-3.5 transition ${verAnteriores ? "" : "-rotate-90"}`} aria-hidden="true" />
            Últimos 30 dias ({anteriores.length})
          </button>
          {verAnteriores && (
            <ul className="mt-1 flex flex-col gap-1 opacity-70">
              {anteriores.map((r) => (
                <ItemAgendado key={r.id} reuniao={r} aoAbrir={aoAbrir} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ItemAgendado({ reuniao: r, aoAbrir }: { reuniao: ReuniaoDoSistema; aoAbrir: (r: ReuniaoDoSistema) => void }) {
  const dia = diaDe(r.inicio);
  return (
    <li>
      <button
        type="button"
        onClick={() => aoAbrir(r)}
        className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <span className="flex w-9 shrink-0 flex-col items-center rounded-md border border-zinc-200 py-0.5 dark:border-zinc-800">
          <span className="text-[9px] font-semibold uppercase leading-tight text-red-600 dark:text-red-400">{diaCurto(dia)}</span>
          <span className="text-[14px] font-semibold leading-tight tabular-nums text-zinc-900 dark:text-zinc-50">
            {numeroDoDia(dia)}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{r.contato.nome}</span>
          <span className="flex items-center gap-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {hora(r.inicio)}
            <span aria-hidden="true">·</span>
            {r.autor ? (
              <CalendarCheck2 className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <Bot className="size-3 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{r.autor ?? "IA"}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

// ── Agendas da conta ──────────────────────────────────────────────────────────

function Agendas({
  agendas,
  selecionadas,
  podeListar,
  aoTrocar,
}: {
  agendas: AgendaGoogle[];
  selecionadas: string[];
  podeListar: boolean;
  aoTrocar: (ids: string[]) => void;
}) {
  const marcadas = new Set(selecionadas);
  const alternar = (id: string) =>
    aoTrocar(agendas.filter((a) => (a.id === id ? !marcadas.has(id) : marcadas.has(a.id))).map((a) => a.id));

  return (
    <section aria-labelledby="agendas-titulo">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="agendas-titulo" className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Agendas <span className="tabular-nums text-zinc-300 dark:text-zinc-600">{selecionadas.length}/{agendas.length}</span>
        </h2>
        {agendas.length > 1 && (
          <div className="flex gap-2 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => aoTrocar(agendas.map((a) => a.id))}
              className="text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => aoTrocar([])}
              className="text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Nenhuma
            </button>
          </div>
        )}
      </div>

      <ul className="flex flex-col">
        {agendas.map((a) => {
          const ativa = marcadas.has(a.id);
          const cor = a.cor ?? "#71717a";
          return (
            <li key={a.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={ativa}
                onClick={() => alternar(a.id)}
                title={a.nome}
                style={comCor(cor)}
                className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                {/* A caixa de marcar é da cor da agenda, como no Google. */}
                <span
                  className={`flex size-4 shrink-0 items-center justify-center rounded border-2 border-[var(--cor)] transition ${
                    ativa ? "bg-[var(--cor)]" : "bg-transparent"
                  }`}
                  aria-hidden="true"
                >
                  {ativa && (
                    <svg viewBox="0 0 12 12" className="size-3 text-white">
                      <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={`min-w-0 flex-1 truncate text-[13px] ${ativa ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400"}`}>
                  {a.nome}
                </span>
                {a.principal && <span className="shrink-0 text-[10px] text-zinc-400">principal</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {!podeListar && (
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Só a agenda principal aparece. Para ver as outras, desconecte e conecte de novo em Integrações.
        </p>
      )}
    </section>
  );
}
