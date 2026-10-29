"use client";

// A faixa de cima do dashboard: o funil nos últimos 30 dias, no gráfico de
// linha com sombra do app. Desde 2026-10-29 (pedido dele: "leads que entrou no
// funil x reuniões IA x reuniões humanas") são três linhas: os leads que
// entraram, as reuniões que a IA marcou e as que a equipe marcou
// (./grafico-funil.ts). As notas dão a taxa de reunião sobre os leads do período.
//
// Em 2026-10-05 ("deixa minimalista") ela juntava os números do funil e este
// gráfico numa peça só. Em 2026-10-06 ele pediu para tirar os números
// (oportunidades, valor no funil, ticket médio, conversão): o que é por etapa
// já está nas colunas logo abaixo, e a faixa ficou só com o que o quadro não
// mostra.
//
// As cores são as do FUNIL aberto (funis.cor), nas duas pontas da rampa dele:
// leads na clara, que é onde o lead entra; reunião da IA na escura, perto do
// fechamento — a mesma leitura das colunas. A reunião da equipe vai no cinza
// neutro (--serie-neutra). Os valores por tom e modo estão no globals.css (.viz).
//
// POR FUNIL desde 2026-10-21: os números são os do funil aberto.
//
// Sem overflow-hidden no cartão: o gráfico é baixo e o tooltip passa da borda
// de baixo.
//
// MINIMIZA (2026-10-08, pedido dele junto com o ajuste para tablet deitado):
// recolhido, sobra só a linha dos totais — os dois números continuam à vista e
// o quadro ganha a altura do gráfico. A escolha é do aparelho, e quem nunca
// escolheu numa tela baixa (tablet deitado, notebook de 768) já abre
// minimizado: ali o gráfico custava um cartão inteiro por coluna.
import { Bot, ChevronDown, ChevronUp, UserPlus, Users } from "@/app/components/icones";
import { LinhasPorDia, type SerieLinha } from "../components/grafico-linhas";
import { criarPreferencia, TELA_BAIXA } from "../components/preferencia-local";
import type { DiaDoFunil, GraficoDoFunil } from "./grafico-funil";

const graficoRecolhido = criarPreferencia(
  "chroma:grafico-ia-recolhido",
  () => window.matchMedia(TELA_BAIXA).matches,
);

// A taxa de reunião sobre os leads que entraram no período, na nota da linha.
function taxa(dias: DiaDoFunil[], reunioes: (d: DiaDoFunil) => number): string | null {
  const leads = dias.reduce((s, d) => s + d.leads, 0);
  const n = dias.reduce((s, d) => s + reunioes(d), 0);
  return n > 0 && leads > 0 ? `(${Math.round((n / leads) * 100)}% dos leads)` : null;
}

// Ícones: entrada de gente (UserPlus), a IA (Bot) e a equipe (Users).
const SERIES: SerieLinha<DiaDoFunil>[] = [
  { nome: "Leads no funil", cor: "var(--serie-tom-claro)", Icone: UserPlus, valor: (d) => d.leads },
  { nome: "Reuniões pela IA", cor: "var(--serie-tom-escuro)", Icone: Bot, valor: (d) => d.reunioesIa, nota: (dias) => taxa(dias, (d) => d.reunioesIa) },
  { nome: "Reuniões pela equipe", cor: "var(--serie-neutra)", Icone: Users, valor: (d) => d.reunioesEquipe, nota: (dias) => taxa(dias, (d) => d.reunioesEquipe) },
];

export default function VisaoGeral({ grafico, tom }: { grafico: GraficoDoFunil; tom: string }) {
  const recolhido = graficoRecolhido.useValor();
  const { dias } = grafico;

  return (
    <section aria-label="Leads e reuniões neste funil" className="surge mb-3 shrink-0 pr-6 xl:pr-16">
      <div
        className={`rounded-xl border border-zinc-200 px-4 dark:border-zinc-800 ${
          recolhido ? "py-2" : "pb-2 pt-3"
        }`}
      >
        <LinhasPorDia
          recolhido={recolhido}
          acao={
            <button
              type="button"
              onClick={() => graficoRecolhido.definir(!recolhido)}
              aria-expanded={!recolhido}
              aria-label={recolhido ? "Mostrar o gráfico" : "Minimizar o gráfico"}
              title={recolhido ? "Mostrar o gráfico" : "Minimizar o gráfico"}
              // -my/-mr: o botão tem área de toque de 24px sem engordar a
              // linha da legenda nem descolar do canto do cartão
              className="-my-1 -mr-2 flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              {recolhido ? (
                <ChevronDown className="size-4" aria-hidden="true" />
              ) : (
                <ChevronUp className="size-4" aria-hidden="true" />
              )}
            </button>
          }
          dados={dias}
          series={SERIES}
          tom={tom}
          altura="h-20"
          totais
          resumo={`últimos ${dias.length} dias`}
          vazio={`Nenhum lead nem reunião neste funil nos últimos ${dias.length} dias`}
          titulo={`Leads que entraram, reuniões marcadas pela IA e pela equipe neste funil, por dia, últimos ${dias.length} dias`}
        />
      </div>
    </section>
  );
}
