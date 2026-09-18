"use client";

// A barra de rolagem da etapa, desenhada por nós.
//
// POR QUE NÃO A NATIVA: o pedido é que a barra apareça SEMPRE, "mesmo que não
// dê pra mover". Nenhum navegador faz isso. `overflow-y: scroll` mantém a calha
// reservada, mas o polegar só é desenhado quando há transbordo — não existe CSS
// que o force numa coluna com dois cards. Como o polegar é justamente a parte
// que se procura e se arrasta, a única saída é desenhar.
//
// O QUE ISSO COMPRA, além do pedido: as setas passam a funcionar no Firefox.
// A versão em CSS dependia de ::-webkit-scrollbar-button, que só existe em
// Chrome/Edge — no Firefox a barra ficava sem seta nenhuma.
//
// O QUE ELE NÃO FAZ: substituir a rolagem. Quem rola continua sendo o elemento
// nativo, com roda do mouse, teclado e trackpad intactos. Este componente é um
// ESPELHO — lê scrollTop/scrollHeight e escreve scrollTop quando arrastam. Se
// ele quebrar, a coluna continua rolando.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/** Altura mínima do polegar, para ele não virar um risco em lista longa. */
const MIN_POLEGAR = 28;
/** O quanto uma seta rola por clique. */
const PASSO = 120;

export default function BarraRolagem({
  alvoRef,
  /** Muda quando o conteúdo muda: refaz a medida sem depender de observer. */
  dependencia,
}: {
  alvoRef: React.RefObject<HTMLElement | null>;
  dependencia?: unknown;
}) {
  const trilhoRef = useRef<HTMLDivElement | null>(null);
  const [medida, setMedida] = useState({ topo: 0, altura: 0, rolavel: false });
  const arrastando = useRef<{ yInicial: number; scrollInicial: number } | null>(
    null,
  );

  const medir = useCallback(() => {
    const alvo = alvoRef.current;
    const trilho = trilhoRef.current;
    if (!alvo || !trilho) return;

    const pista = trilho.clientHeight;
    const { scrollHeight, clientHeight, scrollTop } = alvo;

    // Cabe tudo: o polegar ocupa a pista inteira. É o estado "não dá pra mover"
    // do pedido — a barra continua desenhada, cheia, dizendo que não há mais
    // nada abaixo. Some seria mentir por omissão numa coluna que pode encher a
    // qualquer momento.
    if (scrollHeight <= clientHeight + 1) {
      setMedida({ topo: 0, altura: pista, rolavel: false });
      return;
    }

    const altura = Math.max(MIN_POLEGAR, (clientHeight / scrollHeight) * pista);
    // O curso do polegar é a pista MENOS ele mesmo: sem descontar, ele passaria
    // do fim do trilho justamente no fim da rolagem.
    const curso = pista - altura;
    const progresso = scrollTop / (scrollHeight - clientHeight);
    setMedida({ topo: progresso * curso, altura, rolavel: true });
  }, [alvoRef]);

  // Remede quando o conteúdo rola, quando a janela muda de tamanho e quando a
  // própria coluna muda de altura (abrir a gaveta de contatos encolhe o quadro).
  useEffect(() => {
    const alvo = alvoRef.current;
    if (!alvo) return;

    medir();
    alvo.addEventListener("scroll", medir, { passive: true });

    const observer = new ResizeObserver(medir);
    observer.observe(alvo);
    // O primeiro filho é quem cresce quando entra card; observar só o alvo não
    // pega isso, porque a altura DELE não muda.
    if (alvo.firstElementChild) observer.observe(alvo.firstElementChild);

    return () => {
      alvo.removeEventListener("scroll", medir);
      observer.disconnect();
    };
  }, [alvoRef, medir, dependencia]);

  // ── Arrastar o polegar ────────────────────────────────────────────────────
  //
  // Os listeners vão no WINDOW e não no polegar: quem arrasta sai do elemento o
  // tempo todo, e preso a ele a barra pararia de seguir o mouse no primeiro
  // movimento lateral.
  useEffect(() => {
    function aoMover(e: PointerEvent) {
      const estado = arrastando.current;
      const alvo = alvoRef.current;
      const trilho = trilhoRef.current;
      if (!estado || !alvo || !trilho) return;

      const pista = trilho.clientHeight;
      const curso = pista - medida.altura;
      if (curso <= 0) return;

      const rolavel = alvo.scrollHeight - alvo.clientHeight;
      const delta = ((e.clientY - estado.yInicial) / curso) * rolavel;
      alvo.scrollTop = estado.scrollInicial + delta;
    }
    function aoSoltar() {
      arrastando.current = null;
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoSoltar);
    return () => {
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSoltar);
    };
  }, [alvoRef, medida.altura]);

  function rolar(passo: number) {
    alvoRef.current?.scrollBy({ top: passo, behavior: "smooth" });
  }

  const cinza =
    "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

  return (
    // `select-none` e não `pointer-events-none`: a barra RECEBE clique (é o que
    // permite arrastar), só não pode deixar o texto ser selecionado junto.
    <div className="flex w-3 shrink-0 select-none flex-col items-center py-1">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => rolar(-PASSO)}
        className={`shrink-0 transition ${cinza}`}
      >
        <ChevronUp className="size-3" />
      </button>

      {/* O trilho. Fundo transparente de propósito: o que aparece atrás é o
          fundo da própria etapa, com a alfa dele — fixar um cinza aqui erraria
          o tom, porque aquele fundo é translúcido sobre a página. */}
      <div ref={trilhoRef} className="relative my-1 w-full flex-1">
        <div
          onPointerDown={(e) => {
            if (!medida.rolavel || !alvoRef.current) return;
            arrastando.current = {
              yInicial: e.clientY,
              scrollInicial: alvoRef.current.scrollTop,
            };
            // Sem isto, arrastar seleciona os cards por baixo.
            document.body.style.userSelect = "none";
          }}
          style={{ top: medida.topo, height: medida.altura }}
          className={`absolute left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-zinc-500 transition-colors dark:bg-zinc-500 ${
            medida.rolavel
              ? "cursor-grab hover:bg-zinc-700 active:cursor-grabbing dark:hover:bg-zinc-400"
              : ""
          }`}
        />
      </div>

      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => rolar(PASSO)}
        className={`shrink-0 transition ${cinza}`}
      >
        <ChevronDown className="size-3" />
      </button>
    </div>
  );
}
