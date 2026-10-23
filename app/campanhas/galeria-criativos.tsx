"use client";

// A aba Criativos do Meta Ads (redesenho de 2026-10-23): cada PEÇA — o vídeo
// ou a imagem, juntando os anúncios que a usam em várias campanhas — num cartão
// com a miniatura, o que ela rendeu e os diagnósticos da Meta.
//
// A ORDEM É O RANKING: quem atinge o volume mínimo do critério escolhido vem
// primeiro, numerado, do melhor para o pior (lib/meta-ads-ranking.ts); quem
// fica abaixo do mínimo vem depois, por investimento, apagado e sem número —
// à vista, mas sem disputar o pódio com 2 leads de sorte.
import { useMemo, useState } from "react";
import { Image as IconeImagem, LoaderCircle } from "lucide-react";
import { formatarMetrica, metrica, type ContextoMetrica } from "@/lib/meta-ads-metricas";
import { criterio, preferenciaDeCriterio, primeiroQueRanqueia, ranquear } from "@/lib/meta-ads-ranking";
import type { CriativoAds, CriativosAds } from "@/lib/meta-ads-tipos";
import { CampoBusca } from "../components/filtros-ui";
import { Miniatura, Posicao, Qualidade, Segmentado, SeletorCriterio } from "./metricas-ui";
import { criativoComoItem } from "./ranking-ads";
import { Aviso, Vazio } from "./pecas";

type Tipo = "todos" | "video" | "imagem";

export default function GaleriaCriativos({ dados, carregando, erro, ctx, temCrm, selecionado, aoAbrir }: {
  dados: CriativosAds | null; carregando: boolean; erro: string; ctx: ContextoMetrica; temCrm: boolean; selecionado: string; aoAbrir: (chave: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<Tipo>("todos");
  const [soAtivos, setSoAtivos] = useState(false);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const todos = useMemo(() => dados?.criativos ?? [], [dados]);
  const comVideo = todos.some((c) => c.tipo === "video");

  const { cartoes, c, foraDoMinimo } = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase();
    const filtrados = todos.filter((x) => (tipo === "todos" || x.tipo === tipo) && (!soAtivos || x.ativo)
      && (!termo || x.nome.toLocaleLowerCase().includes(termo) || x.anuncios.some((a) => a.nome.toLocaleLowerCase().includes(termo) || a.campanha.nome.toLocaleLowerCase().includes(termo))));
    const itens = filtrados.map(criativoComoItem);
    const crit = escolhido ? criterio(escolhido) : primeiroQueRanqueia(itens, preferenciaDeCriterio(temCrm), ctx);
    const { posicoes, foraDoMinimo } = ranquear(itens, crit, ctx);
    const posicaoDe = new Map(posicoes.map((p) => [p.item.id, p.posicao]));
    const ordenados = [...filtrados].sort((a, b) => {
      const pa = posicaoDe.get(a.chave), pb = posicaoDe.get(b.chave);
      if (pa && pb) return pa - pb;
      if (pa || pb) return pa ? -1 : 1;
      return b.metricas.gasto - a.metricas.gasto;
    });
    return { cartoes: ordenados.map((x) => ({ x, posicao: posicaoDe.get(x.chave) ?? null })), c: crit, foraDoMinimo };
  }, [todos, busca, tipo, soAtivos, escolhido, temCrm, ctx]);

  if (erro) return <Aviso erro texto={erro} />;
  if (!dados) return carregando ? <Vazio Icone={LoaderCircle} texto="Consultando os criativos na Meta…" girando /> : null;

  const def = metrica(c.metrica);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-60"><CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar criativo, anúncio ou campanha" /></div>
        <SeletorCriterio valor={c.id} aoMudar={setEscolhido} temCrm={temCrm} comVideo={comVideo} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmentado rotulo="Tipo de criativo" tamanho="sm" valor={tipo} aoMudar={setTipo} opcoes={[
            { valor: "todos", rotulo: "Todos", detalhe: String(todos.length) },
            { valor: "video", rotulo: "Vídeo", detalhe: String(todos.filter((x) => x.tipo === "video").length) },
            { valor: "imagem", rotulo: "Imagem", detalhe: String(todos.filter((x) => x.tipo === "imagem").length) },
          ]} />
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12px] text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={soAtivos} onChange={(e) => setSoAtivos(e.target.checked)} className="size-3.5 accent-zinc-900 dark:accent-zinc-100" />
            Só em veiculação
          </label>
        </div>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          Ordem: {c.rotulo} · mínimo {c.minimo}{foraDoMinimo > 0 ? ` · ${foraDoMinimo} abaixo do mínimo, no fim` : ""}
        </p>
      </div>

      {cartoes.length === 0 ? <Vazio Icone={IconeImagem} texto={todos.length ? "Nenhum criativo com esses filtros." : "Nenhum criativo veiculou neste período."} /> : (
        <ul className={`grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-3 transition-opacity ${carregando ? "opacity-60" : ""}`}>
          {cartoes.map(({ x, posicao }) => (
            <li key={x.chave}>
              <CartaoCriativo x={x} posicao={posicao} marcado={x.chave === selecionado} ctx={ctx} temCrm={temCrm} chaveCriterio={def.chave} aoAbrir={() => aoAbrir(x.chave)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CartaoCriativo({ x, posicao, marcado, ctx, temCrm, chaveCriterio, aoAbrir }: {
  x: CriativoAds; posicao: number | null; marcado: boolean; ctx: ContextoMetrica; temCrm: boolean; chaveCriterio: string; aoAbrir: () => void;
}) {
  const linha = { metricas: x.metricas, crm: x.crm };
  const principal = metrica(chaveCriterio);
  // Quatro números de apoio: investimento, o lead que importa, o clique e o
  // olho (gancho no vídeo, CPM na imagem). O do critério não se repete aqui.
  const apoio = ["gasto", temCrm ? "leadsCrm" : "leads", "ctrLink", x.tipo === "video" ? "taxaGancho" : "cpm"].filter((k) => k !== chaveCriterio).slice(0, 4).map(metrica);
  const campanhas = new Set(x.anuncios.map((a) => a.campanha.id)).size;
  return (
    <button type="button" onClick={aoAbrir} aria-label={`${posicao ? `${posicao}º: ` : ""}${x.nome}`}
      className={`group flex h-full w-full flex-col overflow-hidden rounded-xl border bg-white text-left transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:bg-zinc-950 dark:focus-visible:ring-white/25 ${marcado
        ? "border-zinc-900 dark:border-zinc-300" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"} ${posicao ? "" : "opacity-75"}`}>
      <div className="relative">
        <Miniatura src={x.miniatura} tipo={x.tipo} alt="" className="aspect-square w-full rounded-none" />
        {posicao && <Posicao n={posicao} sobreImagem className="absolute left-2 top-2" />}
        {!x.ativo && <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10.5px] font-medium text-white">Pausado</span>}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-zinc-900 dark:text-zinc-50" title={x.nome}>{x.nome}</p>
        <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
          {x.tipo === "video" ? "Vídeo" : x.tipo === "imagem" ? "Imagem" : "Criativo"} · {x.anuncios.length} {x.anuncios.length === 1 ? "anúncio" : "anúncios"}{campanhas > 1 ? ` em ${campanhas} campanhas` : ""}
        </p>
        <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-zinc-100 pt-2.5 dark:border-zinc-900">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{principal.curto}</span>
          <span className="text-[15px] font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">{formatarMetrica(principal.valor(linha, ctx), principal.formato, ctx.moeda)}</span>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {apoio.map((d) => (
            <div key={d.chave} className="min-w-0">
              <dt className="truncate text-[10.5px] text-zinc-400 dark:text-zinc-500">{d.curto}</dt>
              <dd className="truncate text-[12px] font-medium tabular-nums text-zinc-800 dark:text-zinc-200">{formatarMetrica(d.valor(linha, ctx), d.formato, ctx.moeda)}</dd>
            </div>
          ))}
        </dl>
        {x.metricas.qualidade && (
          <p className="mt-auto flex items-center gap-1.5 pt-2.5 text-[10.5px] text-zinc-400 dark:text-zinc-500">
            <Qualidade qualidade={x.metricas.qualidade} compacto /> Diagnóstico da Meta
          </p>
        )}
      </div>
    </button>
  );
}