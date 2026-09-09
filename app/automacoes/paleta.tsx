"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, SearchX } from "lucide-react";
import { BLOCOS_POR_DOMINIO, CATALOGO, SECOES } from "@/lib/automacoes/catalogo";
import type { Bloco, Dominio } from "@/lib/automacoes/tipos";
import { normalizar } from "../filtros-comuns";
import { CORES, ICONES, ICONES_DOMINIO, ICONE_PADRAO } from "./aparencia";

// MIME próprio: identifica que o que está sendo arrastado é bloco DESTA paleta,
// e não um arquivo ou texto de fora que cairia no canvas por acidente.
export const MIME_BLOCO = "application/x-chroma-bloco";

// Índice de busca montado uma vez: o catálogo é constante em tempo de execução,
// então normalizar a cada tecla seria trabalho jogado fora.
const INDICE = new Map(
  CATALOGO.map((b) => [b.tipo, normalizar(`${b.rotulo} ${b.descricao} ${b.tipo}`)]),
);

const SECAO_POR_DOMINIO = new Map(SECOES.map((s) => [s.dominio, s]));

function ItemBloco({
  bloco,
  aoAdicionar,
}: {
  bloco: Bloco;
  aoAdicionar: (tipo: string) => void;
}) {
  const Icone = ICONES[bloco.tipo] ?? ICONE_PADRAO;

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME_BLOCO, bloco.tipo);
        e.dataTransfer.effectAllowed = "copy";
      }}
      // Arrastar não funciona por teclado. O clique adiciona no centro do
      // canvas — mesma ação, alcançável por Tab e por quem usa leitor de tela.
      onClick={() => aoAdicionar(bloco.tipo)}
      className="surge flex w-full cursor-grab items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left outline-none transition hover:border-zinc-200 hover:bg-white focus-visible:ring-2 focus-visible:ring-zinc-900 active:cursor-grabbing dark:hover:border-zinc-800 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100"
    >
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${CORES[bloco.dominio]}`}
      >
        <Icone className="size-3" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
            {bloco.rotulo}
          </span>
          {bloco.indisponivel && (
            <span
              title={bloco.indisponivel}
              aria-label={bloco.indisponivel}
              className="size-1.5 shrink-0 rounded-full bg-amber-400"
            />
          )}
        </span>
        {/* A descrição só cabe aqui dentro da categoria; na lista corrida
            anterior ela teria que sair, e o nome sozinho não explica o bloco. */}
        <span className="mt-0.5 block text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
          {bloco.descricao}
        </span>
      </span>
    </button>
  );
}

function ItemCategoria({
  dominio,
  titulo,
  descricao,
  total,
  aoAbrir,
}: {
  dominio: Dominio;
  titulo: string;
  descricao: string;
  total: number;
  aoAbrir: () => void;
}) {
  const Icone = ICONES_DOMINIO[dominio];

  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="surge flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left outline-none transition hover:border-zinc-200 hover:bg-white focus-visible:ring-2 focus-visible:ring-zinc-900 dark:hover:border-zinc-800 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100"
    >
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${CORES[dominio]}`}
      >
        <Icone className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-100">
          {titulo}
        </span>
        <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">
          {descricao}
        </span>
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
        {total}
      </span>
      <ChevronRight
        className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-600"
        aria-hidden="true"
      />
    </button>
  );
}

export default function Paleta({
  aoAdicionar,
}: {
  aoAdicionar: (tipo: string) => void;
}) {
  const [termo, setTermo] = useState("");
  const [aberta, setAberta] = useState<Dominio | null>(null);

  const buscando = termo.trim().length > 0;

  // Busca atravessa as categorias: quem digita "whatsapp" não deveria precisar
  // saber que o bloco mora em Comunicação. Por isso ela ignora a navegação.
  const encontrados = useMemo(() => {
    if (!buscando) return [];
    const t = normalizar(termo.trim());
    return CATALOGO.filter((b) => INDICE.get(b.tipo)?.includes(t));
  }, [termo, buscando]);

  const secaoAberta = aberta ? SECAO_POR_DOMINIO.get(aberta) : undefined;
  const blocosDaSecao = aberta ? (BLOCOS_POR_DOMINIO.get(aberta) ?? []) : [];

  // Legenda do ponto âmbar só faz sentido quando há blocos na tela para marcar.
  const mostrandoBlocos = buscando ? encontrados.length > 0 : aberta !== null;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-black">
      <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar em todos os blocos…"
            aria-label="Buscar bloco"
            className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-2.5 text-[12px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400"
          />
        </div>
      </div>

      {/* Cabeçalho da categoria aberta. Fica fora da área rolável para o botão
          de voltar não sumir ao descer numa lista longa. */}
      {!buscando && secaoAberta && (
        <button
          type="button"
          onClick={() => setAberta(null)}
          className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-2 text-left outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 dark:border-zinc-800 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100"
        >
          <ChevronLeft
            className="size-3.5 shrink-0 text-zinc-400"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">
              {secaoAberta.titulo}
            </span>
            <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">
              Voltar às categorias
            </span>
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {blocosDaSecao.length}
          </span>
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {buscando ? (
          encontrados.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-12 text-center">
              <SearchX
                className="size-5 text-zinc-300 dark:text-zinc-700"
                aria-hidden="true"
              />
              <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
                Nenhum bloco com “{termo}”
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {/* Resultado de busca mostra a categoria de cada bloco: sem isso,
                  o usuário perde a noção de onde a coisa mora. */}
              {encontrados.map((b) => (
                <div key={b.tipo}>
                  <p className="px-2 pt-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-300 dark:text-zinc-600">
                    {SECAO_POR_DOMINIO.get(b.dominio)?.titulo}
                  </p>
                  <ItemBloco bloco={b} aoAdicionar={aoAdicionar} />
                </div>
              ))}
            </div>
          )
        ) : aberta ? (
          <div className="flex flex-col gap-0.5">
            {blocosDaSecao.map((b) => (
              <ItemBloco key={b.tipo} bloco={b} aoAdicionar={aoAdicionar} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {SECOES.map((s) => (
              <ItemCategoria
                key={s.dominio}
                dominio={s.dominio}
                titulo={s.titulo}
                descricao={s.descricao}
                total={BLOCOS_POR_DOMINIO.get(s.dominio)?.length ?? 0}
                aoAbrir={() => setAberta(s.dominio)}
              />
            ))}
          </div>
        )}
      </div>

      <p className="border-t border-zinc-200 px-3 py-2 text-[10px] leading-snug text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        {mostrandoBlocos ? (
          <>
            <span className="inline-block size-1.5 rounded-full bg-amber-400 align-middle" />{" "}
            depende de peça que ainda não existe no CRM
          </>
        ) : (
          <>Arraste para o canvas ou clique para adicionar.</>
        )}
      </p>
    </aside>
  );
}
