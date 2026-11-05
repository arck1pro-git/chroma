"use client";

// Os cartões do quadro do blog: o artigo (em revisão ou postado) e a pauta (a
// notícia que ainda vai virar artigo).
//
// CADA CARTÃO TEM DUAS PARTES: o corpo, que só desenha (é ele que segue o
// cursor no arraste, pelo DragOverlay), e o invólucro arrastável, que liga o
// corpo ao dnd-kit. Desenhar duas vezes o mesmo cartão — um parado, um voando —
// sairia diferente no primeiro ajuste.
//
// O CLIQUE ABRE, O ARRASTE MOVE: o botão que abre cobre o cartão inteiro (o
// `after:inset-0`), e o que tem ação própria (Postar, Gerar, o link do site)
// fica por cima dele com `relative z-10`. A folga de 6 px do sensor separa um
// gesto do outro.
import { useEffect, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { analiseSeo, contarPalavras, type Artigo } from "@/lib/artigo";
import type { ItemPauta } from "@/lib/blog-pauta-tipos";
import { numeroCurto, posicao, type MetricasGoogle } from "@/lib/blog-google-tipos";
import { dataDoInstante } from "@/lib/formato";
import { ArrowLeft, ArrowRight, ExternalLink, Newspaper, RotateCcw, Sparkles } from "@/app/components/icones";
import { SeloSeo, dominioDe, tempoAtras } from "../pecas";
import type { FasePauta } from "./pautas";

/** O que vai no `data` do dnd-kit: o quadro decide pelo tipo onde pode cair. */
export type Arrastado = { tipo: "artigo"; artigo: Artigo } | { tipo: "pauta"; item: ItemPauta };

// ── Artigo ──────────────────────────────────────────────────────────────────

type PropsArtigo = {
  artigo: Artigo;
  /** Os números do Google no período; undefined = sem linha (ainda não apareceu). */
  metricas?: MetricasGoogle;
  /** O Google está conectado: sem linha vira "ainda sem aparições", não silêncio. */
  googleOk: boolean;
  /** Endereço do artigo no site; vazio quando o blog não tem endereço. */
  url: string;
  podeMover: boolean;
  destaque?: boolean;
  aoAbrir: () => void;
  aoMover: () => void;
};

export function CartaoArtigo(props: PropsArtigo) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `artigo:${props.artigo.id}`,
    data: { tipo: "artigo", artigo: props.artigo } satisfies Arrastado,
    disabled: !props.podeMover,
  });
  return (
    <li ref={setNodeRef} {...attributes} {...listeners} className={`touch-manipulation ${isDragging ? "opacity-30" : ""}`}>
      <CorpoArtigo {...props} />
    </li>
  );
}

export function CorpoArtigo({
  artigo,
  metricas,
  googleOk,
  url,
  podeMover,
  destaque,
  flutuando,
  aoAbrir,
  aoMover,
}: PropsArtigo & { flutuando?: boolean }) {
  const postado = artigo.status === "aprovado";
  const fonte = dominioDe(artigo.fonte_url);

  return (
    <article
      className={`group relative rounded-lg border bg-white p-3 text-left transition dark:bg-zinc-900 ${
        flutuando
          ? "rotate-[1.5deg] border-zinc-300 shadow-xl dark:border-zinc-600"
          : "border-zinc-200 hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:hover:border-zinc-700"
      } ${destaque ? "chegou" : ""}`}
    >
      <button
        type="button"
        onClick={aoAbrir}
        className="block w-full text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-zinc-400"
      >
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
          {postado ? (
            <>Postado · {dataDoInstante(artigo.updated_at)}</>
          ) : (
            <>
              {fonte && (
                <>
                  <Newspaper className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{fonte}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="shrink-0">{dataDoInstante(artigo.created_at)}</span>
            </>
          )}
        </p>
        <h3 className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-zinc-900 dark:text-zinc-50">
          {artigo.titulo}
        </h3>
        {!postado && artigo.resumo && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {artigo.resumo}
          </p>
        )}
      </button>

      {postado && googleOk && (metricas ? <Numeros metricas={metricas} /> : (
        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">Ainda sem aparições no Google</p>
      ))}

      <div className="mt-2.5 flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
        {postado ? (
          artigo.slug && <span className="min-w-0 truncate font-mono text-[10px]">/{artigo.slug}</span>
        ) : (
          <>
            <SeloSeo nota={analiseSeo(artigo).nota} />
            <span className="tabular-nums">{contarPalavras(artigo.conteudo).toLocaleString("pt-BR")} palavras</span>
          </>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1">
          {postado && url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir no site"
              aria-label="Abrir no site"
              className="relative z-10 flex size-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          )}
          {/* O atalho do arraste, para quem não arrasta (teclado, tablet): no
              mouse ele só aparece no hover, para o cartão não virar painel de
              botões; sem hover (toque), fica sempre visível. */}
          {podeMover && (
            <button
              type="button"
              onClick={aoMover}
              className={`relative z-10 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${
                postado
                  ? "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                  : "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
              }`}
            >
              {postado ? (
                <>
                  <ArrowLeft className="size-3" aria-hidden="true" />
                  Revisão
                </>
              ) : (
                <>
                  Postar
                  <ArrowRight className="size-3" aria-hidden="true" />
                </>
              )}
            </button>
          )}
        </span>
      </div>
    </article>
  );
}

function Numeros({ metricas }: { metricas: MetricasGoogle }) {
  const itens = [
    ["Cliques", numeroCurto(metricas.cliques)],
    ["Impressões", numeroCurto(metricas.impressoes)],
    ["Posição", posicao(metricas.posicao)],
  ] as const;
  return (
    <dl className="relative mt-2.5 grid grid-cols-3 rounded-md bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/60">
      {itens.map(([rotulo, valor]) => (
        <div key={rotulo} className="min-w-0">
          <dt className="text-[10px] text-zinc-400 dark:text-zinc-500">{rotulo}</dt>
          <dd className="truncate text-[13px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Pauta ───────────────────────────────────────────────────────────────────

type PropsPauta = {
  item: ItemPauta;
  fase?: FasePauta;
  podeGerar: boolean;
  aoGerar: () => void;
};

export function CartaoPauta(props: PropsPauta) {
  const gerando = props.fase?.estado === "gerando";
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `pauta:${props.item.link}`,
    data: { tipo: "pauta", item: props.item } satisfies Arrastado,
    disabled: !props.podeGerar || gerando,
  });
  return (
    <li ref={setNodeRef} {...attributes} {...listeners} className={`touch-manipulation ${isDragging ? "opacity-30" : ""}`}>
      <CorpoPauta {...props} />
    </li>
  );
}

export function CorpoPauta({ item, fase, podeGerar, aoGerar, flutuando }: PropsPauta & { flutuando?: boolean }) {
  const gerando = fase?.estado === "gerando";
  return (
    <article
      className={`relative rounded-lg border p-3 transition ${
        flutuando
          ? "rotate-[1.5deg] border-zinc-300 bg-white shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
          : gerando
            ? "border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/30"
            : "border-zinc-200 bg-white/70 hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
      }`}
    >
      <p className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
        <span className="truncate font-medium text-zinc-500 dark:text-zinc-400">{dominioDe(item.link)}</span>
        {item.data && (
          <>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{tempoAtras(item.data)}</span>
          </>
        )}
      </p>
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="group/link mt-1 flex items-start gap-1 text-[13px] leading-snug text-zinc-800 dark:text-zinc-100"
      >
        <span className="line-clamp-3 group-hover/link:underline">{item.titulo || item.link}</span>
        <ExternalLink className="mt-1 size-2.5 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
      </a>

      {gerando ? (
        <div className="mt-3" role="status">
          <div className="h-1 overflow-hidden rounded-full bg-sky-100 dark:bg-sky-950">
            <div className="barra-indeterminada h-full w-1/3 rounded-full bg-sky-500" />
          </div>
          <p className="mt-1.5 flex items-center justify-between text-[11px] text-sky-700 dark:text-sky-300">
            Lendo a matéria e escrevendo
            <Cronometro desde={fase.desde} />
          </p>
        </div>
      ) : fase?.estado === "erro" ? (
        <div className="mt-2.5">
          <p className="text-[11px] leading-relaxed text-red-600 dark:text-red-400">{fase.mensagem}</p>
          {podeGerar && (
            <button
              type="button"
              onClick={aoGerar}
              className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-300"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              Tentar de novo
            </button>
          )}
        </div>
      ) : (
        podeGerar && (
          <button
            type="button"
            onClick={aoGerar}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-zinc-200 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
          >
            <Sparkles className="size-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            Gerar artigo
          </button>
        )
      )}
    </article>
  );
}

/** "1:42" desde o clique: a espera é longa, e um número andando diz que não travou. */
function Cronometro({ desde }: { desde: number }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((agora - desde) / 1000));
  return <span className="tabular-nums">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}
