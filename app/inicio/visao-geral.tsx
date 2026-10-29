"use client";

// A faixa de cima do dashboard: o funil por dia, no gráfico de linha com sombra
// do app (./grafico-funil.ts). Três linhas desde 2026-10-29 (pedido dele: "quantos
// leads entraram, a taxa de resposta/atendimento gerado e uma linha que une
// reunião IA e humana"): os leads que entraram, quantos deles responderam
// (atendimento gerado, com a taxa de resposta na legenda) e as reuniões
// agendadas, IA e equipe somadas. Passando o mouse, o tooltip do dia diz quantas
// reuniões foram pela IA e quantas pela equipe.
//
// PERÍODO E TOTAIS (2026-10-29, mesmo dia: "selecionar por 30 dias, por semana
// e personalizado; mostrar no canto o total do funil agendado e de leads e ao
// lado esses valores para o período"): 30 dias e Semana saem da carga da tela;
// Personalizado busca o intervalo no servidor (./acoes-grafico.ts). No canto, o
// total do funil desde sempre e, ao lado, o mesmo no período escolhido.
// Trocar de funil volta para 30 dias (quem usa remonta pela key do funil).
//
// Em 2026-10-05 ("deixa minimalista") ela juntava os números do funil e este
// gráfico numa peça só. Em 2026-10-06 ele pediu para tirar os números
// (oportunidades, valor no funil, ticket médio, conversão): o que é por etapa
// já está nas colunas logo abaixo, e a faixa ficou só com o que o quadro não
// mostra.
//
// As cores são as do FUNIL aberto (funis.cor), nas duas pontas da rampa dele:
// leads na clara, que é onde o lead entra; reunião na escura, perto do
// fechamento — a mesma leitura das colunas. O atendimento gerado, no meio do
// caminho, vai no cinza neutro (--serie-neutra). Os valores por tom e modo
// estão no globals.css (.viz).
//
// Sem overflow-hidden no cartão: o gráfico é baixo e o tooltip passa da borda
// de baixo.
//
// MINIMIZA (2026-10-08, pedido dele junto com o ajuste para tablet deitado):
// recolhido, sobram o período, os totais e a legenda — os números continuam à
// vista e o quadro ganha a altura do gráfico. A escolha é do aparelho, e quem
// nunca escolheu numa tela baixa (tablet deitado, notebook de 768) já abre
// minimizado: ali o gráfico custava um cartão inteiro por coluna.
import { useState, useTransition } from "react";
import { CalendarCheck2, ChevronDown, ChevronUp, Loader2, MessageCircle, UserPlus } from "@/app/components/icones";
import { LinhasPorDia, type SerieLinha } from "../components/grafico-linhas";
import { criarPreferencia, TELA_BAIXA } from "../components/preferencia-local";
import type { DiaDoFunil, GraficoDoFunil } from "./grafico-funil";
import { graficoDoPeriodo } from "./acoes-grafico";

const graficoRecolhido = criarPreferencia(
  "chroma:grafico-ia-recolhido",
  () => window.matchMedia(TELA_BAIXA).matches,
);

type Periodo = "30" | "7" | "personalizado";
const PERIODOS: Array<{ valor: Periodo; rotulo: string }> = [
  { valor: "30", rotulo: "30 dias" },
  { valor: "7", rotulo: "Semana" },
  { valor: "personalizado", rotulo: "Personalizado" },
];

const agendadas = (d: DiaDoFunil) => d.reunioesIa + d.reunioesEquipe;
const soma = (dias: DiaDoFunil[], valor: (d: DiaDoFunil) => number) => dias.reduce((s, d) => s + valor(d), 0);

// A taxa sobre os leads que entraram no período, na nota da linha.
function taxa(dias: DiaDoFunil[], valor: (d: DiaDoFunil) => number, sufixo: string): string | null {
  const leads = soma(dias, (d) => d.leads);
  const n = soma(dias, valor);
  return n > 0 && leads > 0 ? `(${Math.round((n / leads) * 100)}% ${sufixo})` : null;
}

// Ícones: entrada de gente (UserPlus), conversa (MessageCircle) e agenda (CalendarCheck2).
const SERIES: SerieLinha<DiaDoFunil>[] = [
  { nome: "Leads no funil", cor: "var(--serie-tom-claro)", Icone: UserPlus, valor: (d) => d.leads },
  {
    nome: "Atendimentos gerados",
    cor: "var(--serie-neutra)",
    Icone: MessageCircle,
    valor: (d) => d.atendimentos,
    nota: (dias) => taxa(dias, (d) => d.atendimentos, "de resposta"),
  },
  {
    nome: "Reuniões agendadas",
    cor: "var(--serie-tom-escuro)",
    Icone: CalendarCheck2,
    valor: agendadas,
    nota: (dias) => {
      const ia = soma(dias, (d) => d.reunioesIa);
      const equipe = soma(dias, (d) => d.reunioesEquipe);
      return ia + equipe > 0 ? `(${ia} pela IA · ${equipe} pela equipe)` : null;
    },
  },
];

/** A linha extra do tooltip do dia: de quem são as reuniões e a resposta dos leads. */
function notaDoDia(d: DiaDoFunil): string | null {
  const partes = [
    agendadas(d) > 0 ? `Reuniões: ${d.reunioesIa} pela IA · ${d.reunioesEquipe} pela equipe` : null,
    d.leads > 0 ? `Resposta: ${d.atendimentos} de ${d.leads} (${Math.round((d.atendimentos / d.leads) * 100)}%)` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

const numero = (n: number) => n.toLocaleString("pt-BR");
const curta = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** "12 leads · 3 agendadas", com os números em destaque. */
function Par({ rotulo, leads, agendadas }: { rotulo: string; leads: number; agendadas: number }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap text-[11px] text-zinc-500 dark:text-zinc-400">
      <span className="font-medium uppercase tracking-wide text-[10px] text-zinc-400 dark:text-zinc-500">{rotulo}</span>
      <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{numero(leads)}</span>
      {leads === 1 ? "lead" : "leads"}
      <span aria-hidden="true">·</span>
      <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{numero(agendadas)}</span>
      {agendadas === 1 ? "agendada" : "agendadas"}
    </span>
  );
}

export default function VisaoGeral({ grafico, tom, funilId }: { grafico: GraficoDoFunil; tom: string; funilId: string }) {
  const recolhido = graficoRecolhido.useValor();
  const [periodo, setPeriodo] = useState<Periodo>("30");
  const [intervalo, setIntervalo] = useState({ de: grafico.dias[0]?.dia ?? "", ate: grafico.dias.at(-1)?.dia ?? "" });
  const [personalizados, setPersonalizados] = useState<DiaDoFunil[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, iniciar] = useTransition();

  const dias =
    periodo === "7" ? grafico.dias.slice(-7) : periodo === "personalizado" && personalizados ? personalizados : grafico.dias;
  const resumo =
    periodo === "personalizado" && personalizados && dias.length
      ? `${curta(dias[0].dia)} a ${curta(dias.at(-1)!.dia)}`
      : `últimos ${dias.length} dias`;
  const noPeriodo = {
    leads: dias.reduce((s, d) => s + d.leads, 0),
    agendadas: soma(dias, agendadas),
  };

  function buscar(de: string, ate: string) {
    setIntervalo({ de, ate });
    if (!de || !ate) return;
    if (de > ate) return setErro("A data inicial vem depois da final.");
    setErro(null);
    iniciar(async () => {
      const r = await graficoDoPeriodo(funilId, de, ate);
      if (!r.ok) return setErro(r.erro);
      setPersonalizados(r.dias);
    });
  }

  function escolher(p: Periodo) {
    setPeriodo(p);
    setErro(null);
    if (p === "personalizado" && !personalizados) buscar(intervalo.de, intervalo.ate);
  }

  return (
    <section aria-label="Leads e reuniões neste funil" className="surge mb-3 shrink-0 pr-6 xl:pr-16">
      <div
        className={`rounded-xl border border-zinc-200 px-4 dark:border-zinc-800 ${
          recolhido ? "py-2" : "pb-2 pt-3"
        }`}
      >
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900" role="group" aria-label="Período do gráfico">
              {PERIODOS.map((p) => (
                <button
                  key={p.valor}
                  type="button"
                  onClick={() => escolher(p.valor)}
                  aria-pressed={periodo === p.valor}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                    periodo === p.valor
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                  }`}
                >
                  {p.rotulo}
                </button>
              ))}
            </span>
            {periodo === "personalizado" && (
              <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                <input
                  type="date"
                  value={intervalo.de}
                  max={intervalo.ate || undefined}
                  onChange={(e) => buscar(e.target.value, intervalo.ate)}
                  aria-label="Data inicial"
                  className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                />
                a
                <input
                  type="date"
                  value={intervalo.ate}
                  min={intervalo.de || undefined}
                  onChange={(e) => buscar(intervalo.de, e.target.value)}
                  aria-label="Data final"
                  className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                />
                {buscando && <Loader2 className="size-3.5 animate-spin text-zinc-400" aria-label="Buscando o período" />}
              </span>
            )}
            {erro && <span className="text-[11px] text-red-600 dark:text-red-400">{erro}</span>}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
            <Par rotulo="Total do funil" leads={grafico.totais.leads} agendadas={grafico.totais.agendadas} />
            <Par rotulo="No período" leads={noPeriodo.leads} agendadas={noPeriodo.agendadas} />
            <button
              type="button"
              onClick={() => graficoRecolhido.definir(!recolhido)}
              aria-expanded={!recolhido}
              aria-label={recolhido ? "Mostrar o gráfico" : "Minimizar o gráfico"}
              title={recolhido ? "Mostrar o gráfico" : "Minimizar o gráfico"}
              // -my/-mr: o botão tem área de toque de 24px sem engordar a
              // linha nem descolar do canto do cartão
              className="-my-1 -mr-2 flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              {recolhido ? (
                <ChevronDown className="size-4" aria-hidden="true" />
              ) : (
                <ChevronUp className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        <LinhasPorDia
          recolhido={recolhido}
          dados={dias}
          series={SERIES}
          notaNoDia={notaDoDia}
          tom={tom}
          altura="h-20"
          totais
          resumo={resumo}
          vazio={`Nenhum lead nem reunião neste funil (${resumo})`}
          titulo={`Leads que entraram, atendimentos gerados e reuniões agendadas neste funil, por dia (${resumo})`}
        />
      </div>
    </section>
  );
}
