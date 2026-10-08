"use client";

// O gráfico por dia do app: Execuções (Automações), Recebimentos (Webhooks) e
// Atendimentos de IA (dashboard). Um componente só desde que ele pediu o mesmo
// tipo nas três telas (2026-10-05): três cópias do mesmo desenho divergiriam
// no primeiro ajuste.
//
// LINHA COM SOMBRA EMBAIXO (área em degradê) — pedido dele em 2026-10-05:
// "gosto do gráfico de linha com a sombra abaixo". Era SVG à mão, foi para o
// recharts no mesmo dia e para o chart.js em 2026-10-06 (./grafico-canvas.ts).
//
// A anatomia: legenda sempre presente (traço colorido + nome em tinta de
// texto) com o total do período no canto, grade em hairline, eixo com três
// marcas limpas, tooltip com todas as séries do dia e tabela sr-only.
//
// Um eixo, nunca dois: as séries são todas contagens, e é a proporção entre
// elas (erro colado na base, reunião bem abaixo de atendimento) que a linha
// deve mostrar. Segundo eixo mentiria sobre ela.
//
// Cores: variáveis --serie-* e --viz-* da classe .viz (globals.css),
// validadas para daltonismo nos dois modos.
import { useCallback, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { corDoCss, degrade, useGrafico, type Desenho } from "./grafico-canvas";

/**
 * Para série que não é por dia — por semana, por mês —: como escrever o ponto
 * no eixo e no tooltip, e se o último ponto ainda está em andamento (o trecho
 * até ele sai tracejado). Sem ela, a série é por dia, como sempre foi.
 */
export type EscalaLinha = {
  eixo: (dia: string, i: number) => string;
  dica: (dia: string) => string;
  ultimoParcial: boolean;
};

export type SerieLinha<T> = {
  nome: string;
  /** Uma var(--serie-…) de .viz. */
  cor: string;
  /** Ícone na cor da série, no lugar do traço, na legenda e no tooltip. */
  Icone?: LucideIcon;
  valor: (d: T) => number;
  /** Texto apagado depois do total na legenda — "(9 pela IA)". */
  nota?: (dados: T[]) => string | null;
};

function diaCurto(iso: string) {
  return iso.slice(8, 10);
}

export function mesCurto(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// O dia no eixo, com o mês no primeiro e na virada ("01/10"): só "29 30 01"
// não diz em que mês se está.
function rotuloDoEixo(iso: string, i: number) {
  return i === 0 || iso.endsWith("-01") ? mesCurto(iso) : diaCurto(iso);
}

// Hoje em 'YYYY-MM-DD' no fuso de Brasília, o mesmo em que as séries contam o
// dia. O último ponto, quando é hoje, é um dia pela metade: o trecho até ele
// sai tracejado, senão a queda do fim parece tendência.
function hoje() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

// Teto do eixo em número limpo E divisível por 2 — o gráfico mostra o tick do
// meio, então um teto de 25 daria "12,5" no eixo. Arredondar para 30 dá 15.
function tetoLimpo(max: number) {
  if (max <= 2) return 2; // meio = 1: com 1 ou 2 no período a linha não fica rente ao chão
  if (max <= 4) return 4; // meio = 2
  if (max <= 10) return 10; // meio = 5
  return Math.ceil(max / 10) * 10; // meio sempre múltiplo de 5
}

export function LinhasPorDia<T extends { dia: string }>({
  dados,
  series,
  resumo,
  notaNoDia,
  vazio,
  titulo,
  altura = "h-32",
  totais = false,
  tom,
  escala,
  recolhido = false,
  acao,
}: {
  dados: T[];
  series: SerieLinha<T>[];
  /** O canto direito da legenda: o total do período. */
  resumo: string;
  /** O total do período de cada série ao lado do nome dela na legenda — aí o
   *  `resumo` fica só com o período, sem repetir os nomes. */
  totais?: boolean;
  /** O tom do funil (funis.cor): liga --serie-tom-claro e --serie-tom-escuro
   *  daquele tom no .viz (globals.css). */
  tom?: string;
  /** Uma linha a mais no tooltip do dia, quando houver o que dizer. */
  notaNoDia?: (d: T) => string | null;
  /** O texto quando todas as séries somam zero. */
  vazio: string;
  /** A legenda da tabela sr-only. */
  titulo: string;
  /** Altura da área do gráfico (classe Tailwind). */
  altura?: string;
  /** Semana ou mês no lugar do dia (ver EscalaLinha). */
  escala?: EscalaLinha;
  /** Só a linha da legenda, com os totais — o gráfico minimizado do
   *  dashboard (app/inicio/visao-geral.tsx). A tabela sr-only continua. */
  recolhido?: boolean;
  /** Um controle no fim da linha da legenda (o botão de minimizar). */
  acao?: ReactNode;
}) {
  const maximo = Math.max(0, ...dados.flatMap((d) => series.map((s) => s.valor(d))));
  if (maximo === 0) {
    const aviso = (
      <p
        className={`flex-1 rounded-lg border border-dashed border-zinc-200 px-3 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500 ${
          recolhido ? "py-1.5" : "py-8"
        }`}
      >
        {vazio}
      </p>
    );
    return acao ? (
      <div className="flex items-start gap-2">
        {aviso}
        {acao}
      </div>
    ) : (
      aviso
    );
  }

  return (
    <div className="viz" data-tom={tom}>
      {/* Legenda sempre presente com 2 séries ou mais: identidade nunca
          depende só da cor. O texto usa token de tinta; quem carrega a
          identidade é o traço colorido ao lado. */}
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${recolhido ? "" : "mb-2"}`}>
        {series.map((s) => {
          const nota = s.nota?.(dados);
          return (
            <span key={s.nome} className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <Marca serie={s} />
              {s.nome}
              {totais && (
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {dados.reduce((t, d) => t + s.valor(d), 0)}
                </span>
              )}
              {nota && <span className="text-zinc-400 dark:text-zinc-500">{nota}</span>}
            </span>
          );
        })}
        <span className="ml-auto text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{resumo}</span>
        {acao}
      </div>

      {/* Teto pela MAIOR série, não pela soma: são linhas, não pilha. A
          `key` pelo tom: o canvas não acompanha o CSS, então trocar de funil
          (e de tom) monta o gráfico de novo com as cores relidas. */}
      {!recolhido && (
        <Linhas
          key={tom}
          dados={dados}
          series={series}
          teto={tetoLimpo(maximo)}
          notaNoDia={notaNoDia}
          altura={altura}
          escala={escala}
        />
      )}

      <table className="sr-only">
        <caption>{titulo}</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            {series.map((s) => (
              <th key={s.nome} scope="col">{s.nome}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dados.map((d) => (
            <tr key={d.dia}>
              <th scope="row">{escala ? escala.dica(d.dia) : mesCurto(d.dia)}</th>
              {series.map((s) => (
                <td key={s.nome}>{s.valor(d)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A marca de identidade da série, igual na legenda e no tooltip: o ícone dela
// na cor dela, ou o traço da linha quando não tem ícone. O texto ao lado
// continua em tinta de texto.
function Marca<T>({ serie }: { serie: SerieLinha<T> }) {
  const { Icone, cor } = serie;
  return Icone ? (
    <Icone className="size-3.5 shrink-0" style={{ color: cor }} aria-hidden="true" />
  ) : (
    <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: cor }} aria-hidden="true" />
  );
}

/** O dia sob o mouse: índice em `dados` e onde desenhar o tooltip. */
type Dica = { i: number; x: number; largura: number };

// À parte do LinhasPorDia porque o <canvas> só existe quando há o que
// desenhar, e o hook do gráfico precisa dele montado.
function Linhas<T extends { dia: string }>({
  dados,
  series,
  teto,
  notaNoDia,
  altura,
  escala,
}: {
  dados: T[];
  series: SerieLinha<T>[];
  teto: number;
  notaNoDia?: (d: T) => string | null;
  altura: string;
  escala?: EscalaLinha;
}) {
  const [dica, setDica] = useState<Dica | null>(null);

  const desenhar = useCallback(
    (el: HTMLCanvasElement): Desenho => {
      const cor = (c: string) => corDoCss(el, c);
      const eixo = { color: cor("var(--viz-eixo)"), font: { size: 10 } };
      const fundo = cor("var(--conteudo)");
      const ultimo = dados.length - 1;
      const parcial = escala ? escala.ultimoParcial : dados[ultimo]?.dia === hoje();
      return {
        data: {
          labels: dados.map((d, i) => (escala ? escala.eixo(d.dia, i) : rotuloDoEixo(d.dia, i))),
          datasets: series.map((s, i) => {
            const c = cor(s.cor);
            return {
              label: s.nome,
              data: dados.map(s.valor),
              borderColor: c,
              borderWidth: 2,
              segment: { borderDash: (seg) => (parcial && seg.p1DataIndex === ultimo ? [3, 3] : undefined) },
              backgroundColor: degrade(c, 0.26),
              fill: "origin",
              cubicInterpolationMode: "monotone",
              pointRadius: 0,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: c,
              pointHoverBorderColor: fundo,
              pointHoverBorderWidth: 2,
              // O chart.js põe a de menor `order` por cima: a última série
              // da lista fica na frente, como no desenho de antes.
              order: series.length - 1 - i,
            };
          }),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          locale: "pt-BR",
          animation: { duration: 500 },
          // O ponto do dia aparece na hora, junto com o tooltip.
          transitions: { active: { animation: { duration: 0 } } },
          layout: { padding: { top: 6, right: 6 } },
          interaction: { mode: "index", intersect: false },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: { ...eixo, maxRotation: 0, autoSkipPadding: 8, padding: 6 },
            },
            y: {
              min: 0,
              max: teto,
              grid: { color: cor("var(--viz-grade)"), drawTicks: false },
              border: { display: false },
              ticks: { ...eixo, padding: 4 },
              afterBuildTicks: (escala) => {
                escala.ticks = [0, teto / 2, teto].map((value) => ({ value }));
              },
              afterFit: (escala) => {
                escala.width = 26;
              },
            },
          },
          plugins: {
            cursor: { cor: cor("var(--viz-cursor)") },
            // O tooltip é HTML (abaixo): o chart.js só diz qual dia e onde.
            tooltip: {
              enabled: false,
              external: ({ chart, tooltip }) => {
                const i = tooltip.dataPoints?.[0]?.dataIndex;
                if (!tooltip.opacity || i === undefined) return setDica(null);
                setDica((atual) => (atual?.i === i ? atual : { i, x: tooltip.caretX, largura: chart.width }));
              },
            },
          },
        },
      };
    },
    [dados, series, teto, escala],
  );
  const canvas = useGrafico(desenhar);

  const d = dica && dados[dica.i];
  const nota = d && notaNoDia?.(d);

  return (
    <div className={`relative ${altura} -ml-1`} aria-hidden="true">
      <canvas ref={canvas} />
      {dica && d && (
        // O gráfico do dashboard é baixo: o tooltip passa da borda do cartão
        // e tem de ficar por cima do que vem embaixo. Na metade direita ele
        // vira para a esquerda do cursor, para não sair do cartão.
        <div
          className="pointer-events-none absolute top-0 z-[60] w-max rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[11px] shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          style={{
            left: dica.x,
            transform: dica.x > dica.largura / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
          }}
        >
          <p className="mb-1 text-zinc-500 dark:text-zinc-400">
            {escala ? (
              escala.dica(d.dia)
            ) : (
              <>
                {mesCurto(d.dia)}
                {d.dia === hoje() && " · hoje, até agora"}
              </>
            )}
          </p>
          {series.map((s) => (
            <p key={s.nome} className="flex items-center gap-2">
              <Marca serie={s} />
              <span className="min-w-4 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{s.valor(d)}</span>
              <span className="text-zinc-500 dark:text-zinc-400">{s.nome}</span>
            </p>
          ))}
          {nota && <p className="mt-1 text-zinc-400 dark:text-zinc-500">{nota}</p>}
        </div>
      )}
    </div>
  );
}
