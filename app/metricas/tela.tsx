"use client";

// Métricas: demandas GERADAS e ENTREGUES — hoje, nesta semana, neste mês — e o
// gráfico por dia, por semana ou por mês. Da equipe toda ou de um usuário.
//
// SÓ ISSO, por pedido dele (2026-10-07): "só ver demandas geradas por dia, na
// semana, no mês e entregues, podendo filtrar por usuário". A faixa Comercial
// e as contas por departamento saíram.
//
// PARA TODO MUNDO, com o filtro por pessoa só para Admin e TI (2026-10-07):
// os demais veem os próprios números, sem filtro — o servidor só mandou a
// própria pessoa.
//
// O FILTRO e a escala do gráfico são instantâneos: o servidor já manda o
// recorte de cada usuário e as três escalas, e trocar é só escolher qual
// mostrar. Os dois ficam na URL (?pessoa=, ?ver=) pelo history do navegador —
// sem ida ao servidor — para o link abrir no mesmo recorte.
import { useMemo, useState } from "react";
import { CircleCheck, ListPlus, UsersRound } from "lucide-react";
import { LinhasPorDia, type EscalaLinha, type SerieLinha } from "../components/grafico-linhas";
import { SeletorMenu } from "../components/filtros-ui";
import type { Balde, Contagem, MetricasDemandas } from "./demandas";

export type Visao = "dia" | "semana" | "mes";

// ── Datas ───────────────────────────────────────────────────────────────────

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const diaMes = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const nomeDoMes = (dia: string) => MESES[Number(dia.slice(5, 7)) - 1];
const diaDaSemana = (dia: string) => SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()];

function segunda(dia: string) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function mesAnterior(dia: string) {
  const d = new Date(`${dia.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Cores ───────────────────────────────────────────────────────────────────

// O par entrada × saída, o mesmo nos números e no gráfico: a ponta clara do
// verde é o que ENTROU (gerada), a escura o que SAIU (entregue) — a leitura
// claro = entrada, escuro = fechamento do resto do app. Verde porque é a cor do
// check na tela de Demandas. Validadas em globals.css (.viz[data-tom]).
const TOM = "emerald";
const COR_GERADAS = "var(--serie-tom-claro)";
const COR_ENTREGUES = "var(--serie-tom-escuro)";

const SERIES: SerieLinha<Balde>[] = [
  { nome: "Geradas", cor: COR_GERADAS, Icone: ListPlus, valor: (b) => b.geradas },
  { nome: "Entregues", cor: COR_ENTREGUES, Icone: CircleCheck, valor: (b) => b.entregues },
];

const VISOES: Array<{ valor: Visao; rotulo: string; resumo: string }> = [
  { valor: "dia", rotulo: "Por dia", resumo: "últimos 30 dias" },
  { valor: "semana", rotulo: "Por semana", resumo: "últimas 12 semanas" },
  { valor: "mes", rotulo: "Por mês", resumo: "últimos 12 meses" },
];

// ── A tela ──────────────────────────────────────────────────────────────────

export default function TelaMetricas({
  metricas,
  veEquipe,
  nome,
  pessoaInicial,
  visaoInicial,
}: {
  metricas: MetricasDemandas;
  /** Admin e TI: a equipe toda e o filtro por pessoa. */
  veEquipe: boolean;
  nome: string;
  pessoaInicial: string | null;
  visaoInicial: Visao;
}) {
  const soMinhas = !veEquipe;
  const [pessoa, setPessoa] = useState<string | null>(pessoaInicial);
  const [visao, setVisao] = useState<Visao>(visaoInicial);
  const escolhida = pessoa ? metricas.pessoas.find((p) => p.id === pessoa) ?? null : null;
  const r = (escolhida && metricas.porPessoa[escolhida.id]) || metricas.equipe;
  const { hoje } = metricas;

  // Na URL, sem ida ao servidor: o Next acompanha o history nativo, e o link
  // copiado da barra abre no mesmo recorte.
  function naUrl(chave: string, valor: string | null) {
    const params = new URLSearchParams(window.location.search);
    if (valor) params.set(chave, valor);
    else params.delete(chave);
    const busca = params.toString();
    window.history.replaceState(null, "", busca ? `?${busca}` : window.location.pathname);
  }

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
  const quem = soMinhas ? nome : escolhida ? escolhida.nome : "a equipe toda";

  return (
    <div className="flex-1 overflow-y-auto bg-conteudo px-6 py-6 xl:px-10">
      {/* @container: as colunas seguem a largura DESTA área, não a da janela —
          com a barra lateral aberta, uma janela de 1024px deixa ~720px aqui. */}
      <div className="@container mx-auto flex max-w-5xl flex-col gap-5">
        {/* z-20: o menu de usuários abre por cima dos cartões. */}
        <header className="relative z-20 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Métricas</h1>
            {/* Diz na cara de quem é o número — a diferença entre "meus" e "da
                casa" é o sentido inteiro da tela. */}
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              Demandas geradas e entregues · {quem}
            </p>
          </div>
          {!soMinhas && (
            <SeletorMenu
              Icone={UsersRound}
              rotulo="Usuário"
              valor={pessoa ?? ""}
              opcoes={[{ valor: "", rotulo: "Equipe toda" }, ...metricas.pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))]}
              aoMudar={(v) => {
                setPessoa(v || null);
                naUrl("pessoa", v || null);
              }}
              botao="w-56"
              ativo={Boolean(pessoa)}
            />
          )}
        </header>

        {metricas.faltaTabela ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            A tabela de demandas ainda não existe neste banco. Rode <code>migration-demandas.sql</code> e recarregue.
          </p>
        ) : (
          <>
            <section aria-label="Hoje, esta semana e este mês" className="viz grid grid-cols-1 gap-3 @2xl:grid-cols-3" data-tom={TOM}>
              <Periodo
                ordem={0}
                titulo="Hoje"
                quando={`${diaDaSemana(hoje)}, ${diaMes(hoje)}`}
                atual={r.hoje}
                anterior={r.ontem}
                rotuloAnterior="Ontem"
              />
              <Periodo
                ordem={1}
                titulo="Esta semana"
                quando={`desde seg, ${diaMes(segunda(hoje))}`}
                atual={r.semana}
                anterior={r.semanaPassada}
                rotuloAnterior="Semana passada"
              />
              <Periodo
                ordem={2}
                titulo="Este mês"
                quando={nomeDoMes(hoje)}
                atual={r.mes}
                anterior={r.mesPassado}
                rotuloAnterior={nomeDoMes(mesAnterior(hoje)).replace(/^./, (c) => c.toUpperCase())}
              />
            </section>

            <section
              aria-labelledby="titulo-grafico"
              className="viz surge rounded-2xl border border-zinc-200 px-5 pb-4 pt-4 dark:border-zinc-800"
              data-tom={TOM}
              style={{ animationDelay: "90ms" }}
            >
              <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 id="titulo-grafico" className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                  Geradas e entregues
                </h2>
                <div role="radiogroup" aria-label="Escala do gráfico" className="flex items-center gap-0.5 rounded-lg border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
                  {VISOES.map((v) => (
                    <button
                      key={v.valor}
                      type="button"
                      role="radio"
                      aria-checked={visao === v.valor}
                      onClick={() => {
                        setVisao(v.valor);
                        naUrl("ver", v.valor === "dia" ? null : v.valor);
                      }}
                      className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                        visao === v.valor
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                      }`}
                    >
                      {v.rotulo}
                    </button>
                  ))}
                </div>
              </header>
              <LinhasPorDia
                key={visao}
                dados={baldes}
                series={SERIES}
                tom={TOM}
                altura="h-56"
                totais
                escala={escala}
                resumo={daVisao.resumo}
                notaNoDia={(b) => (b.geradas > b.entregues ? `fila +${b.geradas - b.entregues}` : b.entregues > b.geradas ? `fila −${b.entregues - b.geradas}` : null)}
                vazio={`Nenhuma demanda gerada nem entregue nos ${daVisao.resumo}.`}
                titulo={`Demandas geradas e entregues ${daVisao.rotulo.toLowerCase()}, ${daVisao.resumo}`}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// Um período: as geradas e as entregues lado a lado, grandes, e o anterior do
// mesmo tipo embaixo, por inteiro — "ontem", "semana passada", "setembro". O
// anterior vai em número e não em %: comparar a semana pela metade com a
// inteira em porcentagem daria um "−60%" que só quer dizer "é quarta-feira".
function Periodo({
  ordem, titulo, quando, atual, anterior, rotuloAnterior,
}: {
  ordem: number;
  titulo: string;
  quando: string;
  atual: Contagem;
  anterior: Contagem;
  rotuloAnterior: string;
}) {
  return (
    <article
      className="surge rounded-2xl border border-zinc-200 px-5 pb-4 pt-4 dark:border-zinc-800"
      style={{ animationDelay: `${ordem * 30}ms` }}
      aria-label={`${titulo}: ${atual.geradas} geradas, ${atual.entregues} entregues`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h2>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{quando}</span>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-4">
        <Numero Icone={ListPlus} cor={COR_GERADAS} rotulo="Geradas" valor={atual.geradas} />
        <Numero Icone={CircleCheck} cor={COR_ENTREGUES} rotulo="Entregues" valor={atual.entregues} />
      </dl>
      <p className="mt-3 border-t border-zinc-100 pt-2.5 text-[11px] tabular-nums text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {rotuloAnterior}: {anterior.geradas} {anterior.geradas === 1 ? "gerada" : "geradas"} · {anterior.entregues}{" "}
        {anterior.entregues === 1 ? "entregue" : "entregues"}
      </p>
    </article>
  );
}

function Numero({ Icone, cor, rotulo, valor }: { Icone: typeof ListPlus; cor: string; rotulo: string; valor: number }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        <Icone className="size-3.5 shrink-0" style={{ color: cor }} aria-hidden="true" />
        {rotulo}
      </dt>
      <dd className="mt-1 text-[32px] font-semibold leading-none tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
        {valor.toLocaleString("pt-BR")}
      </dd>
    </div>
  );
}
