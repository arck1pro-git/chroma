// A vista do canvas da campanha, com o React Flow: ajustar ao desenho
// (vistaLegivel, ./vista.ts) e acompanhar o tamanho do canvas logo depois, e
// deslizar até um bloco escolhido para ele não ficar embaixo do painel.
// Saiu de ../fluxo-campanha.tsx em 2026-10-28, na divisão por assunto; a
// lógica é a mesma.
import { useCallback, useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import type { FluxoCampanha, Posicao } from "@/lib/campanhas-fluxo";
import { vistaLegivel, type Caixa, type Medida } from "./vista";

/** O painel flutua a 12px da borda (right-3, painel-lateral.tsx). */
const FOLGA_DO_PAINEL = 12;

export function useVista({
  fluxo,
  areaRef,
  painelRef,
  larguraDoCartao,
}: {
  fluxo: FluxoCampanha;
  areaRef: React.RefObject<HTMLDivElement | null>;
  painelRef: React.RefObject<HTMLElement | null>;
  /** A largura de um cartão ainda não medido. */
  larguraDoCartao: number;
}) {
  const { getViewport, setViewport, getInternalNode } = useReactFlow();

  // O fluxo num ref: a vista e o observador de tamanho não podem nascer de novo
  // a cada quadro de arrasto (o fluxo muda a cada quadro).
  const fluxoRef = useRef(fluxo);
  useEffect(() => {
    fluxoRef.current = fluxo;
  });

  const aplicarVista = useCallback(
    (posicoes: Record<string, Posicao>, tamanhos: Record<string, Medida>, duracao: number) => {
      const area = areaRef.current?.getBoundingClientRect();
      if (!area) return;
      const caixas = new Map<string, Caixa>();
      for (const [id, p] of Object.entries(posicoes)) {
        const t = tamanhos[id];
        if (t) caixas.set(id, { x: p.x, y: p.y, w: t.width, h: t.height });
      }
      const vp = vistaLegivel(fluxoRef.current, caixas, area.width, area.height);
      if (vp) void setViewport(vp, { duration: duracao });
    },
    [setViewport, areaRef],
  );

  // A vista sai com a largura do momento, e as colunas de Campanhas ainda
  // podem estar saindo (o modo foco ao entrar no editor): por 1 s, ela
  // acompanha o tamanho novo do canvas. Conferido em 1920px, onde sem isto o
  // fluxo que cabia inteiro saía encostado à esquerda. Quem move a vista à mão
  // (arrastar o canvas, `mostrar` um bloco) encerra a janela.
  const vistaRecente = useRef<{ posicoes: Record<string, Posicao>; tamanhos: Record<string, Medida>; ate: number } | null>(null);
  const ajustarVista = useCallback(
    (posicoes: Record<string, Posicao>, tamanhos: Record<string, Medida>, duracao = 0) => {
      vistaRecente.current = { posicoes, tamanhos, ate: performance.now() + 1000 };
      aplicarVista(posicoes, tamanhos, duracao);
    },
    [aplicarVista],
  );
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const observador = new ResizeObserver(() => {
      const v = vistaRecente.current;
      if (v && performance.now() < v.ate) aplicarVista(v.posicoes, v.tamanhos, 0);
    });
    observador.observe(el);
    return () => observador.disconnect();
    // aplicarVista só depende de setViewport e do ref, que não mudam: o observador nasce uma vez.
  }, [aplicarVista, areaRef]);

  /** Mover a vista à mão encerra o acompanhar do tamanho. */
  const soltarVista = useCallback(() => {
    vistaRecente.current = null;
  }, []);

  // O bloco escolhido fica à vista: o painel abre por cima da direita do
  // canvas e cobriria justamente o bloco que se acabou de clicar; o item da
  // lista de pendências pode estar fora da tela. Desliza o canvas o mínimo, sem
  // mudar o zoom.
  const mostrar = useCallback(
    (id: string) => {
      vistaRecente.current = null;
      requestAnimationFrame(() => {
        const area = areaRef.current?.getBoundingClientRect();
        const no = getInternalNode(id);
        if (!area || !no) return;
        const vp = getViewport();
        // O painel flutua sobre a direita do canvas (painel-lateral.tsx); fechado, não está na página.
        const painel = painelRef.current;
        const cobre = painel ? painel.offsetWidth + FOLGA_DO_PAINEL : 0;
        const desloca = (inicio: number, tamanho: number, fim: number) => {
          if (inicio + tamanho > fim) return Math.max(fim - (inicio + tamanho), 24 - inicio);
          return inicio < 24 ? 24 - inicio : 0;
        };
        const dx = desloca(
          no.internals.positionAbsolute.x * vp.zoom + vp.x,
          (no.measured.width ?? larguraDoCartao) * vp.zoom,
          area.width - cobre - 24,
        );
        const dy = desloca(no.internals.positionAbsolute.y * vp.zoom + vp.y, (no.measured.height ?? 80) * vp.zoom, area.height - 24);
        if (dx || dy) void setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy }, { duration: 200 });
      });
    },
    [getInternalNode, getViewport, setViewport, areaRef, painelRef, larguraDoCartao],
  );

  return { ajustarVista, mostrar, soltarVista };
}
