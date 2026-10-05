"use client";

// A faixa de cima do dashboard (2026-10-05, "deixa minimalista"): os números
// do funil e o gráfico de IA numa peça só, no lugar de três (a linha do título
// com contagem e total, o cartão do gráfico e as fileiras de campanha).
//
// À ESQUERDA, o funil que está NA TELA: as contas saem de metricasDoFunil sobre
// as oportunidades visíveis, então um filtro ligado recorta os números junto
// com o quadro — número que não bate com as colunas logo abaixo é pior que
// nenhum. Retrato do agora, não histórico (ver ./metricas.ts).
//
// À DIREITA, a IA nos últimos 30 dias, no gráfico de linha com sombra do app.
//
// Divisórias em hairline com divide-x/divide-y (duas linhas de dois números),
// e não o truque do gap de 1px sobre fundo cinza: aquele exigia
// overflow-hidden no cartão para arredondar os cantos, e o overflow cortava o
// tooltip do gráfico na borda de baixo.
import { LinhasPorDia, type SerieLinha } from "../components/grafico-linhas";
import { brl } from "../formato";
import type { MetricasFunil } from "./metricas";
import type { DiaIa } from "./atendimentos-ia";

const SERIES: SerieLinha<DiaIa>[] = [
  { nome: "Atendimentos de IA", cor: "var(--serie-ok)", valor: (d) => d.atendimentos },
  { nome: "Reuniões marcadas", cor: "var(--serie-reuniao)", valor: (d) => d.reunioes },
];

// "R$ 1,3 mi", "R$ 350 mil": o número grande é para bater o olho; o valor
// cheio fica no title. Na mão, e não com Intl `notation: "compact"`: o Node
// escreve "R$ 0,0" e o Chrome "R$ 0", e o texto do servidor diferente do
// cliente quebra a hidratação.
function compacto(valor: number) {
  const um = (v: number) => v.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  if (valor >= 1_000_000) return `R$ ${um(valor / 1_000_000)} mi`;
  if (valor >= 10_000) return `R$ ${Math.round(valor / 1_000)} mil`;
  return brl(valor);
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function Numero({
  rotulo,
  valor,
  nota,
  dica,
}: {
  rotulo: string;
  valor: string;
  /** Texto curto e apagado ao lado do número. */
  nota?: string;
  /** O title: o valor cheio ou a explicação da conta. */
  dica?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-2.5" title={dica}>
      <dt className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{rotulo}</dt>
      <dd className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
        <span className="text-lg font-semibold leading-6 tracking-tight text-zinc-900 dark:text-zinc-50">{valor}</span>
        {nota && <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{nota}</span>}
      </dd>
    </div>
  );
}

export default function VisaoGeral({
  metricas,
  totalDoFunil,
  filtrado,
  dias,
}: {
  /** As contas do funil sobre o que o quadro mostra agora. */
  metricas: MetricasFunil;
  /** Quantas o funil tem sem filtro, para o "de N". */
  totalDoFunil: number;
  filtrado: boolean;
  dias: DiaIa[];
}) {
  const atendimentos = dias.reduce((s, d) => s + d.atendimentos, 0);
  const reunioes = dias.reduce((s, d) => s + d.reunioes, 0);
  const gargalo = metricas.leads > 0 ? metricas.piorPasso : null;

  return (
    <section aria-label="Visão geral" className="surge mb-3 shrink-0 pr-6 xl:pr-16">
      <div className="grid rounded-xl border border-zinc-200 dark:border-zinc-800 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <dl className="divide-y divide-zinc-200 border-b border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800 lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-2 divide-x divide-zinc-200 dark:divide-zinc-800">
            <Numero
              rotulo="Oportunidades"
              valor={String(metricas.leads)}
              nota={filtrado ? `de ${totalDoFunil}` : undefined}
            />
            <Numero rotulo="Valor no funil" valor={compacto(metricas.valorTotal)} dica={brl(metricas.valorTotal)} />
          </div>
          <div className="grid grid-cols-2 divide-x divide-zinc-200 dark:divide-zinc-800">
            <Numero rotulo="Ticket médio" valor={compacto(metricas.ticketMedio)} dica={brl(metricas.ticketMedio)} />
            <Numero
              rotulo="Conversão do funil"
              valor={`${metricas.conversaoTotal}%`}
              nota={gargalo ? `gargalo em ${gargalo.origem}` : undefined}
              dica={
                "Dos que entraram na primeira etapa, quantos estão na última." +
                (gargalo
                  ? ` Menor passo: ${gargalo.origem} → ${gargalo.destino}, ${gargalo.taxa}% (${gargalo.seguiram} de ${gargalo.entraram}).`
                  : "")
              }
            />
          </div>
        </dl>

        <div className="min-w-0 px-4 pb-2 pt-3">
          <LinhasPorDia
            dados={dias}
            series={SERIES}
            altura="h-20"
            resumo={`${plural(atendimentos, "atendimento", "atendimentos")} · ${plural(reunioes, "reunião", "reuniões")} em ${dias.length} dias`}
            notaNoDia={(d) => (d.reunioesIa > 0 ? `das reuniões, ${d.reunioesIa} pela IA` : null)}
            vazio={`Nenhum atendimento de IA nem reunião nos últimos ${dias.length} dias`}
            titulo={`Atendimentos de IA e reuniões marcadas por dia, últimos ${dias.length} dias`}
          />
        </div>
      </div>
    </section>
  );
}
