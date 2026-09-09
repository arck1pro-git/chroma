"use client";

import { useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CircleCheck, CircleX, Hourglass, MousePointerClick } from "lucide-react";
import { dataHora } from "../formato";
import NoMetrica, { type NoDeMetrica } from "./no-metrica";
import type { DetalheFluxo } from "./dados";

const tiposDeNo: NodeTypes = { metrica: NoMetrica };

const ICONE_ESTADO = {
  sucesso: CircleCheck,
  erro: CircleX,
  esperando: Hourglass,
} as const;

const COR_ESTADO = {
  sucesso: "text-emerald-600 dark:text-emerald-400",
  erro: "text-rose-600 dark:text-rose-400",
  esperando: "text-amber-500",
} as const;

export default function FluxoComMetricas({
  detalhe,
}: {
  detalhe: DetalheFluxo;
}) {
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const { nos, arestas } = useMemo(() => {
    // Entrada do funil = o bloco com mais passagens (o nó de entrada). É a base
    // da proporção de cada cartão.
    const base = Math.max(...detalhe.porBloco.map((p) => p.passaram), 1);

    const nos: NoDeMetrica[] = detalhe.porBloco.map((p) => ({
      id: p.no_id,
      type: "metrica",
      position: detalhe.layout[p.no_id] ?? { x: 0, y: 0 },
      data: {
        tipo: p.no_tipo,
        rotulo: p.rotulo,
        passaram: p.passaram,
        erros: p.erros,
        proporcao: p.passaram / base,
      },
      draggable: false,
    }));

    const arestas: Edge[] = detalhe.arestas.map((a) => ({
      id: `${a.de}-${a.para}`,
      source: a.de,
      target: a.para,
      sourceHandle: a.ramo ?? "padrao",
      type: "smoothstep",
      label: a.ramo === "verdadeiro" ? "Sim" : a.ramo === "falso" ? "Não" : undefined,
      labelBgStyle: { fill: "transparent" },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    }));

    return { nos, arestas };
  }, [detalhe]);

  const bloco = detalhe.porBloco.find((p) => p.no_id === selecionado);
  const passantes = selecionado ? detalhe.leadsPorBloco[selecionado] : undefined;

  if (detalhe.porBloco.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-16 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        Nenhum passo executado ainda
      </p>
    );
  }

  return (
    <div className="viz flex flex-col gap-3 lg:flex-row">
      <div className="h-[420px] min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-black">
        <ReactFlow
          nodes={nos}
          edges={arestas}
          nodeTypes={tiposDeNo}
          onNodeClick={(_, no) =>
            setSelecionado((atual) => (atual === no.id ? null : no.id))
          }
          onPaneClick={() => setSelecionado(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          // Sem zoom na roda e sem pan por rolagem: este canvas vive dentro de
          // uma página que rola, e capturar a roda prenderia a rolagem aqui.
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          colorMode="system"
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          className="bg-conteudo"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>

      <aside className="flex w-full shrink-0 flex-col rounded-lg border border-zinc-200 bg-white p-3 lg:w-64 dark:border-zinc-800 dark:bg-zinc-950">
        {bloco && passantes ? (
          <div className="surge flex min-h-0 flex-1 flex-col">
            <h3 className="truncate text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">
              {bloco.rotulo}
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              {passantes.total === 0
                ? "Ninguém passou por aqui"
                : `${passantes.total} passaram · mostrando ${passantes.amostra.length}`}
            </p>

            <ul className="mt-2.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {passantes.amostra.map((l, i) => {
                const Icone = ICONE_ESTADO[l.estado];
                return (
                  <li
                    key={`${l.contato_nome}-${i}`}
                    style={{ animationDelay: `${Math.min(i, 6) * 14}ms` }}
                    className="surge-suave flex items-center gap-2 rounded-md px-1.5 py-1"
                  >
                    <Icone
                      className={`size-3.5 shrink-0 ${COR_ESTADO[l.estado]}`}
                      aria-label={l.estado}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-700 dark:text-zinc-200">
                      {l.contato_nome}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                      {dataHora(l.quando)}
                    </span>
                  </li>
                );
              })}
            </ul>

            {passantes.total > passantes.amostra.length && (
              <p className="mt-2 border-t border-zinc-200 pt-2 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                A lista completa vem com a paginação, junto da persistência.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <MousePointerClick
              className="size-5 text-zinc-300 dark:text-zinc-700"
              aria-hidden="true"
            />
            <p className="text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
              Clique num bloco para ver quem passou por ele.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
