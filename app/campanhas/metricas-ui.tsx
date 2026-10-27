"use client";

// As peças com que o Meta Ads mostra número (redesenho de 2026-10-23): a seta
// de variação, o cartão do topo, a grade de todas as métricas, a miniatura do
// criativo, o seletor de critério do ranking, os diagnósticos de qualidade e o
// controle segmentado. Rótulo, formato e "maior é melhor" vêm sempre do
// catálogo (lib/meta-ads-metricas.ts) — nenhuma tela escreve "R$" ou "%" à mão.
//
// COR SÓ ONDE HÁ JULGAMENTO: a seta é verde quando a métrica melhorou e
// vermelha quando piorou, pelo `melhor` do catálogo (custo que sobe é ruim,
// lead que sobe é bom). Investido e impressões não têm lado: a seta fica cinza.
import { GRUPOS, METRICAS, formatarMetrica, variacao, type ContextoMetrica, type GrupoMetrica, type LinhaMetricas } from "@/lib/meta-ads-metricas";
import { criteriosDisponiveis } from "@/lib/meta-ads-ranking";
import type { TipoCriativoAds } from "@/lib/meta-ads-tipos";
import {
  Clapperboard,
  Image as IconeImagem,
  Layers,
  Minus,
  TrendingDown,
  TrendingUp,
  Trophy,
  type TipoIcone,
} from "@/app/components/icones";
import { SeletorMenu } from "../components/filtros-ui";

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** A variação contra o período anterior, colorida pelo que ela significa. */
export function Variacao({ atual, anterior, melhor, rotuloAnterior }: {
  atual: number | null; anterior: number | null | undefined; melhor: "maior" | "menor" | null; rotuloAnterior?: string;
}) {
  const v = variacao(atual, anterior);
  if (v === null) return <span className="text-[11px] text-zinc-400 dark:text-zinc-500" title="Sem base no período anterior">—</span>;
  const estavel = Math.abs(v) < 0.5;
  const subiu = v > 0;
  const bom = melhor === null || estavel ? null : (melhor === "maior") === subiu;
  const Icone = estavel ? Minus : subiu ? TrendingUp : TrendingDown;
  const cor = bom === null ? "text-zinc-500 dark:text-zinc-400"
    : bom ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400";
  const texto = estavel ? "estável" : `${subiu ? "+" : "−"}${decimal.format(Math.min(Math.abs(v), 999))}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${cor}`}
      title={rotuloAnterior ? `Comparado a ${rotuloAnterior}` : "Comparado ao período anterior"}>
      <Icone className="size-3" aria-hidden="true" />
      {texto}
      <span className="sr-only">{bom === null ? "" : bom ? " (melhorou)" : " (piorou)"}</span>
    </span>
  );
}

/** O número grande do topo: rótulo, valor, variação e uma linha de contexto. */
export function CartaoKpi({ Icone, rotulo, valor, variacao: seta, detalhe, ordem, destaque }: {
  Icone: TipoIcone; rotulo: string; valor: string; variacao?: React.ReactNode; detalhe?: React.ReactNode; ordem: number; destaque?: boolean;
}) {
  return (
    <div style={{ animationDelay: `${ordem * 26}ms` }}
      className={`surge min-w-0 rounded-xl border px-4 py-3.5 ${destaque
        ? "border-zinc-900/15 bg-zinc-50 dark:border-white/15 dark:bg-zinc-900"
        : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        <Icone className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{rotulo}</span>
      </p>
      {/* A seta mora na linha de baixo, com o detalhe: ao lado do valor ela
          cortava "R$ 2.337,17" no cartão estreito das telas com duas barras. */}
      <p className="mt-1.5 truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums text-zinc-900 dark:text-zinc-50" title={valor}>{valor}</p>
      {(seta || detalhe) && (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
          {seta && <span className="shrink-0">{seta}</span>}
          {detalhe && <p className="min-w-0 truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={typeof detalhe === "string" ? detalhe : undefined}>{detalhe}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Todas as métricas do catálogo, por grupo, com a variação quando há período
 * anterior. Grupo sem nenhum número (vídeo numa conta só de imagem) não aparece.
 */
export function GradeMetricas({ linha, anterior, ctx, grupos, colunas = "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4", rotuloAnterior }: {
  linha: LinhaMetricas; anterior?: LinhaMetricas | null; ctx: ContextoMetrica; grupos?: GrupoMetrica[]; colunas?: string; rotuloAnterior?: string;
}) {
  const escolhidos = GRUPOS.filter((g) => (!grupos || grupos.includes(g.id)) && (g.id !== "crm" || linha.crm));
  return (
    <div className="space-y-5">
      {escolhidos.map((g) => {
        const defs = METRICAS.filter((d) => d.grupo === g.id && (!d.opcional || d.valor(linha, ctx) !== null));
        if (g.id === "video" && !linha.metricas.video3s) return null;
        if (g.id === "engajamento" && !linha.metricas.engajamentos) return null;
        return (
          <section key={g.id} aria-label={g.rotulo}>
            <h4 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">{g.rotulo}</h4>
            <dl className={`grid gap-x-5 gap-y-3 ${colunas}`}>
              {defs.map((d) => {
                const v = d.valor(linha, ctx);
                return (
                  <div key={d.chave} className="min-w-0" title={d.descricao}>
                    <dt className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{d.rotulo}</dt>
                    <dd className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="truncate text-[13.5px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatarMetrica(v, d.formato, ctx.moeda)}</span>
                      {anterior !== undefined && <Variacao atual={v} anterior={anterior ? d.valor(anterior, ctx) : null} melhor={d.melhor} rotuloAnterior={rotuloAnterior} />}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

const ICONE_TIPO: Record<TipoCriativoAds, TipoIcone> = { video: Clapperboard, imagem: IconeImagem, outro: Layers };

/**
 * A miniatura do criativo. <img> e não next/image: a origem é a CDN da Meta,
 * com link assinado que muda a cada leitura — nada para otimizar nem guardar.
 * Sem miniatura (ou link expirado), o ícone do tipo no lugar.
 */
export function Miniatura({ src, tipo, alt, className = "size-12", icone = true }: {
  src: string | null | undefined; tipo: TipoCriativoAds; alt: string; className?: string; icone?: boolean;
}) {
  const Icone = ICONE_TIPO[tipo];
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900 ${className}`}>
      {/* O ícone fica por baixo: a imagem que carrega o cobre; a que falha some e o revela. */}
      <Icone className="absolute inset-0 m-auto size-4 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover"
          onError={(e) => { e.currentTarget.style.display = "none"; }} />
      ) : null}
      {icone && tipo === "video" && src && (
        <span className="absolute bottom-1 right-1 flex size-4 items-center justify-center rounded bg-black/55 text-white">
          <Clapperboard className="size-2.5" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

/** O seletor do critério do ranking. Sem CRM, os critérios do funil não aparecem. */
export function SeletorCriterio({ valor, aoMudar, temCrm, comVideo = true, largura = "w-64" }: {
  valor: string; aoMudar: (v: string) => void; temCrm: boolean; comVideo?: boolean; largura?: string;
}) {
  return (
    <SeletorMenu Icone={Trophy} rotulo="Critério do ranking" valor={valor} aoMudar={aoMudar} botao={largura}
      opcoes={criteriosDisponiveis(temCrm, comVideo).map((c) => ({ valor: c.id, rotulo: c.rotulo }))} />
  );
}

/**
 * A posição no ranking. O primeiro em tinta cheia; os outros só contornados —
 * menos sobre a miniatura, onde contorno some na foto e o selo fica branco.
 */
export function Posicao({ n, className = "", sobreImagem }: { n: number; className?: string; sobreImagem?: boolean }) {
  return (
    <span aria-label={`${n}º lugar`}
      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${n === 1
        ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
        : sobreImagem ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
        : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"} ${className}`}>
      {n}
    </span>
  );
}

// Os diagnósticos de relevância da Meta, em português e com a cor do lado em
// que caem. UNKNOWN (pouco volume) não é ruim: fica cinza e diz o porquê.
const DIAGNOSTICO: Record<string, { texto: string; tom: "bom" | "medio" | "ruim" | "nada" }> = {
  ABOVE_AVERAGE: { texto: "Acima da média", tom: "bom" },
  AVERAGE: { texto: "Na média", tom: "medio" },
  BELOW_AVERAGE_35: { texto: "Abaixo da média (35% piores)", tom: "ruim" },
  BELOW_AVERAGE_20: { texto: "Abaixo da média (20% piores)", tom: "ruim" },
  BELOW_AVERAGE_10: { texto: "Abaixo da média (10% piores)", tom: "ruim" },
  UNKNOWN: { texto: "Sem volume para avaliar", tom: "nada" },
};
const TOM_DIAGNOSTICO = {
  bom: "bg-emerald-500", medio: "bg-amber-400", ruim: "bg-rose-500", nada: "bg-zinc-300 dark:bg-zinc-700",
};

/** Os três diagnósticos em linha: qualidade, engajamento e conversão. */
export function Qualidade({ qualidade, compacto }: { qualidade: { qualidade: string; engajamento: string; conversao: string } | null; compacto?: boolean }) {
  if (!qualidade) return null;
  const itens = [["Qualidade", qualidade.qualidade], ["Engajamento", qualidade.engajamento], ["Conversão", qualidade.conversao]] as const;
  if (compacto) {
    return (
      <span className="inline-flex items-center gap-1" title={itens.map(([r, v]) => `${r}: ${(DIAGNOSTICO[v] ?? DIAGNOSTICO.UNKNOWN).texto}`).join(" · ")}>
        {itens.map(([r, v]) => <span key={r} className={`size-1.5 rounded-full ${TOM_DIAGNOSTICO[(DIAGNOSTICO[v] ?? DIAGNOSTICO.UNKNOWN).tom]}`} aria-hidden="true" />)}
        <span className="sr-only">{itens.map(([r, v]) => `${r}: ${(DIAGNOSTICO[v] ?? DIAGNOSTICO.UNKNOWN).texto}`).join("; ")}</span>
      </span>
    );
  }
  return (
    <dl className="grid grid-cols-3 gap-3">
      {itens.map(([r, v]) => {
        const d = DIAGNOSTICO[v] ?? DIAGNOSTICO.UNKNOWN;
        return (
          <div key={r} className="min-w-0">
            <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">{r}</dt>
            <dd className="mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-zinc-900 dark:text-zinc-100">
              <span className={`mt-1 size-2 shrink-0 rounded-full ${TOM_DIAGNOSTICO[d.tom]}`} aria-hidden="true" />{d.texto}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Controle segmentado (período, métrica do gráfico, visão da tabela). Rola de lado se não couber. */
export function Segmentado<T extends string>({ opcoes, valor, aoMudar, rotulo, tamanho = "md" }: {
  opcoes: Array<{ valor: T; rotulo: string; detalhe?: string }>; valor: T; aoMudar: (v: T) => void; rotulo: string; tamanho?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={rotulo}
      className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-zinc-100 p-0.5 [scrollbar-width:none] dark:bg-zinc-900">
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <button key={o.valor} type="button" role="radio" aria-checked={ativo} onClick={() => aoMudar(o.valor)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition ${tamanho === "sm" ? "px-2 py-1 text-[11.5px]" : "px-2.5 py-1.5 text-[12.5px]"} ${ativo
              ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-700 dark:text-zinc-50 dark:ring-white/10"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"}`}>
            {o.rotulo}
            {o.detalhe && <span className={`tabular-nums ${ativo ? "text-zinc-400" : "text-zinc-400 dark:text-zinc-500"}`}>{o.detalhe}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** "24/08 a 23/09". */
export function periodoCurto(p: { inicio: string; fim: string }) {
  const d = (v: string) => v.slice(5).split("-").reverse().join("/");
  return `${d(p.inicio)} a ${d(p.fim)}`;
}