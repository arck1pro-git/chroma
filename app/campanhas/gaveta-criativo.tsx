"use client";

// A gaveta de um criativo (uma PEÇA: o vídeo ou a imagem, com todos os
// anúncios que a usam), no kit das gavetas do CRM. Redesenho de 2026-10-23,
// junto com o ranking de criativos.
//
// Tudo o que mostra já veio com a galeria (CriativosAds): abrir não pede nada à
// Meta. A prévia é a miniatura de 480 px da Meta; o vídeo de verdade abre no
// Instagram, pelo link do post, quando há.
import { useEffect, useState } from "react";
import { formatarMetrica, metrica, type ContextoMetrica } from "@/lib/meta-ads-metricas";
import type { CriativoAds } from "@/lib/meta-ads-tipos";
import {
  ArrowUpRight,
  BadgeDollarSign,
  Clapperboard,
  Contact,
  Megaphone,
  MousePointerClick,
  Wallet,
  X,
} from "@/app/components/icones";
import { BotaoIcone, CascaGaveta, CorpoGaveta, LINHA, Secao, Vazio } from "../components/gaveta";
import { CartaoKpi, GradeMetricas, Miniatura, Qualidade } from "./metricas-ui";
import { entregaLegivel } from "./pecas";

export default function GavetaCriativo({ criativo: c, ctx, posicao, rotuloCriterio, aoFechar, aoAbrirCampanha, temCampanha }: {
  criativo: CriativoAds; ctx: ContextoMetrica; posicao: number | null; rotuloCriterio: string;
  aoFechar: () => void; aoAbrirCampanha: (id: string) => void;
  /** A campanha está na lista do relatório? Arquivada não está, e o clique só fecharia a gaveta. */
  temCampanha: (id: string) => boolean;
}) {
  const [textoInteiro, setTextoInteiro] = useState(false);
  const linha = { metricas: c.metricas, crm: c.crm };
  const fmt = (chave: string, l = linha) => { const d = metrica(chave); return formatarMetrica(d.valor(l, ctx), d.formato, ctx.moeda); };
  const campanhas = new Set(c.anuncios.map((a) => a.campanha.id)).size;
  const tipo = c.tipo === "video" ? "Vídeo" : c.tipo === "imagem" ? "Imagem" : "Criativo";

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) { if (e.key === "Escape") aoFechar(); }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  return (
    <CascaGaveta rotulo={`Criativo ${c.nome}`} aoFechar={aoFechar} largura="w-[34rem]">
      <header className="flex shrink-0 items-start gap-2 px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">{c.nome}</h2>
          <p className="mt-0.5 truncate text-[12px] text-zinc-500 dark:text-zinc-400">
            {tipo} · {c.anuncios.length} {c.anuncios.length === 1 ? "anúncio" : "anúncios"}{campanhas > 1 ? ` em ${campanhas} campanhas` : ""}
            {c.ativo ? " · em veiculação" : " · pausado"}
            {posicao ? ` · ${posicao}º no ranking (${rotuloCriterio})` : ""}
          </p>
        </div>
        {c.instagram && (
          <a href={c.instagram} target="_blank" rel="noreferrer" aria-label="Ver o post no Instagram" title="Ver o post no Instagram"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
        )}
        <BotaoIcone Icone={X} rotulo="Fechar criativo" onClick={aoFechar} className="-mr-1.5" />
      </header>

      <CorpoGaveta>
        <div className="px-5 pb-4">
          <div className="flex gap-4">
            <Miniatura src={c.miniatura} tipo={c.tipo} alt={`Prévia de ${c.nome}`} className="aspect-square w-40 rounded-xl" icone={false} />
            <div className="min-w-0 flex-1">
              {c.titulo && <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{c.titulo}</p>}
              {c.texto ? (
                <>
                  <p className={`whitespace-pre-line text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300 ${textoInteiro ? "" : "line-clamp-6"}`}>{c.texto}</p>
                  {c.texto.length > 220 && (
                    <button type="button" onClick={() => setTextoInteiro((v) => !v)} className="mt-1 text-[11.5px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
                      {textoInteiro ? "Mostrar menos" : "Ler o texto inteiro"}
                    </button>
                  )}
                </>
              ) : <p className="text-[12px] text-zinc-400 dark:text-zinc-500">Sem texto no criativo.</p>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 px-5 pb-4">
          <CartaoKpi ordem={0} Icone={Wallet} rotulo="Investido" valor={fmt("gasto")} detalhe={`${fmt("impressoes")} impressões`} />
          {c.crm
            ? <CartaoKpi ordem={1} Icone={Contact} rotulo="Leads no CRM" valor={fmt("leadsCrm")} destaque detalhe={c.crm.leads > 0 ? `${fmt("custoLeadCrm")} por lead` : "Nenhum lead no período"} />
            : <CartaoKpi ordem={1} Icone={Megaphone} rotulo="Leads na Meta" valor={fmt("leads")} destaque detalhe={c.metricas.leads > 0 ? `${fmt("custoPorLead")} por lead` : "Nenhum lead no período"} />}
          <CartaoKpi ordem={2} Icone={MousePointerClick} rotulo="CTR do link" valor={fmt("ctrLink")} detalhe={`${fmt("cliquesLink")} cliques · CPC ${fmt("cpcLink")}`} />
          {c.tipo === "video"
            ? <CartaoKpi ordem={3} Icone={Clapperboard} rotulo="Taxa de gancho" valor={fmt("taxaGancho")} detalhe={`Retenção ${fmt("taxaRetencao")} · ${fmt("tempoMedioVideo")} em média`} />
            : <CartaoKpi ordem={3} Icone={BadgeDollarSign} rotulo="CPM" valor={fmt("cpm")} detalhe={`Frequência ${fmt("frequencia")}`} />}
        </div>

        {c.metricas.qualidade && (
          <Secao titulo="Diagnóstico da Meta">
            <Qualidade qualidade={c.metricas.qualidade} />
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              Como a Meta compara este anúncio com os que disputam o mesmo público. É do anúncio com mais impressões da peça.
            </p>
          </Secao>
        )}

        <Secao titulo="Anúncios com esta peça" contagem={c.anuncios.length}>
          {c.anuncios.length === 0 ? <Vazio>Nenhum anúncio.</Vazio> : (
            <ul>
              {[...c.anuncios].sort((a, b) => b.metricas.gasto - a.metricas.gasto).map((a) => {
                const l = { metricas: a.metricas, crm: null };
                const abre = temCampanha(a.campanha.id);
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => aoAbrirCampanha(a.campanha.id)} disabled={!abre} className={`${LINHA} disabled:cursor-default disabled:hover:bg-transparent`}
                      title={abre ? "Abrir a campanha" : "Campanha fora da lista (arquivada ou excluída na Meta)"}>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-zinc-900 dark:text-zinc-50">
                          <span className="truncate">{a.nome}</span>
                          {a.effective_status === "ACTIVE" && <span role="img" aria-label="Em veiculação" className="size-1.5 shrink-0 rounded-full bg-emerald-400" />}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          {[a.campanha.nome, a.conjunto?.nome, a.effective_status !== "ACTIVE" ? entregaLegivel(a.effective_status) : null].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[12.5px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{fmt("gasto", l)}</p>
                        <p className="text-[10.5px] tabular-nums text-zinc-400 dark:text-zinc-500">{fmt("leads", l)} leads · CTR {fmt("ctrLink", l)}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Secao>

        <Secao titulo="Todas as métricas">
          <GradeMetricas linha={linha} ctx={ctx} colunas="grid-cols-2 sm:grid-cols-3" />
        </Secao>
      </CorpoGaveta>
    </CascaGaveta>
  );
}