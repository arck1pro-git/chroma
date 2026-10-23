"use client";

// O pódio das melhores campanhas e dos melhores criativos (pedido dele,
// 2026-10-23). A regra mora em lib/meta-ads-ranking.ts; aqui está só como
// mostrar: o critério à vista e trocável, o volume mínimo dito no rodapé e,
// em cada linha, o número que ordenou e os dois que dão contexto a ele (custo
// baixo com 3 leads não é o mesmo que custo baixo com 80).
import { useState } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { formatarMetrica, metrica, type ContextoMetrica, type LinhaMetricas } from "@/lib/meta-ads-metricas";
import { criterio, preferenciaDeCriterio, primeiroQueRanqueia, ranquear } from "@/lib/meta-ads-ranking";
import type { CriativoAds, LinhaAds, TipoCriativoAds } from "@/lib/meta-ads-tipos";
import { Miniatura, Posicao, SeletorCriterio } from "./metricas-ui";
import { entregaLegivel, objetivos } from "./pecas";

export type ItemRanking = LinhaMetricas & {
  id: string; nome: string; subtitulo?: string; ativo?: boolean;
  miniatura?: { src: string | null; tipo: TipoCriativoAds };
};

// O contexto de cada critério: o volume que sustenta um custo, o custo que
// acompanha um volume, a base de uma taxa.
const CONTEXTO: Record<string, [string, string]> = {
  custoLeadCrm: ["leadsCrm", "gasto"], leadsCrm: ["custoLeadCrm", "gasto"],
  custoOportunidade: ["oportunidades", "gasto"], oportunidades: ["custoOportunidade", "gasto"],
  custoPorLead: ["leads", "gasto"], leads: ["custoPorLead", "gasto"],
  ctrLink: ["cliquesLink", "impressoes"], taxaGancho: ["taxaRetencao", "impressoes"], taxaRetencao: ["thruplays", "video3s"],
};

/** Campanha da lista como item de ranking. */
export function campanhaComoItem(l: LinhaAds): ItemRanking {
  return {
    ...l, nome: l.name, ativo: l.effective_status === "ACTIVE",
    subtitulo: l.effective_status === "ACTIVE" ? objetivos[l.objective ?? ""] : entregaLegivel(l.effective_status),
  };
}

/** Peça de criativo como item de ranking. */
export function criativoComoItem(c: CriativoAds): ItemRanking {
  return {
    id: c.chave, nome: c.nome, metricas: c.metricas, crm: c.crm, ativo: c.ativo,
    miniatura: { src: c.miniatura, tipo: c.tipo },
    subtitulo: c.anuncios.length > 1 ? `${c.anuncios.length} anúncios` : undefined,
  };
}

export default function CartaoRanking({ titulo, Icone, itens, ctx, temCrm, comVideo, limite = 5, carregando, vazioSemDados, aoAbrir, aoVerTodos, rotuloVerTodos }: {
  titulo: string; Icone: LucideIcon; itens: ItemRanking[]; ctx: ContextoMetrica; temCrm: boolean; comVideo?: boolean; limite?: number;
  carregando?: boolean; vazioSemDados: string; aoAbrir: (id: string) => void; aoVerTodos?: () => void; rotuloVerTodos?: string;
}) {
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const c = escolhido ? criterio(escolhido) : primeiroQueRanqueia(itens, preferenciaDeCriterio(temCrm), ctx);
  const { posicoes, foraDoMinimo, def } = ranquear(itens, c, ctx);
  const topo = posicoes.slice(0, limite);
  const [k1, k2] = CONTEXTO[c.id] ?? ["gasto", "impressoes"];

  return (
    <section aria-label={titulo} className="flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-900">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <Icone className="size-4 text-zinc-400" aria-hidden="true" />{titulo}
        </h2>
        <SeletorCriterio valor={c.id} aoMudar={setEscolhido} temCrm={temCrm} comVideo={comVideo} largura="w-60" />
      </header>

      {carregando ? <Esqueleto /> : topo.length === 0 ? (
        <p className="flex-1 px-4 py-10 text-center text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {itens.length === 0 ? vazioSemDados : <>Ninguém atinge o mínimo deste critério ({c.minimo}) no período.<br />Troque o critério acima ou amplie o período.</>}
        </p>
      ) : (
        <ol className="flex-1 divide-y divide-zinc-100 dark:divide-zinc-900">
          {topo.map(({ item, valor, posicao }) => (
            <li key={item.id}>
              <button type="button" onClick={() => aoAbrir(item.id)} aria-label={`${posicao}º: ${item.nome}`}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none dark:hover:bg-zinc-900/60 dark:focus-visible:bg-zinc-900/60">
                <Posicao n={posicao} />
                {item.miniatura && <Miniatura src={item.miniatura.src} tipo={item.miniatura.tipo} alt="" className="size-10" />}
                <div className="min-w-0 flex-1">
                  <p className="flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-zinc-900 dark:text-zinc-50" title={item.nome}>
                    <span className="line-clamp-2 break-words">{item.nome}</span>
                    {item.ativo && <span role="img" aria-label="Em veiculação" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-400" />}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                    {[k1, k2].map((k) => { const d = metrica(k); return `${d.curto} ${formatarMetrica(d.valor(item, ctx), d.formato, ctx.moeda)}`; }).join(" · ")}
                    {item.subtitulo ? ` · ${item.subtitulo}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[14px] font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">{formatarMetrica(valor, def.formato, ctx.moeda)}</p>
                  <p className="text-[10.5px] text-zinc-400 dark:text-zinc-500">{def.curto}</p>
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}

      <footer className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-900">
        <p className="min-w-0 truncate text-[11px] text-zinc-400 dark:text-zinc-500" title={`Entra no ranking quem tem pelo menos ${c.minimo} no período.`}>
          Mínimo: {c.minimo}{foraDoMinimo > 0 ? ` · ${foraDoMinimo} abaixo do mínimo` : ""}
        </p>
        {aoVerTodos && (
          <button type="button" onClick={aoVerTodos}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
            {rotuloVerTodos ?? "Ver todos"}<ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </footer>
    </section>
  );
}

function Esqueleto() {
  return (
    <div className="flex-1 animate-pulse space-y-1 p-2" aria-busy="true" aria-label="Montando o ranking">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <span className="size-6 rounded-full bg-zinc-100 dark:bg-zinc-900" />
          <span className="size-10 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
          <span className="h-3 flex-1 rounded bg-zinc-100 dark:bg-zinc-900" />
          <span className="h-4 w-16 rounded bg-zinc-100 dark:bg-zinc-900" />
        </div>
      ))}
    </div>
  );
}