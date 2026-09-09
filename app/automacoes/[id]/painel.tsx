"use client";

import Link from "next/link";
import { ArrowLeft, ChartNoAxesColumn, LogIn } from "lucide-react";
import Builder from "../builder";
import type { Fluxo } from "../dados";
import type { DefinicaoFluxo } from "@/lib/automacoes/tipos";

// Esta rota é só o editor. Desempenho, execuções e a leitura do fluxo ficam no
// painel de /automacoes?fluxo=<id> — o builder precisa da tela inteira, e
// espremido ao lado da lista a paleta e o canvas não cabem.
export default function EditorFluxo({
  fluxo,
  definicao,
  conversaInicial = null,
}: {
  fluxo: Fluxo;
  definicao: DefinicaoFluxo;
  // ?ia= da URL: a sidebar linkou uma conversa feita neste editor.
  conversaInicial?: string | null;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-conteudo">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <Link
          href={`/automacoes?fluxo=${fluxo.id}`}
          aria-label="Voltar para a automação"
          className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {fluxo.nome}
          </h1>
          <p className="flex items-center gap-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            <LogIn className="size-3 shrink-0" aria-hidden="true" />
            Por inscrição <span aria-hidden="true">·</span> v
            {fluxo.numero_versao ?? 1}
          </p>
        </div>

        <Link
          href={`/automacoes?fluxo=${fluxo.id}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <ChartNoAxesColumn className="size-3.5" aria-hidden="true" />
          Desempenho
        </Link>
      </header>

      <Builder
        fluxoId={fluxo.id}
        definicaoInicial={definicao}
        conversaInicial={conversaInicial}
      />
    </div>
  );
}
