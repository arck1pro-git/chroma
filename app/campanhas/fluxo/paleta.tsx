"use client";

// A coluna de blocos do construtor, por grupo. São poucos (o catálogo do
// contrato), então ficam todos à vista, sem a navegação por categoria do
// editor de Automações. Arrastar solta onde caiu; clicar põe depois do bloco
// selecionado (e já liga) ou no meio do canvas — o caminho de quem usa teclado
// ou tablet, onde arrastar não serve.
import { CATALOGO_CAMPANHA, type TipoBloco } from "@/lib/campanhas-fluxo";
import { COR_DO_GRUPO, GRUPOS, ICONE_DO_BLOCO } from "./aparencia";

// MIME próprio: o que cai no canvas é bloco DESTA paleta, não um arquivo ou
// texto de fora.
export const MIME_BLOCO_CAMPANHA = "application/x-amaan-bloco-campanha";

const TIPOS = Object.keys(CATALOGO_CAMPANHA) as TipoBloco[];

export default function Paleta({ aoAdicionar, depoisDe }: { aoAdicionar: (tipo: TipoBloco) => void; depoisDe: string | null }) {
  return (
    <aside aria-label="Blocos" className="flex w-48 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {GRUPOS.map(({ grupo, titulo }) => (
          <section key={grupo} className="mb-1.5">
            <h3 className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{titulo}</h3>
            {TIPOS.filter((tipo) => CATALOGO_CAMPANHA[tipo].grupo === grupo).map((tipo) => {
              const Icone = ICONE_DO_BLOCO[tipo];
              const { rotulo, descricao } = CATALOGO_CAMPANHA[tipo];
              return (
                <button
                  key={tipo}
                  type="button"
                  draggable
                  title={descricao}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MIME_BLOCO_CAMPANHA, tipo);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => aoAdicionar(tipo)}
                  className="flex w-full cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-900 active:cursor-grabbing tela-baixa:py-1 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100"
                >
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${COR_DO_GRUPO[grupo]}`}>
                    <Icone className="size-3" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 truncate text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{rotulo}</span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
      <p className="border-t border-zinc-200 px-3 py-2 text-[10px] leading-snug text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        {depoisDe ? `Clique para pôr depois de “${depoisDe}”, ou arraste.` : "Clique ou arraste para o canvas."}
      </p>
    </aside>
  );
}
