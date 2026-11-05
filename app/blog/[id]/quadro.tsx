"use client";

// O quadro do blog: Pautas → Em revisão → Postado.
//
// É O CAMINHO DO ARTIGO, DA ESQUERDA PARA A DIREITA (pedido dele, 2026-11-05:
// "os artigos aparecem em kanbans, em revisão e postado"). A coluna de pautas
// vem antes porque é de onde o artigo nasce — a automação das 7h tira dela, e a
// pessoa também pode tirar à mão:
//
//   · arrastar uma pauta para "Em revisão" (ou o botão Gerar) escreve o artigo;
//   · arrastar de "Em revisão" para "Postado" publica — a rota pública do site
//     passa a servi-lo em até 5 minutos;
//   · arrastar de volta tira do site.
//
// O que cada coluna aceita está em `aceita`: pauta não vai direto para o site,
// e artigo não volta a ser notícia. Coluna que recusa o cartão em arraste fica
// esmaecida, como no quadro de Demandas, de onde vem o desenho da coluna.
//
// A ORDEM é a do trabalho: em revisão, o mais novo em cima (é o que acabou de
// chegar); postado, o publicado por último em cima.
import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { urlDoArtigo, type Artigo, type ArtigoStatus, type Blog } from "@/lib/artigo";
import type { GoogleDoBlog } from "@/lib/blog-google-tipos";
import { Newspaper, RefreshCw, Rss } from "@/app/components/icones";
import { CartaoArtigo, CartaoPauta, CorpoArtigo, CorpoPauta, type Arrastado } from "./cartoes";
import type { Pautas } from "./pautas";

type ColunaId = "pautas" | "revisao" | "postado";

const COLUNAS: { id: ColunaId; rotulo: string; faixa: string }[] = [
  { id: "pautas", rotulo: "Pautas", faixa: "bg-sky-400 dark:bg-sky-500" },
  { id: "revisao", rotulo: "Em revisão", faixa: "bg-amber-400 dark:bg-amber-500" },
  { id: "postado", rotulo: "Postado", faixa: "bg-emerald-500" },
];

export type Permissoes = { criar: boolean; editar: boolean; excluir: boolean };

export default function Quadro({
  blog,
  artigos,
  pautas,
  google,
  pode,
  destaque,
  aoAbrir,
  aoMover,
  aoIrParaFontes,
}: {
  blog: Blog;
  /** Já filtrados pela busca da tela. */
  artigos: Artigo[];
  pautas: Pautas;
  google: GoogleDoBlog | null;
  pode: Permissoes;
  /** O artigo que acabou de chegar: pisca para o olho achar. */
  destaque: number | null;
  aoAbrir: (artigo: Artigo) => void;
  aoMover: (artigo: Artigo, status: ArtigoStatus) => void;
  aoIrParaFontes: () => void;
}) {
  const [arrastando, setArrastando] = useState<Arrastado | null>(null);
  const sensores = useSensors(
    // 6 px de folga: sem isto todo clique viraria arraste e o artigo não abria.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const { revisao, postado } = useMemo(() => {
    const porData = (campo: "created_at" | "updated_at") => (a: Artigo, b: Artigo) =>
      a[campo] < b[campo] ? 1 : a[campo] > b[campo] ? -1 : 0;
    return {
      revisao: artigos.filter((a) => a.status === "pendente").sort(porData("created_at")),
      postado: artigos.filter((a) => a.status === "aprovado").sort(porData("updated_at")),
    };
  }, [artigos]);

  const googleOk = google?.estado === "ok";
  const metricas = google?.estado === "ok" ? google.artigos : {};

  function aceita(coluna: ColunaId): boolean {
    if (!arrastando) return false;
    if (arrastando.tipo === "pauta") return coluna === "revisao" && pode.criar;
    if (!pode.editar) return false;
    return arrastando.artigo.status === "pendente" ? coluna === "postado" : coluna === "revisao";
  }

  function aoIniciar({ active }: DragStartEvent) {
    setArrastando((active.data.current as Arrastado | undefined) ?? null);
  }

  function aoSoltar({ over }: DragEndEvent) {
    const solto = arrastando;
    setArrastando(null);
    if (!solto || !over || !aceita(over.id as ColunaId)) return;
    if (solto.tipo === "pauta") pautas.gerar(solto.item);
    else aoMover(solto.artigo, over.id === "postado" ? "aprovado" : "pendente");
  }

  const total: Record<ColunaId, number> = {
    pautas: pautas.itens?.length ?? 0,
    revisao: revisao.length,
    postado: postado.length,
  };

  const propsArtigo = (a: Artigo) => ({
    artigo: a,
    metricas: metricas[String(a.id)],
    googleOk,
    url: urlDoArtigo(blog, a),
    podeMover: pode.editar,
    destaque: destaque === a.id,
    aoAbrir: () => aoAbrir(a),
    aoMover: () => aoMover(a, a.status === "pendente" ? "aprovado" : "pendente"),
  });

  return (
    <DndContext
      // id fixo: sem ele o dnd-kit gera os ids de acessibilidade em runtime e
      // eles não batem com o SSR (erro de hidratação no console).
      id="quadro-blog"
      sensors={sensores}
      collisionDetection={pointerWithin}
      onDragStart={aoIniciar}
      onDragEnd={aoSoltar}
      onDragCancel={() => setArrastando(null)}
    >
      {/* Rola de lado quando as três não cabem (celular); do tablet deitado
          para cima, mesmo com a barra lateral aberta, as três dividem a largura. */}
      <div className="h-full min-h-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain @2xl:snap-none">
        <div className="flex h-full w-max gap-3 px-4 pb-5 @md:px-6 @2xl:w-full">
          {COLUNAS.map((def) => (
            <Coluna
              key={def.id}
              def={def}
              total={total[def.id]}
              realce={!arrastando ? "nenhum" : aceita(def.id) ? "aceita" : "recusa"}
              acao={
                def.id === "pautas" && pautas.feeds > 0 ? (
                  <button
                    type="button"
                    onClick={pautas.reler}
                    disabled={!pautas.itens}
                    aria-label="Ler as fontes de novo"
                    title="Ler as fontes de novo"
                    className="-my-1 ml-auto flex size-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                  >
                    <RefreshCw className={`size-3 ${!pautas.itens ? "animate-spin" : ""}`} aria-hidden="true" />
                  </button>
                ) : undefined
              }
            >
              {def.id === "pautas" ? (
                <ColunaDePautas pautas={pautas} pode={pode} aoIrParaFontes={aoIrParaFontes} />
              ) : (
                <Lista
                  itens={def.id === "revisao" ? revisao : postado}
                  vazio={
                    def.id === "revisao"
                      ? "Nada esperando revisão. Gere um artigo de uma pauta, ou espere a automação das 7h."
                      : "Nada no ar ainda. Arraste para cá um artigo revisado."
                  }
                  soltar={def.id === "revisao" ? (arrastando?.tipo === "pauta" ? "para gerar o artigo" : "para voltar à revisão") : "para postar no site"}
                  realce={!arrastando ? "nenhum" : aceita(def.id) ? "aceita" : "recusa"}
                  render={(a) => <CartaoArtigo key={a.id} {...propsArtigo(a)} />}
                />
              )}
            </Coluna>
          ))}
        </div>
      </div>

      {/* A cópia que segue o cursor; o original fica esmaecido. */}
      <DragOverlay dropAnimation={null}>
        {arrastando?.tipo === "artigo" && <CorpoArtigo {...propsArtigo(arrastando.artigo)} flutuando />}
        {arrastando?.tipo === "pauta" && (
          <CorpoPauta item={arrastando.item} podeGerar={pode.criar} aoGerar={() => {}} flutuando />
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ── Coluna ──────────────────────────────────────────────────────────────────

type Realce = "nenhum" | "aceita" | "recusa";

function Coluna({
  def,
  total,
  realce,
  acao,
  children,
}: {
  def: (typeof COLUNAS)[number];
  total: number;
  realce: Realce;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: def.id });
  const sobre = isOver && realce === "aceita";

  return (
    <section
      ref={setNodeRef}
      aria-label={def.rotulo}
      className={`relative flex h-full w-[85cqw] max-w-[24rem] shrink-0 snap-center flex-col rounded-xl transition-[background-color,box-shadow,opacity] duration-150 @2xl:w-auto @2xl:min-w-0 @2xl:max-w-none @2xl:flex-1 ${
        sobre
          ? "bg-emerald-50 ring-2 ring-inset ring-emerald-400/70 dark:bg-emerald-500/10 dark:ring-emerald-500/50"
          : realce === "aceita"
            ? "bg-zinc-100/70 outline-dashed outline-2 -outline-offset-2 outline-zinc-300 dark:bg-zinc-900/50 dark:outline-zinc-700"
            : "bg-zinc-100/70 dark:bg-zinc-900/50"
      } ${realce === "recusa" ? "opacity-50" : ""}`}
    >
      <span className={`h-1 shrink-0 rounded-t-xl ${def.faixa}`} aria-hidden="true" />
      <header className="flex shrink-0 items-center gap-2 px-3.5 pb-2.5 pt-3">
        <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{def.rotulo}</h2>
        <span className="rounded-full bg-white px-1.5 text-[11px] font-medium leading-[18px] tabular-nums text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700">
          {total}
        </span>
        {acao}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

function Lista({
  itens,
  vazio,
  soltar,
  realce,
  render,
}: {
  itens: Artigo[];
  vazio: string;
  soltar: string;
  realce: Realce;
  render: (a: Artigo) => React.ReactNode;
}) {
  if (itens.length === 0) {
    return (
      <p className="flex flex-1 items-center justify-center px-6 pb-10 text-center text-[12px] leading-relaxed text-zinc-400 dark:text-zinc-500">
        {realce === "aceita" ? `Solte aqui ${soltar}` : vazio}
      </p>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-2">{itens.map(render)}</ul>
      {realce === "aceita" && (
        <p className="pointer-events-none mt-2 rounded-lg border border-dashed border-emerald-400/70 py-3 text-center text-[12px] font-medium text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-400">
          Solte {soltar}
        </p>
      )}
    </>
  );
}

// ── Pautas ──────────────────────────────────────────────────────────────────

function ColunaDePautas({
  pautas,
  pode,
  aoIrParaFontes,
}: {
  pautas: Pautas;
  pode: Permissoes;
  aoIrParaFontes: () => void;
}) {
  if (pautas.erro) {
    return <Vazio texto={pautas.erro} acao={<BotaoTexto aoClicar={pautas.reler}>Tentar de novo</BotaoTexto>} />;
  }
  if (!pautas.itens) {
    return (
      <ul className="flex flex-col gap-2" aria-label="Lendo as fontes">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="h-24 animate-pulse rounded-lg border border-zinc-200 bg-white/50 dark:border-zinc-800 dark:bg-zinc-900/40" />
        ))}
      </ul>
    );
  }
  if (pautas.feeds === 0) {
    return (
      <Vazio
        icone={<Rss className="size-5 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />}
        texto="Sem fontes de notícia. Cadastre feeds de mercado e economia e as pautas aparecem aqui."
        acao={<BotaoTexto aoClicar={aoIrParaFontes}>Escolher fontes</BotaoTexto>}
      />
    );
  }
  if (pautas.itens.length === 0) {
    return (
      <Vazio
        icone={<Newspaper className="size-5 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />}
        texto={
          pautas.lidos === 0
            ? "As fontes não responderam agora. Confira na aba Automação."
            : "Nada novo: tudo o que as fontes trazem já virou artigo."
        }
      />
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-2">
        {pautas.itens.map((item) => (
          <CartaoPauta
            key={item.link}
            item={item}
            fase={pautas.fases[item.link]}
            podeGerar={pode.criar}
            aoGerar={() => pautas.gerar(item)}
          />
        ))}
      </ul>
      {pautas.usadas > 0 && (
        <p className="px-2 pt-3 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
          {pautas.usadas} notícia{pautas.usadas === 1 ? "" : "s"} das fontes já {pautas.usadas === 1 ? "virou" : "viraram"} artigo
        </p>
      )}
    </>
  );
}

function Vazio({ texto, icone, acao }: { texto: string; icone?: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-10 text-center">
      {icone}
      <p className="text-[12px] leading-relaxed text-zinc-400 dark:text-zinc-500">{texto}</p>
      {acao}
    </div>
  );
}

function BotaoTexto({ aoClicar, children }: { aoClicar: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 shadow-sm ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-700"
    >
      {children}
    </button>
  );
}

/** Para a tela filtrar com a mesma regra do quadro: título ou palavra-chave. */
export function filtrarArtigos(artigos: Artigo[], busca: string): Artigo[] {
  const termo = busca.trim().toLowerCase();
  if (!termo) return artigos;
  return artigos.filter(
    (a) => a.titulo.toLowerCase().includes(termo) || a.palavra_chave.toLowerCase().includes(termo),
  );
}

