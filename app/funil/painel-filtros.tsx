"use client";

// Os filtros do quadro, guardados atrás de um botão.
//
// POR QUE SAIR DA LINHA FIXA: eram oito controles (busca, período, responsável,
// segmentos, tags, localização, limpar, resumo) numa faixa acima do quadro. Em
// tela estreita a faixa quebrava em duas ou três linhas e empurrava o kanban
// para baixo — o quadro perdia altura justamente onde ele é útil, que é mostrar
// o máximo de card que couber. Agora ocupam uma linha de botão, e o resto abre
// por cima quando alguém for de fato filtrar.
//
// POR CIMA DE TUDO, e não um acordeão que empurra: abrir o painel não pode
// mexer na altura do quadro. Se empurrasse, escolher um filtro reflowaria as
// colunas por baixo enquanto a pessoa ainda está escolhendo.
//
// O QUE ESTE ARQUIVO NÃO FAZ: mexer nos controles. Quem os desenha continua
// sendo BarraFiltros — aqui só entram o gatilho, o véu e a moldura. Era o
// caminho com menos risco: os controles seguem um componente só, usado por
// quem mais precisar, e mudar a apresentação não toca a regra de filtro.
import { useEffect, useRef } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import BarraFiltros from "./barra-filtros";
import { contarFiltrosAtivos, filtrosVazios, type Filtros } from "./filtros";
import type { Contato, Funil, Segmento, Tag, Usuario } from "../data";

export default function PainelFiltros({
  aberto,
  aoAlternar,
  funis,
  usuarios,
  segmentos,
  tags,
  contatos,
  funilId,
  aoTrocarFunil,
  filtros,
  aoMudarFiltros,
  visiveis,
  total,
}: {
  aberto: boolean;
  aoAlternar: (aberto: boolean) => void;
  funis: Funil[];
  usuarios: Usuario[];
  segmentos: Segmento[];
  tags: Tag[];
  contatos: Contato[];
  funilId: string;
  aoTrocarFunil: (id: string) => void;
  filtros: Filtros;
  aoMudarFiltros: (f: Filtros) => void;
  visiveis: number;
  total: number;
}) {
  const ativos = contarFiltrosAtivos(filtros);
  const painelRef = useRef<HTMLDivElement | null>(null);

  // Esc fecha. Só enquanto está aberto: um listener permanente no documento
  // roubaria o Esc da ficha e do painel de cadência, que também o usam.
  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoAlternar(false);
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, aoAlternar]);

  // O foco entra no painel ao abrir: sem isto, quem navega por teclado continua
  // no botão lá atrás e o Tab passeia pela página inteira antes de chegar aqui.
  useEffect(() => {
    if (aberto) painelRef.current?.focus();
  }, [aberto]);

  return (
    <>
      <div className="surge mb-1 flex shrink-0 flex-wrap items-center gap-2 pr-6 xl:pr-16">
        <button
          type="button"
          onClick={() => aoAlternar(!aberto)}
          aria-expanded={aberto}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:focus-visible:ring-zinc-100/10 ${
            ativos > 0
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
          Filtros
          {ativos > 0 && (
            <span className="rounded-full bg-white px-1.5 text-[10px] font-semibold tabular-nums text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50">
              {ativos}
            </span>
          )}
        </button>

        {/* O resumo fica FORA do painel, ao lado do gatilho. É o que diz que o
            quadro está recortado — e essa informação não pode depender de abrir
            o painel, senão some justamente quando o filtro está valendo. */}
        {ativos > 0 && (
          <>
            <span className="text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {visiveis} de {total}
            </span>
            <button
              type="button"
              onClick={() => aoMudarFiltros(filtrosVazios)}
              className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              <X className="size-3 shrink-0" aria-hidden="true" />
              Limpar
            </button>
          </>
        )}
      </div>

      {aberto && (
        <>
          {/* O véu. Clicar fora fecha — é o gesto que todo mundo tenta antes de
              procurar o X. */}
          <div
            onClick={() => aoAlternar(false)}
            className="fixed inset-0 z-40 bg-zinc-900/20 backdrop-blur-[2px] dark:bg-zinc-950/40"
            aria-hidden="true"
          />

          <div
            ref={painelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Filtros do quadro"
            // `overflow-visible` de propósito: os controles de segmento, tag e
            // localização abrem dropdown posicionado em absolute (ver Menu, em
            // app/components/filtros-ui.tsx). Com overflow no painel, a lista
            // deles seria cortada na borda — e a de localização é a mais alta.
            className="surge fixed left-1/2 top-24 z-50 w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 overflow-visible rounded-2xl border border-zinc-200 bg-white shadow-xl outline-none dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                Filtrar o quadro
              </h2>
              {/* Sem contagem aqui: BarraFiltros já termina com ResumoFiltros,
                  e dois "X de Y" na mesma caixa é ruído. A contagem da linha
                  recolhida, essa sim, é necessária — lá não há o resumo. */}
              <button
                type="button"
                onClick={() => aoAlternar(false)}
                className="ml-auto rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="Fechar filtros"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {/* Os mesmos controles de sempre, só que numa caixa larga em vez de
                numa faixa: aqui a quebra de linha é bem-vinda, porque não há
                quadro embaixo para ser empurrado. */}
            <BarraFiltros
              mostrarFunil={false}
              moldura="p-4"
              linha="flex flex-wrap items-center gap-2"
              funis={funis}
              usuarios={usuarios}
              segmentos={segmentos}
              tags={tags}
              contatos={contatos}
              funilId={funilId}
              aoTrocarFunil={aoTrocarFunil}
              filtros={filtros}
              aoMudarFiltros={aoMudarFiltros}
              visiveis={visiveis}
              total={total}
            />
          </div>
        </>
      )}
    </>
  );
}
