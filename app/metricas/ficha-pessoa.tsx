"use client";

// A ficha de uma pessoa nas Métricas: abre da direita ao clicar na linha dela
// na tabela, com a mesma casca da gaveta de Demandas e da ficha da
// oportunidade (véu, cabeçalho fixo, miolo rolando).
//
// TUDO DE UMA PESSOA NUM LUGAR: o que está na mesa agora (em aberto,
// atrasadas, vencendo hoje), os três períodos, o gráfico e a lista do que está
// em aberto, da mais urgente para a menos.
//
// ANTERIOR E PRÓXIMA (setas no topo, ou ← e → no teclado) seguem a ordem da
// tabela: dá para passar a equipe inteira sem fechar a ficha — é o "ver o
// desempenho de cada um" que ele pediu em 2026-10-08.
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import CamadaTopo from "../components/camada-topo";
import type { Aberta, PessoaDasMetricas, Recorte } from "./demandas";
import { Agora, Avatar, Grafico, NaMesa, TresPeriodos, type Visao } from "./pecas";

export default function FichaPessoa({
  pessoa,
  recorte,
  abertas,
  hoje,
  visao,
  aoMudarVisao,
  posicao,
  aoAnterior,
  aoProxima,
  aoFechar,
}: {
  pessoa: PessoaDasMetricas;
  recorte: Recorte;
  abertas: Aberta[];
  hoje: string;
  visao: Visao;
  aoMudarVisao: (v: Visao) => void;
  /** "3 de 8", na ordem da tabela. */
  posicao: { atual: number; total: number };
  aoAnterior: (() => void) | null;
  aoProxima: (() => void) | null;
  aoFechar: () => void;
}) {
  const fechar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fechar.current?.focus();
  }, []);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
      // As setas trocam de pessoa — menos dentro de um campo ou do gráfico, que
      // usa as setas para andar pelos dias.
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest("input, textarea, select, canvas, [role=radiogroup]")) return;
      if (e.key === "ArrowLeft" && aoAnterior) aoAnterior();
      if (e.key === "ArrowRight" && aoProxima) aoProxima();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, aoAnterior, aoProxima]);

  const navegar =
    "flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";

  return (
    <CamadaTopo>
      <div className="veu-surge fixed inset-0 z-[300] bg-black/30 backdrop-blur-[1px] dark:bg-black/50" onClick={aoFechar} aria-hidden="true" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Desempenho de ${pessoa.nome}`}
        className="ficha-entra fixed bottom-3 right-3 top-3 z-[310] flex w-[36rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <Avatar nome={pessoa.nome} iniciais={pessoa.iniciais} tamanho="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{pessoa.nome}</h2>
            <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">
              {pessoa.departamento ?? "Sem departamento"}
              <span className="text-zinc-300 dark:text-zinc-600"> · </span>
              <span className="tabular-nums">
                {posicao.atual} de {posicao.total}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" onClick={aoAnterior ?? undefined} disabled={!aoAnterior} aria-label="Pessoa anterior" title="Anterior (←)" className={navegar}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={aoProxima ?? undefined} disabled={!aoProxima} aria-label="Próxima pessoa" title="Próxima (→)" className={navegar}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
            <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" aria-hidden="true" />
            <button ref={fechar} type="button" onClick={aoFechar} aria-label="Fechar" className={navegar}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* key pela pessoa: trocar de pessoa reinicia a rolagem e a entrada. */}
        <div key={pessoa.id} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <Agora abertas={abertas} hoje={hoje} />
          <TresPeriodos r={recorte} hoje={hoje} />
          <Grafico r={recorte} hoje={hoje} visao={visao} aoMudarVisao={aoMudarVisao} compacto />
          <NaMesa abertas={abertas} hoje={hoje} vazio={`Nada em aberto com ${pessoa.nome.split(" ")[0]}.`} />
        </div>
      </aside>
    </CamadaTopo>
  );
}
