// O visual do canvas da campanha que não é dos cartões: o tema do React Flow
// pelas variáveis dele, as setas, o rótulo das ligações, a linha do arrasto e
// a pílula dos botões soltos no canvas. Saiu de ../fluxo-campanha.tsx em
// 2026-10-28, na divisão por assunto.
//
// Classes literais de propósito: o Tailwind varre o código-fonte, e classe
// montada por concatenação seria purgada no build.
import { MarkerType } from "@xyflow/react";

// A seta acompanha a cor da linha pela variável (ver defaultMarkerColor). A
// ligação em destaque tem marcador próprio: os marcadores são compartilhados
// por todas as ligações, e a cor de um não muda só para uma delas.
export const SETA = { type: MarkerType.ArrowClosed, width: 12, height: 12 } as const;
export const SETA_FORTE = { ...SETA, color: "var(--xy-edge-stroke-selected)" } as const;
export const ROTULO_ARESTA = {
  labelStyle: { fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  labelBgStyle: { stroke: "var(--borda-do-rotulo)", strokeWidth: 1 },
  labelBgPadding: [6, 3] as [number, number],
  labelBgBorderRadius: 999,
};

// O tema do React Flow pelas variáveis dele, com a variante `dark` do projeto:
// o `colorMode` do pacote só segue o sistema, não o botão de sol e lua da
// barra (classe no <html>). O CSS do pacote fica fora das camadas do Tailwind
// e venceria qualquer utilitário; variável não, porque ele mesmo a lê. Por isso
// o hover e o destaque mudam a variável na ligação (o <g>), e o traço dentro
// dela herda.
export const TEMA_DO_CANVAS = [
  "[--xy-background-color:transparent]",
  "[--xy-background-pattern-color:#d4d4d8] dark:[--xy-background-pattern-color:#3f3f46]",
  "[--xy-edge-stroke:#a1a1aa] dark:[--xy-edge-stroke:#52525b]",
  "[--xy-edge-stroke-width:1.6]",
  "[--xy-edge-stroke-selected:#18181b] dark:[--xy-edge-stroke-selected:#f4f4f5]",
  "[&_.react-flow__edge:hover]:[--xy-edge-stroke:#52525b] dark:[&_.react-flow__edge:hover]:[--xy-edge-stroke:#a1a1aa]",
  "[&_.react-flow__edge.selected]:[--xy-edge-stroke-width:2.4] [&_.react-flow__edge.em-destaque]:[--xy-edge-stroke-width:2]",
  "[&_.react-flow__edge.em-destaque]:[--xy-edge-stroke:var(--xy-edge-stroke-selected)]",
  "[--xy-connectionline-stroke:#71717a] dark:[--xy-connectionline-stroke:#a1a1aa] [--xy-connectionline-stroke-width:1.6]",
  "[--xy-edge-label-background-color:#ffffff] dark:[--xy-edge-label-background-color:#09090b]",
  "[--xy-edge-label-color:#3f3f46] dark:[--xy-edge-label-color:#e4e4e7]",
  "[--borda-do-rotulo:#e4e4e7] dark:[--borda-do-rotulo:#3f3f46]",
  "[--xy-controls-box-shadow:0_1px_2px_rgb(0_0_0/0.06)]",
  "[--xy-controls-button-background-color:#ffffff] dark:[--xy-controls-button-background-color:#18181b]",
  "[--xy-controls-button-background-color-hover:#f4f4f5] dark:[--xy-controls-button-background-color-hover:#27272a]",
  "[--xy-controls-button-color:#3f3f46] dark:[--xy-controls-button-color:#e4e4e7]",
  "[--xy-controls-button-color-hover:#18181b] dark:[--xy-controls-button-color-hover:#fafafa]",
  "[--xy-controls-button-border-color:#e4e4e7] dark:[--xy-controls-button-border-color:#27272a]",
].join(" ");

// O traço da linha que acompanha o arrasto: tracejada até soltar num bloco.
export const LINHA_DO_ARRASTO = { strokeDasharray: "5 4" };

// Os botões soltos no canvas (pendências, Organizar): a mesma pílula.
export const PILULA =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:focus-visible:ring-zinc-100/20";
