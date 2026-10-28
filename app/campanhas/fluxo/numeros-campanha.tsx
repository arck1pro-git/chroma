"use client";

// A faixa de números de uma campanha de WhatsApp no ar (pedido dele,
// 2026-10-28: "metrifique gastos e métricas"): entraram, enviados, entregues,
// lidos, responderam, conversões e o GASTO, com o custo por resposta e por
// conversão, e as falhas agrupadas pelo motivo. Os números vêm da rota de
// métricas (MetricasCampanha, lib/campanhas-metricas-tipos.ts), que
// ./ver-campanha.tsx pede ao abrir e no botão de atualizar, sem polling.
// Enquanto ela não responde (ou falha), a faixa mostra o que a lista já traz.
//
// O percentual é sobre o passo anterior do funil: entregues sobre enviados,
// lidos e respostas sobre entregues (a base vai no title). O gasto sai em
// Intl na moeda da conta, com centavos: o brl de lib/formato.ts arredonda para
// o real, e o custo por resposta é de centavos. Sem custo da Meta (situação
// diferente de "ok"), o gasto fica "—" e o aviso do servidor vai numa linha
// discreta embaixo, sem quebrar a faixa.
import { useState } from "react";
import type { MetricasCampanha } from "@/lib/campanhas-metricas-tipos";
import { dataHora } from "@/lib/formato";
import { ChevronDown } from "@/app/components/icones";

/** O que a lista de campanhas já traz, para a faixa antes (ou sem) a rota de métricas. */
export type NumerosDaLista = { total?: number; enviados?: number; responderam?: number; conversoes?: number; falharam?: number };

const numero = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR"));
const pct = (parte: number | null | undefined, base: number | null | undefined) =>
  parte != null && base ? `${Math.round((parte / base) * 100)}%` : null;

function dinheiro(valor: number, moeda: string | null): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda || "BRL" }).format(valor);
  } catch {
    // Código de moeda que o Intl não conhece: o número com o código na frente.
    return `${moeda ?? ""} ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
  }
}

function Item({ rotulo, valor, extra, titulo }: { rotulo: string; valor: string; extra?: string | null; titulo?: string }) {
  return (
    <div className="flex items-baseline gap-1.5" title={titulo}>
      <dt className="text-zinc-500 dark:text-zinc-400">{rotulo}</dt>
      <dd className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {valor}
        {extra && <span className="ml-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{extra}</span>}
      </dd>
    </div>
  );
}

export default function NumerosCampanha({
  metricas,
  daLista,
  erro,
}: {
  metricas: MetricasCampanha | null;
  daLista: NumerosDaLista;
  /** A rota de métricas falhou: fica o que a lista traz, com a linha discreta. */
  erro: boolean;
}) {
  const [verFalhas, setVerFalhas] = useState(false);
  const f = metricas?.funil;
  const custo = metricas?.custo;
  const enviados = f?.enviados ?? daLista.enviados;
  const falhas = f?.falhas ?? daLista.falharam ?? 0;
  const motivos = metricas?.falhasPorMotivo ?? [];
  const gasto = custo && custo.situacao === "ok" && custo.total != null ? { ...custo, total: custo.total } : null;
  const porUnidade = gasto
    ? [
        gasto.porResposta != null ? `${dinheiro(gasto.porResposta, gasto.moeda)} por resposta` : null,
        gasto.porConversao != null ? `${dinheiro(gasto.porConversao, gasto.moeda)} por conversão` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const avisoDoCusto = custo && custo.situacao !== "ok" ? custo.aviso : null;

  return (
    <div className="mt-2 tela-baixa:mt-1.5">
      <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px] tela-baixa:gap-x-4">
        <Item rotulo="Entraram" valor={numero(f?.entraram ?? daLista.total)} />
        <Item rotulo="Enviados" valor={numero(enviados)} />
        <Item rotulo="Entregues" valor={numero(f?.entregues)} extra={pct(f?.entregues, enviados)} titulo="Percentual sobre os enviados" />
        <Item rotulo="Lidos" valor={numero(f?.lidos)} extra={pct(f?.lidos, f?.entregues)} titulo="Percentual sobre os entregues" />
        <Item
          rotulo="Responderam"
          valor={numero(f?.responderam ?? daLista.responderam)}
          extra={pct(f?.responderam, f?.entregues)}
          titulo="Percentual sobre os entregues"
        />
        <Item rotulo="Conversões" valor={numero(f?.conversoes ?? daLista.conversoes)} />
        <Item
          rotulo="Gasto"
          valor={gasto ? dinheiro(gasto.total, gasto.moeda) : "—"}
          extra={porUnidade}
          titulo={custo ? `Valores da Meta, atualizados em ${dataHora(custo.atualizadoEm)}. A Meta consolida o custo com horas de atraso.` : undefined}
        />
        {falhas > 0 && motivos.length > 0 ? (
          <div className="flex items-baseline">
            <dt className="sr-only">Falhas</dt>
            <dd>
              <button
                type="button"
                onClick={() => setVerFalhas((v) => !v)}
                aria-expanded={verFalhas}
                className="inline-flex items-baseline gap-1.5 rounded outline-none transition hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:hover:text-zinc-50 dark:focus-visible:ring-zinc-100/20"
              >
                <span className="text-zinc-500 dark:text-zinc-400">Falhas</span>
                <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">{numero(falhas)}</span>
                <ChevronDown className={`size-2.5 self-center text-zinc-400 transition-transform ${verFalhas ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            </dd>
          </div>
        ) : (
          <Item rotulo="Falhas" valor={numero(falhas)} />
        )}
      </dl>

      {(avisoDoCusto || erro) && (
        <p className="mt-1 truncate text-[11px] text-zinc-400 dark:text-zinc-500" title={avisoDoCusto ?? undefined}>
          {erro ? "Não consegui carregar entrega, leitura e gasto agora." : avisoDoCusto}
        </p>
      )}

      {verFalhas && motivos.length > 0 && (
        <ul aria-label="Falhas por motivo" className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto text-[12px] leading-snug tela-baixa:max-h-20">
          {motivos.map((m) => (
            <li key={m.motivo} className="flex gap-1.5 text-zinc-600 dark:text-zinc-300">
              <span className="min-w-0 truncate" title={m.motivo}>
                {m.motivo}
              </span>
              <span className="shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">· {numero(m.n)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
