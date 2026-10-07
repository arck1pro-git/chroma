"use client";

// A faixa de cima do dashboard: a IA nos últimos 30 dias, no gráfico de linha
// com sombra do app.
//
// Em 2026-10-05 ("deixa minimalista") ela juntava os números do funil e este
// gráfico numa peça só. Em 2026-10-06 ele pediu para tirar os números
// (oportunidades, valor no funil, ticket médio, conversão): o que é por etapa
// já está nas colunas logo abaixo, e a faixa ficou só com o que o quadro não
// mostra.
//
// As cores são as do FUNIL aberto (funis.cor), nas duas pontas da rampa dele:
// atendimento na clara, que é onde o lead entra; reunião na escura, perto do
// fechamento — a mesma leitura das colunas. Os valores por tom e modo estão no
// globals.css (.viz[data-tom]).
//
// Sem overflow-hidden no cartão: o gráfico é baixo e o tooltip passa da borda
// de baixo.
import { Bot, CalendarCheck2 } from "lucide-react";
import { LinhasPorDia, type SerieLinha } from "../components/grafico-linhas";
import type { DiaIa } from "./atendimentos-ia";

// Os ícones são os da agenda: Bot para a IA, CalendarCheck2 para reunião.
const SERIES: SerieLinha<DiaIa>[] = [
  { nome: "Atendimentos de IA", cor: "var(--serie-tom-claro)", Icone: Bot, valor: (d) => d.atendimentos },
  {
    nome: "Reuniões marcadas",
    cor: "var(--serie-tom-escuro)",
    Icone: CalendarCheck2,
    valor: (d) => d.reunioes,
    // Quanto do total foi a IA que marcou — o resultado dela no período.
    nota: (dias) => {
      const n = dias.reduce((s, d) => s + d.reunioesIa, 0);
      return n > 0 ? `(${n} pela IA)` : null;
    },
  },
];

export default function VisaoGeral({ dias, tom }: { dias: DiaIa[]; tom: string }) {
  return (
    <section aria-label="Atendimentos de IA" className="surge mb-3 shrink-0 pr-6 xl:pr-16">
      <div className="rounded-xl border border-zinc-200 px-4 pb-2 pt-3 dark:border-zinc-800">
        <LinhasPorDia
          dados={dias}
          series={SERIES}
          tom={tom}
          altura="h-20"
          totais
          resumo={`últimos ${dias.length} dias`}
          notaNoDia={(d) => (d.reunioesIa > 0 ? `das reuniões, ${d.reunioesIa} pela IA` : null)}
          vazio={`Nenhum atendimento de IA nem reunião nos últimos ${dias.length} dias`}
          titulo={`Atendimentos de IA e reuniões marcadas por dia, últimos ${dias.length} dias`}
        />
      </div>
    </section>
  );
}
