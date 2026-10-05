"use client";

// O gráfico por dia do app: Execuções (Automações), Recebimentos (Webhooks) e
// Atendimentos de IA (dashboard). Um componente só desde que ele pediu o mesmo
// tipo nas três telas (2026-10-05): três cópias do mesmo desenho divergiriam
// no primeiro ajuste.
//
// LINHA COM SOMBRA EMBAIXO (área em degradê), pelo recharts — pedido dele, no
// mesmo dia: "gosto do gráfico de linha com a sombra abaixo". Era SVG à mão;
// o recharts já estava no projeto (gaveta de campanhas), então não entra lib.
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
import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type SerieLinha<T> = {
  nome: string;
  /** Uma var(--serie-…) de .viz. */
  cor: string;
  valor: (d: T) => number;
};

function diaCurto(iso: string) {
  return iso.slice(8, 10);
}

export function mesCurto(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
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
}: {
  dados: T[];
  series: SerieLinha<T>[];
  /** O canto direito da legenda: o total do período. */
  resumo: string;
  /** Uma linha a mais no tooltip do dia, quando houver o que dizer. */
  notaNoDia?: (d: T) => string | null;
  /** O texto quando todas as séries somam zero. */
  vazio: string;
  /** A legenda da tabela sr-only. */
  titulo: string;
  /** Altura da área do gráfico (classe Tailwind). */
  altura?: string;
}) {
  // id do degradê: único por gráfico (podem existir dois na mesma tela) e sem
  // os dois-pontos do useId, que quebram o url(#…).
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const maximo = Math.max(0, ...dados.flatMap((d) => series.map((s) => s.valor(d))));
  if (maximo === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-8 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        {vazio}
      </p>
    );
  }

  // Teto pela MAIOR série, não pela soma: são linhas, não pilha.
  const teto = tetoLimpo(maximo);

  return (
    <div className="viz">
      {/* Legenda sempre presente com 2 séries ou mais: identidade nunca
          depende só da cor. O texto usa token de tinta; quem carrega a
          identidade é o traço colorido ao lado. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.nome} className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.cor }} aria-hidden="true" />
            {s.nome}
          </span>
        ))}
        <span className="ml-auto text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{resumo}</span>
      </div>

      <div className={`${altura} -ml-1`} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dados} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.nome} id={`${base}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.cor} stopOpacity={0.26} />
                  <stop offset="95%" stopColor={s.cor} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--viz-grade)" />
            <XAxis
              dataKey="dia"
              tickFormatter={diaCurto}
              tick={{ fontSize: 10, fill: "var(--viz-eixo)" }}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={8}
              interval="preserveStartEnd"
            />
            <YAxis
              width={26}
              domain={[0, teto]}
              ticks={[0, teto / 2, teto]}
              allowDecimals={false}
              tick={{ fontSize: 10, fill: "var(--viz-eixo)" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ stroke: "var(--viz-cursor)", strokeWidth: 1 }}
              isAnimationActive={false}
              // O gráfico do dashboard é baixo: o tooltip passa da borda do
              // cartão e tem de ficar por cima do que vem embaixo.
              wrapperStyle={{ zIndex: 60 }}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as T | undefined;
                if (!active || !d) return null;
                const nota = notaNoDia?.(d);
                return (
                  <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[11px] shadow-md dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="mb-1 text-zinc-500 dark:text-zinc-400">{mesCurto(d.dia)}</p>
                    {series.map((s) => (
                      <p key={s.nome} className="flex items-center gap-2">
                        <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.cor }} aria-hidden="true" />
                        <span className="min-w-4 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{s.valor(d)}</span>
                        <span className="text-zinc-500 dark:text-zinc-400">{s.nome}</span>
                      </p>
                    ))}
                    {nota && <p className="mt-1 text-zinc-400 dark:text-zinc-500">{nota}</p>}
                  </div>
                );
              }}
            />
            {series.map((s, i) => (
              <Area
                key={s.nome}
                type="monotone"
                dataKey={s.valor}
                name={s.nome}
                stroke={s.cor}
                strokeWidth={2}
                fill={`url(#${base}-${i})`}
                dot={false}
                activeDot={{ r: 4, fill: s.cor, stroke: "var(--conteudo)", strokeWidth: 2 }}
                animationDuration={500}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

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
              <th scope="row">{mesCurto(d.dia)}</th>
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
