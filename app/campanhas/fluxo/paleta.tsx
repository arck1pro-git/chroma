"use client";

// A coluna de blocos do construtor, por grupo (Mensagem, Espera, Controle,
// CRM, Equipe). São poucos (o catálogo do contrato), então ficam todos à
// vista, sem a navegação por categoria do editor de Automações. Arrastar solta
// onde caiu; clicar põe depois do bloco selecionado (e já liga) ou no meio do
// canvas — o caminho de quem usa teclado ou tablet, onde arrastar não serve.
//
// Compacta desde 2026-10-28 (pedido dele: "muito texto"): ícone e rótulo
// curto (ROTULO_CURTO, ./aparencia.ts), o nome inteiro e o que o bloco faz no
// title, sem rodapé de instrução. Recolhe para só os ícones; a escolha fica no
// aparelho, e abaixo de 1280px ela nasce recolhida, como as colunas de
// Campanhas.
import { CATALOGO_CAMPANHA, type TipoBloco } from "@/lib/campanhas-fluxo";
import { PanelLeft, PanelLeftClose } from "@/app/components/icones";
import { criarPreferencia } from "@/app/components/preferencia-local";
import { COR_DO_GRUPO, GRUPOS, ICONE_DO_BLOCO, ROTULO_CURTO } from "./aparencia";

// MIME próprio: o que cai no canvas é bloco DESTA paleta, não um arquivo ou
// texto de fora.
export const MIME_BLOCO_CAMPANHA = "application/x-amaan-bloco-campanha";

const TIPOS = Object.keys(CATALOGO_CAMPANHA) as TipoBloco[];

const preferenciaPaleta = criarPreferencia("chroma:campanhas-paleta-recolhida", () => window.innerWidth < 1280);

export default function Paleta({ aoAdicionar, depoisDe }: { aoAdicionar: (tipo: TipoBloco) => void; depoisDe: string | null }) {
  const recolhida = preferenciaPaleta.useValor();
  const rotuloRecolher = recolhida ? "Mostrar os nomes dos blocos" : "Só os ícones";
  const IconeRecolher = recolhida ? PanelLeft : PanelLeftClose;
  return (
    <aside
      aria-label="Blocos"
      className={`flex shrink-0 flex-col border-r border-zinc-200 bg-white transition-[width] dark:border-zinc-800 dark:bg-zinc-950 ${recolhida ? "w-12" : "w-44"}`}
    >
      <div className={`flex items-center border-b border-zinc-200 py-1.5 dark:border-zinc-800 ${recolhida ? "justify-center" : "justify-between pl-3 pr-1.5"}`}>
        {!recolhida && <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Blocos</span>}
        <button
          type="button"
          onClick={() => preferenciaPaleta.definir(!recolhida)}
          aria-label={rotuloRecolher}
          title={rotuloRecolher}
          className="flex size-7 items-center justify-center rounded-md text-zinc-400 outline-none transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:text-zinc-500 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 dark:focus-visible:ring-zinc-100/20"
        >
          <IconeRecolher className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {GRUPOS.map(({ grupo, titulo }, i) => (
          <section key={grupo} aria-label={titulo}>
            {recolhida ? (
              i > 0 && <hr className="mx-1.5 my-1 border-zinc-200 dark:border-zinc-800" />
            ) : (
              <h3 className={`px-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 ${i ? "pt-2" : "pt-0.5"}`}>
                {titulo}
              </h3>
            )}
            {TIPOS.filter((tipo) => CATALOGO_CAMPANHA[tipo].grupo === grupo).map((tipo) => {
              const Icone = ICONE_DO_BLOCO[tipo];
              const { rotulo, descricao } = CATALOGO_CAMPANHA[tipo];
              return (
                <button
                  key={tipo}
                  type="button"
                  draggable
                  aria-label={recolhida ? rotulo : undefined}
                  title={`${rotulo}: ${descricao}${depoisDe ? ` Clique para pôr depois de “${depoisDe}”.` : ""}`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MIME_BLOCO_CAMPANHA, tipo);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => aoAdicionar(tipo)}
                  className={`flex w-full cursor-grab items-center gap-2 rounded-lg py-1 text-left outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-900 active:cursor-grabbing dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100 ${
                    recolhida ? "justify-center px-0" : "px-1.5"
                  }`}
                >
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset tela-baixa:size-6 ${COR_DO_GRUPO[grupo]}`}>
                    <Icone className="size-3.5 tela-baixa:size-3" aria-hidden="true" />
                  </span>
                  {!recolhida && <span className="min-w-0 truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">{ROTULO_CURTO[tipo]}</span>}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}
