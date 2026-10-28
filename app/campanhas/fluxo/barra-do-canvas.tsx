"use client";

// O que flutua no alto do canvas da campanha: a pílula das pendências (com a
// contagem; abre a lista no painel, o único lugar com as frases — o cartão
// tem só o ponto âmbar), o Organizar e a faixa de quem usa o canvas (o "A IA
// desenhou o fluxo · Desfazer" do editor); o aviso de ligação recusada; e a
// dica curta do canvas vazio. Mora dentro do <ReactFlow> (os Panel se
// posicionam por ele). Saiu de ../fluxo-campanha.tsx em 2026-10-28, na
// divisão por assunto.
import { Panel } from "@xyflow/react";
import { CheckCircle2, ListTree, TriangleAlert, X } from "@/app/components/icones";
import { PILULA } from "./tema-canvas";

export default function BarraDoCanvas({
  editavel,
  pendencias,
  temBlocos,
  semPaleta,
  faixa,
  aviso,
  verPendencias,
  organizar,
  fecharAviso,
}: {
  editavel: boolean;
  pendencias: number;
  temBlocos: boolean;
  semPaleta: boolean;
  faixa?: React.ReactNode;
  aviso: string | null;
  verPendencias: () => void;
  organizar: () => void;
  fecharAviso: () => void;
}) {
  return (
    <>
      {editavel && (
        <Panel position="top-left" className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={verPendencias}
            className={`${PILULA} ${
              pendencias
                ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
            }`}
          >
            {pendencias ? <TriangleAlert className="size-3.5" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" />}
            {pendencias ? `${pendencias} ${pendencias === 1 ? "pendência" : "pendências"}` : "Sem pendências"}
          </button>
          {temBlocos && (
            <button
              type="button"
              onClick={organizar}
              title="Arrumar os blocos na ordem do fluxo"
              className={`${PILULA} border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:hover:text-zinc-50`}
            >
              <ListTree className="size-3.5 -rotate-90" aria-hidden="true" />
              Organizar
            </button>
          )}
          {faixa}
        </Panel>
      )}
      {aviso && (
        // Abaixo da fileira de pílulas: em 1024px elas e o aviso não cabem lado a lado.
        <Panel position="top-center" className="!top-12">
          <p role="alert" className="flex max-w-md items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 py-2 pl-3 pr-1.5 text-[12px] leading-snug text-amber-800 shadow-sm dark:border-amber-500/40 dark:bg-zinc-950 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1">{aviso}</span>
            <button type="button" onClick={fecharAviso} aria-label="Fechar aviso" className="rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-500/10">
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </p>
        </Panel>
      )}
      {editavel && !temBlocos && (
        <Panel position="top-center" className="!top-14">
          <p className="pointer-events-none max-w-xs text-center text-[12px] leading-relaxed text-zinc-400 dark:text-zinc-500">
            {semPaleta ? "Diga na conversa o que montar." : "Clique num bloco à esquerda ou use “Montar com IA”."}
          </p>
        </Panel>
      )}
    </>
  );
}
