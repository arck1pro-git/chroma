"use client";

// Peças da tela de Métricas, usadas na página (a equipe, ou a própria pessoa
// para quem não é Admin/TI) e na ficha de uma pessoa (./ficha-pessoa.tsx): os
// três períodos, o gráfico, a "faísca" dos últimos 30 dias, o "agora" e a lista
// do que está em aberto. Uma peça só para as duas: o número da pessoa na ficha
// e o da equipe na página têm de se ler do mesmo jeito.
import { useId, useMemo } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CircleCheck, Flag, LifeBuoy, ListPlus } from "lucide-react";
import { LinhasPorDia, type EscalaLinha, type SerieLinha } from "../components/grafico-linhas";
import { tintaDe } from "../components/tinta";
import { prazoEmTexto, TOM_PRAZO } from "../demandas/datas";
import type { Aberta, Balde, Contagem, Recorte } from "./demandas";

export type Visao = "dia" | "semana" | "mes";
export type PeriodoId = "hoje" | "semana" | "mes";

// ── Datas ───────────────────────────────────────────────────────────────────

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const diaMes = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
export const nomeDoMes = (dia: string) => MESES[Number(dia.slice(5, 7)) - 1];
const diaDaSemana = (dia: string) => SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()];
const maiuscula = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

export function segunda(dia: string) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function mesAnterior(dia: string) {
  const d = new Date(`${dia.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

/** Os três períodos, com o anterior de cada um — o mesmo rótulo nos cartões e na tabela. */
export function periodos(hoje: string) {
  return [
    { id: "hoje", titulo: "Hoje", curto: "Hoje", quando: `${diaDaSemana(hoje)}, ${diaMes(hoje)}`, anterior: "Ontem" },
    { id: "semana", titulo: "Esta semana", curto: "Semana", quando: `desde seg, ${diaMes(segunda(hoje))}`, anterior: "Semana passada" },
    { id: "mes", titulo: "Este mês", curto: "Mês", quando: nomeDoMes(hoje), anterior: maiuscula(nomeDoMes(mesAnterior(hoje))) },
  ] as const satisfies readonly { id: PeriodoId; titulo: string; curto: string; quando: string; anterior: string }[];
}

/** O número do período e o do anterior, de um recorte. */
export function doPeriodo(r: Recorte, p: PeriodoId): { atual: Contagem; anterior: Contagem } {
  if (p === "hoje") return { atual: r.hoje, anterior: r.ontem };
  if (p === "semana") return { atual: r.semana, anterior: r.semanaPassada };
  return { atual: r.mes, anterior: r.mesPassado };
}

// ── Cores ───────────────────────────────────────────────────────────────────

// O par entrada × saída, o mesmo nos números, no gráfico e na tabela: a ponta
// clara do verde é o que ENTROU (gerada), a escura o que SAIU (entregue) — a
// leitura claro = entrada, escuro = fechamento do resto do app. Verde porque é
// a cor do check na tela de Demandas. Validadas em globals.css (.viz[data-tom]).
export const TOM = "emerald";
export const COR_GERADAS = "var(--serie-tom-claro)";
export const COR_ENTREGUES = "var(--serie-tom-escuro)";

const SERIES: SerieLinha<Balde>[] = [
  { nome: "Geradas", cor: COR_GERADAS, Icone: ListPlus, valor: (b) => b.geradas },
  { nome: "Entregues", cor: COR_ENTREGUES, Icone: CircleCheck, valor: (b) => b.entregues },
];

const VISOES: Array<{ valor: Visao; rotulo: string; resumo: string }> = [
  { valor: "dia", rotulo: "Por dia", resumo: "últimos 30 dias" },
  { valor: "semana", rotulo: "Por semana", resumo: "últimas 12 semanas" },
  { valor: "mes", rotulo: "Por mês", resumo: "últimos 12 meses" },
];

// ── Pessoa ──────────────────────────────────────────────────────────────────

/** A pessoa na tinta dela — a mesma das Configurações e das Demandas. */
export function Avatar({ nome, iniciais, tamanho = "sm" }: { nome: string; iniciais: string; tamanho?: "sm" | "md" | "lg" }) {
  const medida = tamanho === "sm" ? "size-8 text-[11px]" : tamanho === "md" ? "size-9 text-[12px]" : "size-11 text-[14px]";
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${medida} ${tintaDe(nome)}`} aria-hidden="true">
      {iniciais}
    </span>
  );
}

/**
 * A faísca: as entregas dos últimos 30 dias numa linha com sombra, do tamanho
 * de uma palavra — o "vem entregando ou parou?" de cada pessoa, sem abrir nada.
 * O teto é o da equipe toda (`teto`): a faísca de quem entrega pouco fica baixa,
 * em vez de esticar até o alto e parecer igual à de quem entrega muito.
 */
export function Faisca({ valores, teto }: { valores: number[]; teto: number }) {
  const id = useId();
  const L = 112, A = 28, M = 2;
  const max = Math.max(1, teto);
  const pontos = valores.map((v, i) => [
    M + (i * (L - 2 * M)) / Math.max(1, valores.length - 1),
    A - M - (v / max) * (A - 2 * M),
  ]);
  const linha = pontos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M${pontos[0][0]},${A} L${linha.replaceAll(" ", " L")} L${pontos.at(-1)![0]},${A} Z`;
  const ultimo = pontos.at(-1)!;
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="h-7 w-28 overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: COR_ENTREGUES, stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: COR_ENTREGUES, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <polyline points={linha} fill="none" style={{ stroke: COR_ENTREGUES }} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={ultimo[0]} cy={ultimo[1]} r="2" style={{ fill: COR_ENTREGUES }} />
    </svg>
  );
}

// ── Períodos ────────────────────────────────────────────────────────────────

// Os três períodos lado a lado: as geradas e as entregues grandes, e o
// anterior do mesmo tipo embaixo, por inteiro — "ontem", "semana passada",
// "setembro". O anterior vai em número e não em %: comparar a semana pela
// metade com a inteira em porcentagem daria um "−60%" que só quer dizer "é
// quarta-feira".
//
// O TAMANHO VEM DO CONTÊINER: na página (@container), cheio a partir de @2xl;
// na ficha, que mora no <body> sem contêiner, fica o compacto; no celular, um
// embaixo do outro e compacto — senão os três empurravam a tabela para fora
// da tela.
export function TresPeriodos({ r, hoje }: { r: Recorte; hoje: string }) {
  return (
    <section
      aria-label="Hoje, esta semana e este mês"
      className="viz grid grid-cols-3 gap-2 @max-md:grid-cols-1 @2xl:gap-3"
      data-tom={TOM}
    >
      {periodos(hoje).map((p, i) => {
        const { atual, anterior } = doPeriodo(r, p.id);
        return (
          <article
            key={p.id}
            className="surge rounded-2xl border border-zinc-200 px-3 pb-2.5 pt-3 @2xl:px-5 @2xl:pb-4 @2xl:pt-4 dark:border-zinc-800"
            style={{ animationDelay: `${i * 30}ms` }}
            aria-label={`${p.titulo}: ${atual.geradas} geradas, ${atual.entregues} entregues`}
          >
            <header className="flex items-baseline justify-between gap-2">
              <h3 className="text-[12px] font-semibold text-zinc-900 @2xl:text-[13px] dark:text-zinc-50">
                <span className="@2xl:hidden">{p.curto}</span>
                <span className="hidden @2xl:inline">{p.titulo}</span>
              </h3>
              <span className="hidden text-[11px] text-zinc-400 @2xl:inline dark:text-zinc-500">{p.quando}</span>
            </header>
            <dl className="mt-2 grid grid-cols-2 gap-2 @2xl:mt-3 @2xl:gap-4">
              <Numero Icone={ListPlus} cor={COR_GERADAS} rotulo="Geradas" valor={atual.geradas} />
              <Numero Icone={CircleCheck} cor={COR_ENTREGUES} rotulo="Entregues" valor={atual.entregues} />
            </dl>
            <p className="mt-2 border-t border-zinc-100 pt-1.5 text-[10px] tabular-nums text-zinc-500 @2xl:mt-3 @2xl:pt-2.5 @2xl:text-[11px] dark:border-zinc-800 dark:text-zinc-400">
              <span className="@2xl:hidden">
                {p.anterior}: {anterior.geradas} · {anterior.entregues}
              </span>
              <span className="hidden @2xl:inline">
                {p.anterior}: {anterior.geradas} {anterior.geradas === 1 ? "gerada" : "geradas"} · {anterior.entregues}{" "}
                {anterior.entregues === 1 ? "entregue" : "entregues"}
              </span>
            </p>
          </article>
        );
      })}
    </section>
  );
}

function Numero({ Icone, cor, rotulo, valor }: { Icone: typeof ListPlus; cor: string; rotulo: string; valor: number }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 truncate text-[10px] font-medium text-zinc-500 @2xl:gap-1.5 @2xl:text-[11px] dark:text-zinc-400">
        <Icone className="size-3 shrink-0 @2xl:size-3.5" style={{ color: cor }} aria-hidden="true" />
        {rotulo}
      </dt>
      <dd className="mt-1 text-[22px] font-semibold leading-none tabular-nums tracking-tight text-zinc-900 @2xl:text-[32px] dark:text-zinc-50">
        {valor.toLocaleString("pt-BR")}
      </dd>
    </div>
  );
}

// ── Gráfico ─────────────────────────────────────────────────────────────────

export function Grafico({
  r,
  hoje,
  visao,
  aoMudarVisao,
  titulo = "Geradas e entregues",
  compacto = false,
}: {
  r: Recorte;
  hoje: string;
  visao: Visao;
  aoMudarVisao: (v: Visao) => void;
  titulo?: string;
  compacto?: boolean;
}) {
  const idTitulo = useId();
  // Semana e mês: o rótulo do eixo e do tooltip, e o último ponto ainda em
  // andamento (tracejado). O dia usa o padrão do gráfico.
  const escala = useMemo<EscalaLinha | undefined>(() => {
    if (visao === "semana") {
      const atual = segunda(hoje);
      return {
        eixo: (dia) => diaMes(dia),
        dica: (dia) => `semana de ${diaMes(dia)}${dia === atual ? " · em andamento" : ""}`,
        ultimoParcial: true,
      };
    }
    if (visao === "mes") {
      const atual = `${hoje.slice(0, 7)}-01`;
      return {
        // O ano só no primeiro ponto e na virada: "out", "nov", "dez", "jan 27".
        eixo: (dia, i) => `${nomeDoMes(dia).slice(0, 3)}${i === 0 || dia.slice(5, 7) === "01" ? ` ${dia.slice(2, 4)}` : ""}`,
        dica: (dia) => `${nomeDoMes(dia)} de ${dia.slice(0, 4)}${dia === atual ? " · em andamento" : ""}`,
        ultimoParcial: true,
      };
    }
    return undefined;
  }, [visao, hoje]);

  const baldes = visao === "semana" ? r.porSemana : visao === "mes" ? r.porMes : r.porDia;
  const daVisao = VISOES.find((v) => v.valor === visao)!;

  return (
    <section
      aria-labelledby={idTitulo}
      className={`viz surge rounded-2xl border border-zinc-200 dark:border-zinc-800 ${compacto ? "px-4 pb-3 pt-3.5" : "px-5 pb-4 pt-4"}`}
      data-tom={TOM}
      style={{ animationDelay: "90ms" }}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id={idTitulo} className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          {titulo}
        </h2>
        <Segmentos
          rotulo="Escala do gráfico"
          valor={visao}
          opcoes={VISOES.map((v) => ({ valor: v.valor, rotulo: compacto ? v.rotulo.replace("Por ", "") : v.rotulo }))}
          aoMudar={aoMudarVisao}
        />
      </header>
      <LinhasPorDia
        key={visao}
        dados={baldes}
        series={SERIES}
        tom={TOM}
        altura={compacto ? "h-40" : "h-56"}
        totais
        escala={escala}
        resumo={daVisao.resumo}
        notaNoDia={(b) => (b.geradas > b.entregues ? `fila +${b.geradas - b.entregues}` : b.entregues > b.geradas ? `fila −${b.entregues - b.geradas}` : null)}
        vazio={`Nenhuma demanda gerada nem entregue nos ${daVisao.resumo}.`}
        titulo={`Demandas geradas e entregues ${daVisao.rotulo.toLowerCase()}, ${daVisao.resumo}`}
      />
    </section>
  );
}

/** O controle de segmentos da tela: escala do gráfico, período da tabela. */
export function Segmentos<V extends string>({
  rotulo,
  valor,
  opcoes,
  aoMudar,
}: {
  rotulo: string;
  valor: V;
  opcoes: { valor: V; rotulo: string }[];
  aoMudar: (v: V) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      className="flex items-center gap-0.5 rounded-[10px] bg-zinc-100 p-[3px] ring-1 ring-inset ring-zinc-200/80 dark:bg-zinc-900 dark:ring-zinc-800"
    >
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          onClick={() => aoMudar(o.valor)}
          className={`rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition ${
            valor === o.valor
              ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-zinc-800 dark:text-zinc-50 dark:shadow-none"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

// ── Agora ───────────────────────────────────────────────────────────────────

/** Em aberto, atrasadas e vencendo hoje — o que está na mesa neste momento. */
export function contarAgora(abertas: Aberta[], hoje: string) {
  return {
    abertas: abertas.length,
    atrasadas: abertas.filter((a) => a.prazo !== null && a.prazo < hoje).length,
    hoje: abertas.filter((a) => a.prazo === hoje).length,
  };
}

export function Agora({ abertas, hoje }: { abertas: Aberta[]; hoje: string }) {
  const n = contarAgora(abertas, hoje);
  const blocos = [
    { rotulo: "Em aberto", valor: n.abertas, tom: "text-zinc-900 dark:text-zinc-50", fundo: "" },
    {
      rotulo: "Atrasadas",
      valor: n.atrasadas,
      tom: n.atrasadas ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50",
      fundo: n.atrasadas ? "border-red-200 bg-red-50/60 dark:border-red-500/25 dark:bg-red-500/[0.07]" : "",
    },
    {
      rotulo: "Vencem hoje",
      valor: n.hoje,
      tom: n.hoje ? "text-amber-700 dark:text-amber-400" : "text-zinc-900 dark:text-zinc-50",
      fundo: "",
    },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2" aria-label="Agora">
      {blocos.map((b) => (
        <div key={b.rotulo} className={`rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800 ${b.fundo}`}>
          <dt className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{b.rotulo}</dt>
          <dd className={`mt-1 text-[22px] font-semibold leading-none tabular-nums tracking-tight ${b.tom}`}>{b.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Atrasadas primeiro (a mais antiga no topo), depois pelo prazo; sem prazo por último. */
function ordemDaMesa(a: Aberta, b: Aberta) {
  if (a.prazo !== b.prazo) {
    if (!a.prazo) return 1;
    if (!b.prazo) return -1;
    return a.prazo < b.prazo ? -1 : 1;
  }
  const peso = { alta: 0, normal: 1, baixa: 2 };
  return peso[a.prioridade] - peso[b.prioridade];
}

/** O que está com a pessoa agora, do mais urgente para o menos. */
export function NaMesa({ abertas, hoje, vazio }: { abertas: Aberta[]; hoje: string; vazio: string }) {
  const lista = [...abertas].sort(ordemDaMesa);
  return (
    <section aria-label="Em aberto agora">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          Em aberto agora <span className="font-normal tabular-nums text-zinc-400 dark:text-zinc-500">{lista.length}</span>
        </h2>
        <Link
          href="/demandas"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          Abrir Demandas
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </header>
      {lista.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-6 text-center text-[12px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          {vazio}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800/80 dark:border-zinc-800">
          {lista.map((a) => {
            const prazo = a.prazo ? prazoEmTexto(a.prazo, hoje, false) : null;
            return (
              <li key={a.id} className="flex items-center gap-2.5 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-800 dark:text-zinc-200" title={a.titulo}>
                  {a.titulo}
                </span>
                {a.departamento && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                    <LifeBuoy className="size-3" aria-hidden="true" />
                    {a.departamento}
                  </span>
                )}
                {a.prioridade === "alta" && (
                  <Flag className="size-3 shrink-0 fill-current text-red-500" aria-label="Prioridade alta" />
                )}
                {prazo ? (
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TOM_PRAZO[prazo.tom]}`}
                  >
                    <CalendarClock className="size-3" aria-hidden="true" />
                    {prazo.texto}
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">sem prazo</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
