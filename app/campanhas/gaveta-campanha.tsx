"use client";

import { useCallback, useEffect } from "react";
import { ArrowUpRight, Contact, LoaderCircle, Megaphone, Settings2, TrendingUp, Wallet, X } from "lucide-react";
import type { DetalheCampanhaAds, DiaCampanhaAds, LinhaAds } from "@/lib/meta-ads-tipos";
import { dividir } from "@/lib/meta-ads-calculos";
import Indicador from "../components/indicador";
import { corDoCss, degrade, useGrafico, type Desenho } from "../components/grafico-canvas";
import { useConsulta } from "./use-consulta";
import { botaoAds, entregaLegivel, objetivos } from "./pecas";

// Gaveta da direita do Meta Ads, no mesmo desenho da gaveta de contatos da tela
// inicial: véu que fecha ao clique, painel flutuante encostado na direita e Esc
// para sair. É aqui que campanha, conjuntos, anúncios e resultado no CRM
// aparecem juntos — a lista à esquerda mostra só o suficiente para escolher.
//
// Cada número aparece UMA vez. Os custos unitários moram nos degraus do funil,
// onde têm denominador visível, em vez de um parágrafo solto repetindo o que os
// indicadores do topo já disseram.
//
// Os números do topo vêm da linha da lista (o relatório da conta). O resto —
// série por dia, conjuntos e anúncios — é a carga da própria gaveta, pedida só
// quando ela abre (lib/meta-ads-relatorio.ts, carregarDetalheCampanha).
//
// Meta × CRM aqui também: os dois leads lado a lado no topo, nas linhas do
// gráfico (nas mesmas cores do resumo da lista) e em cada conjunto e anúncio.

const numero = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const inteiro = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const diaCurto = (v: string) => String(v).slice(5).split("-").reverse().join("/");

export default function GavetaCampanha({ linha, conta, periodo, podeGerenciar, gerenciando, aoGerenciar, aoFechar }: {
  linha: LinhaAds;
  conta: { id: string; currency: string }; periodo: { inicio: string; fim: string };
  podeGerenciar: boolean; gerenciando: boolean; aoGerenciar: (item: LinhaAds) => void; aoFechar: () => void;
}) {
  const m = linha.metricas, crm = linha.crm;
  const moedasIguais = conta.currency === "BRL";
  const dinheiro = (v: number | null, moeda = conta.currency) => v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: moeda });
  const detalhe = useConsulta<DetalheCampanhaAds>(`/api/meta/ads/painel?${new URLSearchParams({ serie: "1", conta: conta.id, campanha: linha.id, ...periodo })}`);
  const conjuntos = detalhe.dados?.conjuntos ?? [], anuncios = detalhe.dados?.anuncios ?? [];
  const carregandoDetalhe = detalhe.carregando || !detalhe.dados;

  // Esc fecha a gaveta — menos quando o painel de gestão está por cima, que tem
  // o próprio Esc: sem esta saída uma tecla fecharia os dois de uma vez.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) { if (e.key === "Escape" && !gerenciando) aoFechar(); }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, gerenciando]);

  // Do clique à oportunidade ganha: quanto sobrou do degrau anterior e quanto
  // custou cada unidade deste.
  const passos = [
    { rotulo: "Cliques no anúncio", valor: m.cliques, custo: m.cpc, unidade: "clique" },
    { rotulo: "Leads na Meta", valor: m.leads, custo: dividir(m.gasto, m.leads), unidade: "lead" },
    ...(crm ? [
      { rotulo: "Leads no CRM", valor: crm.leads, custo: dividir(m.gasto, crm.leads), unidade: "lead" },
      { rotulo: "Oportunidades", valor: crm.oportunidades, custo: dividir(m.gasto, crm.oportunidades), unidade: "oportunidade" },
      { rotulo: "Avançaram no funil", valor: crm.avancaram, custo: dividir(m.gasto, crm.avancaram), unidade: "avanço" },
      { rotulo: "Ganhas", valor: crm.ganhas, custo: dividir(m.gasto, crm.ganhas), unidade: "ganha" },
    ] : []),
  ];
  const topo = Math.max(...passos.map(p => p.valor), 1);
  const orcamento = Number(linha.daily_budget) > 0 ? `${dinheiro(Number(linha.daily_budget) / 100)} por dia`
    : Number(linha.lifetime_budget) > 0 ? `${dinheiro(Number(linha.lifetime_budget) / 100)} no total` : "Orçamento no conjunto";

  return <>
    <div className="veu-surge fixed inset-0 z-[90] bg-transparent" onClick={aoFechar} aria-hidden="true"/>
    <aside
      className="ficha-entra fixed bottom-4 right-4 top-4 z-[100] flex w-[34rem] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      aria-label={`Campanha ${linha.name}`}
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-base font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
            <span className="truncate">{linha.name}</span>
            {linha.effective_status === "ACTIVE" && <span role="img" aria-label="Em veiculação" className="size-1.5 shrink-0 rounded-full bg-emerald-400"/>}
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {objetivos[linha.objective ?? ""] ?? "Campanha"}
            {linha.effective_status !== "ACTIVE" && ` · ${entregaLegivel(linha.effective_status)}`}
            {` · ${orcamento} · ${diaCurto(periodo.inicio)} a ${diaCurto(periodo.fim)}`}
          </p>
        </div>
        <button type="button" disabled={!podeGerenciar} onClick={() => aoGerenciar(linha)} aria-label={`Gerenciar ${linha.name}`} title="Gerenciar na Meta"
          className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
          <Settings2 className="size-4" aria-hidden="true"/>
        </button>
        <button type="button" onClick={aoFechar} aria-label="Fechar campanha"
          className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
          <X className="size-4" aria-hidden="true"/>
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          <Indicador ordem={0} Icone={Wallet} rotulo="Investido" valor={dinheiro(m.gasto)} detalhe={`${inteiro(m.impressoes)} impressões`}/>
          <Indicador ordem={1} Icone={Megaphone} rotulo="Leads na Meta" valor={inteiro(m.leads)} detalhe={m.leads > 0 ? `${dinheiro(dividir(m.gasto, m.leads))} por lead` : "Nenhum lead no período"}/>
          <Indicador ordem={2} Icone={Contact} rotulo="Leads no CRM" valor={crm ? inteiro(crm.leads) : "—"}
            detalhe={crm ? (crm.leads > 0 ? `${dinheiro(dividir(m.gasto, crm.leads))} por lead${m.leads > 0 ? ` · ${inteiro(crm.leads / m.leads * 100)}% da Meta` : ""}` : "Nenhum lead no período") : "Sem acesso ao funil"}/>
          <Indicador ordem={3} Icone={TrendingUp} rotulo="Retorno" valor={crm && moedasIguais && m.gasto > 0 ? `${numero(crm.valorGanho / m.gasto)}×` : "—"}
            detalhe={crm ? `${dinheiro(crm.valorGanho, "BRL")} ganho · ${inteiro(crm.ganhas)} ${crm.ganhas === 1 ? "venda" : "vendas"}` : `Investimento em ${conta.currency}`}/>
        </div>

        <Bloco titulo="Dia a dia" descricao="Investimento (área) e leads na Meta e no CRM no mesmo dia, no fuso da conta.">
          {detalhe.erro ? <p role="alert" className="py-10 text-center text-[11px] text-red-600 dark:text-red-400">{detalhe.erro}</p>
            : carregandoDetalhe ? <p className="flex items-center justify-center gap-2 py-14 text-[11px] text-zinc-400"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true"/>Consultando a campanha…</p>
            : <SerieDiaria dias={detalhe.dados!.dias} crm={detalhe.dados!.crm} moeda={conta.currency}/>}
        </Bloco>

        <Bloco titulo="Do clique ao ganho" descricao="Quanto sobra de um degrau para o outro e quanto custa cada unidade. A Meta conta conversões pelas próprias regras; o CRM conta oportunidades criadas no período.">
          <div className="space-y-2.5">
            {passos.map((p, i) => {
              const anterior = i > 0 ? passos[i - 1].valor : 0;
              const conversao = i > 0 && anterior > 0 ? `${numero(p.valor / anterior * 100)}% do anterior` : null;
              const custo = p.custo === null ? null : `${dinheiro(p.custo)} por ${p.unidade}`;
              return <Barra key={p.rotulo} rotulo={p.rotulo} valor={inteiro(p.valor)} largura={p.valor / topo * 100}
                detalhe={[conversao, custo].filter(Boolean).join(" · ") || undefined}/>;
            })}
            {!crm && <p className="pt-1 text-[11px] text-zinc-400">Seu acesso não permite ver os resultados do funil.</p>}
          </div>
        </Bloco>

        <Bloco titulo="Onde estão as oportunidades" descricao="Etapa atual das oportunidades atribuídas a esta campanha.">
          <div className="space-y-2.5">
            {crm?.etapas.map(e => <Barra key={e.id} rotulo={`${e.funil} · ${e.nome}`} valor={inteiro(e.total)} largura={e.total / Math.max(1, crm.oportunidades) * 100}/>)}
            {!crm?.etapas.length && <p className="py-8 text-center text-[11px] text-zinc-400">{crm ? "Nenhuma oportunidade atribuída a esta campanha no período." : "Resultados do funil indisponíveis para seu acesso."}</p>}
          </div>
        </Bloco>

        <Bloco titulo="Entrega">
          <dl className="grid grid-cols-4 gap-3">
            {[["CTR", m.ctr === null ? "—" : `${numero(m.ctr)}%`], ["CPM", dinheiro(m.cpm)], ["Alcance", inteiro(m.alcance)], ["Frequência", m.frequencia === null ? "—" : numero(m.frequencia)]].map(([titulo, valor]) =>
              <div key={titulo}>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{titulo}</dt>
                <dd className="mt-0.5 truncate text-[13px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{valor}</dd>
              </div>)}
          </dl>
        </Bloco>

        <Bloco titulo={carregandoDetalhe ? "Conjuntos e anúncios" : `Conjuntos e anúncios · ${conjuntos.length}`}>
          {carregandoDetalhe && !detalhe.erro ? <p className="flex items-center justify-center gap-2 py-8 text-[11px] text-zinc-400"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true"/>Consultando conjuntos e anúncios…</p> :
          <div className="space-y-2">
            {conjuntos.map(j => <div key={j.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <Peca item={j} dinheiro={dinheiro} podeGerenciar={podeGerenciar} aoGerenciar={aoGerenciar}/>
              {anuncios.filter(a => a.adset_id === j.id).map(a => <div key={a.id} className="mt-2 border-l border-zinc-200 pl-3 dark:border-zinc-800">
                <Peca item={a} dinheiro={dinheiro} podeGerenciar={podeGerenciar} aoGerenciar={aoGerenciar} miudo/>
              </div>)}
            </div>)}
            {!conjuntos.length && <p className="py-8 text-center text-[11px] text-zinc-400">Esta campanha não tem conjuntos cadastrados.</p>}
          </div>}
        </Bloco>

        <div className="flex items-center justify-between gap-2 pb-1">
          <p className="break-all text-[10px] text-zinc-400">ID {linha.id}</p>
          <a className={botaoAds} href={`https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${conta.id.replace("act_", "")}&selected_campaign_ids=${linha.id}`} target="_blank" rel="noreferrer">
            Abrir na Meta<ArrowUpRight className="size-3.5" aria-hidden="true"/>
          </a>
        </div>
      </div>
    </aside>
  </>;
}

function Bloco({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
    <h3 className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h3>
    {descricao && <p className="mb-3 mt-1 text-[11px] leading-relaxed text-zinc-500">{descricao}</p>}
    <div className={descricao ? "" : "mt-3"}>{children}</div>
  </section>;
}

// Investimento (área, eixo da esquerda) e leads na Meta e no CRM (linhas, eixo
// da direita) por dia. Dois eixos aqui, ao contrário do LinhasPorDia: dinheiro
// e contagem não dividem escala. As cores dos leads são as do resumo da lista
// (o par azul de .viz[data-tom="blue"]), lidas do CSS na hora de desenhar.
function SerieDiaria({ dias, crm, moeda }: { dias: DiaCampanhaAds[]; crm: boolean; moeda: string }) {
  const desenhar = useCallback((canvas: HTMLCanvasElement): Desenho => {
    const corMeta = corDoCss(canvas, "var(--serie-tom-claro)"), corCrm = corDoCss(canvas, "var(--serie-tom-escuro)");
    // Moldura e tooltip pelos tokens do tema (.viz e :root), como o LinhasPorDia:
    // com as cores fixas de antes, a grade saía branca no modo escuro.
    const cor = (v: string) => corDoCss(canvas, v);
    const traco = cor("var(--viz-eixo)"), grade = cor("var(--viz-grade)"), fundo = cor("var(--background)"), tinta = cor("var(--foreground)");
    const eixo = { color: traco, font: { size: 9 } };
    const ponto = (cor: string) => ({
      borderColor: cor, cubicInterpolationMode: "monotone" as const,
      pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: cor, pointHoverBorderColor: fundo, pointHoverBorderWidth: 2,
    });
    return {
      data: {
        labels: dias.map(d => diaCurto(d.dia)),
        datasets: [
          { label: "Investido", yAxisID: "gasto", data: dias.map(d => d.gasto), ...ponto("#71717a"), borderWidth: 1, backgroundColor: degrade("#71717a", 0.3), fill: "origin", order: 1 },
          { label: "Leads na Meta", yAxisID: "leads", data: dias.map(d => d.leadsMeta), ...ponto(corMeta), borderWidth: 2, fill: false, order: 0 },
          ...(crm ? [{ label: "Leads no CRM", yAxisID: "leads", data: dias.map(d => d.leadsCrm), ...ponto(corCrm), borderWidth: 2, fill: false, order: 0 }] : []),
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, locale: "pt-BR",
        transitions: { active: { animation: { duration: 0 } } },
        layout: { padding: { top: 4, right: 4 } },
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { grid: { drawOnChartArea: false, color: traco }, border: { color: traco }, ticks: { ...eixo, maxRotation: 0, autoSkipPadding: 16 } },
          gasto: { position: "left", beginAtZero: true, grid: { color: grade, tickColor: traco }, border: { color: traco, dash: [3, 3] }, ticks: eixo,
            afterFit: e => { e.width = 52; } },
          leads: { position: "right" as const, beginAtZero: true, grid: { drawOnChartArea: false, color: traco }, border: { color: traco }, ticks: { ...eixo, precision: 0 },
            afterFit: (e: { width: number }) => { e.width = 26; } },
        },
        plugins: {
          cursor: { cor: cor("var(--viz-cursor)") },
          tooltip: {
            backgroundColor: fundo, borderColor: grade, borderWidth: 1, titleColor: tinta, bodyColor: tinta,
            titleFont: { size: 11, weight: "normal" }, bodyFont: { size: 11 }, padding: 8, boxWidth: 8, boxHeight: 8, boxPadding: 4,
            itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
            callbacks: {
              title: ([p]) => p ? dias[p.dataIndex].dia.split("-").reverse().join("/") : "",
              label: p => p.datasetIndex === 0
                ? `Investido: ${Number(p.parsed.y).toLocaleString("pt-BR", { style: "currency", currency: moeda })}`
                : `${p.dataset.label}: ${inteiro(Number(p.parsed.y))}`,
              labelColor: p => { const cor = String(p.dataset.borderColor); return { borderColor: cor, backgroundColor: cor }; },
            },
          },
        },
      },
    };
  }, [dias, crm, moeda]);
  const canvas = useGrafico(desenhar);
  // .viz e data-tom: é deles que saem as duas cores dos leads (ver acima).
  // Legenda sempre: duas linhas azuis sem nome seriam adivinhação.
  const legenda = [
    { nome: "Investido", marca: <span className="h-2 w-3 shrink-0 rounded-sm bg-zinc-400/50" aria-hidden="true"/> },
    { nome: "Leads na Meta", marca: <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: "var(--serie-tom-claro)" }} aria-hidden="true"/> },
    ...(crm ? [{ nome: "Leads no CRM", marca: <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: "var(--serie-tom-escuro)" }} aria-hidden="true"/> }] : []),
  ];
  return <div className="viz" data-tom="blue">
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {legenda.map(l => <span key={l.nome} className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{l.marca}{l.nome}</span>)}
    </div>
    <div className="relative h-44"><canvas ref={canvas} aria-hidden="true"/></div>
  </div>;
}

// Conjunto ou anúncio: mesma linha para os dois, porque a pergunta é a mesma —
// quanto consumiu e o que rendeu.
function Peca({ item, dinheiro, podeGerenciar, aoGerenciar, miudo }: {
  item: LinhaAds; dinheiro: (v: number | null) => string; podeGerenciar: boolean; aoGerenciar: (item: LinhaAds) => void; miudo?: boolean;
}) {
  return <div className="flex items-start gap-2">
    <div className="min-w-0 flex-1">
      <p className={`truncate ${miudo ? "text-[11px] text-zinc-700 dark:text-zinc-300" : "text-[12px] font-medium text-zinc-900 dark:text-zinc-50"}`}>{item.name}</p>
      <p className="mt-0.5 truncate text-[10px] text-zinc-400">
        {item.effective_status !== "ACTIVE" ? `${entregaLegivel(item.effective_status)} · ` : ""}
        {dinheiro(item.metricas.gasto)}
        {` · ${item.metricas.leads} ${item.metricas.leads === 1 ? "lead" : "leads"} na Meta`}
        {item.crm ? ` · ${item.crm.leads} no CRM · ${item.crm.oportunidades} ${item.crm.oportunidades === 1 ? "oportunidade" : "oportunidades"}` : ""}
      </p>
    </div>
    <button type="button" disabled={!podeGerenciar} onClick={() => aoGerenciar(item)} aria-label={`Gerenciar ${item.name}`}
      className="shrink-0 rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-900">
      <Settings2 className="size-3.5" aria-hidden="true"/>
    </button>
  </div>;
}

// Barra com largura mínima visível: 3 ganhas contra 4.000 cliques dariam menos
// de um pixel e sumiriam justamente onde o número importa.
function Barra({ rotulo, valor, largura, detalhe }: { rotulo: string; valor: string; largura: number; detalhe?: string }) {
  return <div>
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <span className="min-w-0 truncate text-[11px] text-zinc-600 dark:text-zinc-300">{rotulo}</span>
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-900 dark:text-zinc-50">{valor}</span>
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div className="h-full rounded-full bg-zinc-400 dark:bg-zinc-600" style={{ width: `${largura > 0 ? Math.max(largura, 1.5) : 0}%` }}/>
    </div>
    {detalhe && <p className="mt-1 text-[10px] text-zinc-400">{detalhe}</p>}
  </div>;
}
