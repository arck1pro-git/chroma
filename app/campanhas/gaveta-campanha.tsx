"use client";

// A gaveta de uma campanha do Meta Ads, no kit das gavetas do CRM
// (app/components/gaveta.tsx): véu, painel flutuante à direita, Esc para sair,
// título de grupo em caixa alta miúda e linha que acende no hover.
//
// REDESENHO DE 2026-10-23: além do que a campanha rendeu (números do topo, dia
// a dia, funil e etapas do CRM), os ANÚNCIOS com a miniatura do criativo e
// ranqueados — o melhor da campanha marcado —, os conjuntos e todas as
// métricas do Gerenciador, por grupo.
//
// Os números do topo vêm da linha da lista (o relatório da conta). O resto —
// série por dia, conjuntos e anúncios — é a carga da própria gaveta, pedida só
// quando ela abre (lib/meta-ads-relatorio.ts, carregarDetalheCampanha).
import { useCallback, useEffect } from "react";
import type { DetalheCampanhaAds, DiaCampanhaAds, LinhaAds } from "@/lib/meta-ads-tipos";
import { dividir, pecaDoAnuncio } from "@/lib/meta-ads-calculos";
import { formatarMetrica, metrica, type ContextoMetrica } from "@/lib/meta-ads-metricas";
import { preferenciaDeCriterio, primeiroQueRanqueia, ranquear } from "@/lib/meta-ads-ranking";
import {
  ArrowUpRight,
  BadgeDollarSign,
  Contact,
  Megaphone,
  Settings2,
  TrendingUp,
  Wallet,
  X,
} from "@/app/components/icones";
import { BotaoIcone, Carregando, CascaGaveta, CorpoGaveta, LINHA, Secao, Vazio } from "../components/gaveta";
import { corDoCss, degrade, useGrafico, type Desenho } from "../components/grafico-canvas";
import { useConsulta } from "./use-consulta";
import { CartaoKpi, GradeMetricas, Miniatura, Posicao, Qualidade, periodoCurto } from "./metricas-ui";
import { entregaLegivel, objetivos } from "./pecas";

const inteiro = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const numero = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const diaCurto = (v: string) => String(v).slice(5).split("-").reverse().join("/");

export default function GavetaCampanha({ linha, conta, periodo, podeGerenciar, gerenciando, aoGerenciar, aoFechar }: {
  linha: LinhaAds;
  conta: { id: string; currency: string }; periodo: { inicio: string; fim: string };
  podeGerenciar: boolean; gerenciando: boolean; aoGerenciar: (item: LinhaAds) => void; aoFechar: () => void;
}) {
  const m = linha.metricas, crm = linha.crm;
  const ctx: ContextoMetrica = { moeda: conta.currency };
  const fmt = (chave: string, l: { metricas: LinhaAds["metricas"]; crm: LinhaAds["crm"] } = linha) => {
    const d = metrica(chave); return formatarMetrica(d.valor(l, ctx), d.formato, ctx.moeda);
  };
  const detalhe = useConsulta<DetalheCampanhaAds>(`/api/meta/ads/painel?${new URLSearchParams({ serie: "1", conta: conta.id, campanha: linha.id, ...periodo })}`);
  const conjuntos = detalhe.dados?.conjuntos ?? [], anuncios = detalhe.dados?.anuncios ?? [];
  // Sem `manter`, erro deixa `dados` nulo: sem esta guarda, Anúncios e Conjuntos girariam para sempre.
  const carregando = !detalhe.erro && (detalhe.carregando || !detalhe.dados);
  const falhou = detalhe.erro ? <p role="alert" className="py-2 text-[12px] text-red-600 dark:text-red-400">{detalhe.erro}</p> : null;

  // Esc fecha a gaveta — menos quando o painel de gestão está por cima, que tem
  // o próprio Esc: sem esta saída uma tecla fecharia os dois de uma vez.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) { if (e.key === "Escape" && !gerenciando) aoFechar(); }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, gerenciando]);

  // Do clique à venda: quanto sobrou do degrau anterior e quanto custou cada unidade deste.
  const passos = [
    { rotulo: "Cliques no link", valor: m.cliquesLink, custo: m.cpcLink, unidade: "clique" },
    { rotulo: "Leads na Meta", valor: m.leads, custo: dividir(m.gasto, m.leads), unidade: "lead" },
    ...(crm ? [
      { rotulo: "Leads no CRM", valor: crm.leads, custo: dividir(m.gasto, crm.leads), unidade: "lead" },
      { rotulo: "Oportunidades", valor: crm.oportunidades, custo: dividir(m.gasto, crm.oportunidades), unidade: "oportunidade" },
      { rotulo: "Avançaram no funil", valor: crm.avancaram, custo: dividir(m.gasto, crm.avancaram), unidade: "avanço" },
      { rotulo: "Vendas", valor: crm.ganhas, custo: dividir(m.gasto, crm.ganhas), unidade: "venda" },
    ] : []),
  ];
  const topo = Math.max(...passos.map((p) => p.valor), 1);
  const dinheiro = (v: number | null) => formatarMetrica(v, "moeda", ctx.moeda);
  const orcamento = Number(linha.daily_budget) > 0 ? `${dinheiro(Number(linha.daily_budget) / 100)} por dia`
    : Number(linha.lifetime_budget) > 0 ? `${dinheiro(Number(linha.lifetime_budget) / 100)} no total` : "Orçamento no conjunto";

  // Os anúncios ranqueados pelo mesmo critério padrão do pódio da conta.
  const temCrm = Boolean(crm);
  const criterioAnuncios = primeiroQueRanqueia(anuncios, preferenciaDeCriterio(temCrm), ctx);
  const { posicoes, def: defAnuncio } = ranquear(anuncios, criterioAnuncios, ctx);
  const posicaoDe = new Map(posicoes.map((p) => [p.item.id, p.posicao]));
  const anunciosOrdenados = [...anuncios].sort((a, b) => {
    const pa = posicaoDe.get(a.id), pb = posicaoDe.get(b.id);
    if (pa && pb) return pa - pb;
    if (pa || pb) return pa ? -1 : 1;
    return b.metricas.gasto - a.metricas.gasto;
  });
  const conjuntoDe = new Map(conjuntos.map((j) => [j.id, j.name]));

  return (
    <CascaGaveta rotulo={`Campanha ${linha.name}`} aoFechar={aoFechar} largura="w-[38rem]">
      <header className="flex shrink-0 items-start gap-2 px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-start gap-1.5 text-[15px] font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
            <span className="line-clamp-2 break-words">{linha.name}</span>
            {linha.effective_status === "ACTIVE" && <span role="img" aria-label="Em veiculação" className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-400" />}
          </h2>
          <p className="mt-0.5 truncate text-[12px] text-zinc-500 dark:text-zinc-400">
            {objetivos[linha.objective ?? ""] ?? "Campanha"}
            {linha.effective_status !== "ACTIVE" && ` · ${entregaLegivel(linha.effective_status)}`}
            {` · ${orcamento} · ${periodoCurto(periodo)}`}
          </p>
        </div>
        <BotaoIcone Icone={Settings2} rotulo={podeGerenciar ? "Gerenciar na Meta" : "Sem permissão para gerenciar"} disabled={!podeGerenciar} onClick={() => aoGerenciar(linha)} />
        <a href={`https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${conta.id.replace("act_", "")}&selected_campaign_ids=${linha.id}`} target="_blank" rel="noreferrer"
          aria-label="Abrir no Gerenciador de Anúncios" title="Abrir no Gerenciador de Anúncios"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </a>
        <BotaoIcone Icone={X} rotulo="Fechar campanha" onClick={aoFechar} className="-mr-1.5" />
      </header>

      <CorpoGaveta>
        <div className="grid grid-cols-2 gap-2 px-5 pb-4">
          <CartaoKpi ordem={0} Icone={Wallet} rotulo="Investido" valor={fmt("gasto")} detalhe={`${fmt("impressoes")} impressões · CPM ${fmt("cpm")}`} />
          <CartaoKpi ordem={1} Icone={Contact} rotulo="Leads no CRM" valor={crm ? fmt("leadsCrm") : "—"} destaque
            detalhe={crm ? (crm.leads > 0 ? `${fmt("custoLeadCrm")} por lead · ${fmt("aproveitamento")} da Meta` : "Nenhum lead no período") : "Sem acesso ao funil"} />
          <CartaoKpi ordem={2} Icone={Megaphone} rotulo="Leads na Meta" valor={fmt("leads")} detalhe={m.leads > 0 ? `${fmt("custoPorLead")} por lead` : "Nenhum lead no período"} />
          {crm && conta.currency === "BRL"
            ? <CartaoKpi ordem={3} Icone={TrendingUp} rotulo="Retorno" valor={fmt("retorno")} detalhe={`${fmt("valorGanho")} ganho · ${inteiro(crm.ganhas)} ${crm.ganhas === 1 ? "venda" : "vendas"}`} />
            : <CartaoKpi ordem={3} Icone={BadgeDollarSign} rotulo="Custo por resultado" valor={fmt("custoResultado")} detalhe={`${fmt("resultados")} resultados pela Meta`} />}
        </div>

        <Secao titulo="Dia a dia">
          {falhou ?? (carregando ? <Carregando /> : <SerieDiaria dias={detalhe.dados!.dias} crm={detalhe.dados!.crm} moeda={conta.currency} />)}
        </Secao>

        <Secao titulo="Do clique à venda">
          <div className="space-y-2.5">
            {passos.map((p, i) => {
              const anterior = i > 0 ? passos[i - 1].valor : 0;
              const conversao = i > 0 && anterior > 0 ? `${numero((p.valor / anterior) * 100)}% do anterior` : null;
              const custo = p.custo === null ? null : `${dinheiro(p.custo)} por ${p.unidade}`;
              return <Barra key={p.rotulo} rotulo={p.rotulo} valor={inteiro(p.valor)} largura={(p.valor / topo) * 100} detalhe={[conversao, custo].filter(Boolean).join(" · ") || undefined} />;
            })}
            {!crm && <Vazio>Seu acesso não permite ver os resultados do funil.</Vazio>}
          </div>
        </Secao>

        {crm && (
          <Secao titulo="Onde estão as oportunidades" contagem={crm.oportunidades}>
            {crm.etapas.length ? (
              <div className="space-y-2.5">
                {crm.etapas.map((e) => <Barra key={e.id} rotulo={`${e.funil} · ${e.nome}`} valor={inteiro(e.total)} largura={(e.total / Math.max(1, crm.oportunidades)) * 100} />)}
              </div>
            ) : <Vazio>Nenhuma oportunidade atribuída a esta campanha no período.</Vazio>}
          </Secao>
        )}

        <Secao titulo="Anúncios" contagem={carregando ? undefined : anuncios.length}>
          {falhou ?? (carregando ? <Carregando /> : anuncios.length === 0 ? <Vazio>Esta campanha não tem anúncios.</Vazio> : (
            <>
              <p className="mb-1.5 text-[11.5px] text-zinc-400 dark:text-zinc-500">Ordem: {criterioAnuncios.rotulo} · mínimo {criterioAnuncios.minimo}. Abaixo do mínimo, o número fica apagado.</p>
              <ul>
                {anunciosOrdenados.map((a) => {
                  const posicao = posicaoDe.get(a.id) ?? null;
                  const valor = defAnuncio.valor(a, ctx);
                  return (
                    <li key={a.id} className={`${LINHA} cursor-default`}>
                      {posicao ? <Posicao n={posicao} /> : <span className="size-6 shrink-0" aria-hidden="true" />}
                      <Miniatura src={a.creative?.thumbnail_url ?? a.creative?.image_url} tipo={pecaDoAnuncio(a.id, a.creative).tipo} alt="" className="size-11" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-zinc-900 dark:text-zinc-50">
                          <span className="truncate" title={a.name}>{a.name}</span>
                          {posicao === 1 && <span className="shrink-0 rounded bg-zinc-900 px-1.5 py-px text-[10px] font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">Melhor</span>}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          <span className="truncate">{[a.effective_status !== "ACTIVE" ? entregaLegivel(a.effective_status) : null, dinheiro(a.metricas.gasto), `CTR ${fmt("ctrLink", a)}`, conjuntoDe.get(a.adset_id ?? "")].filter(Boolean).join(" · ")}</span>
                          <Qualidade qualidade={a.metricas.qualidade} compacto />
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-[13px] font-semibold tabular-nums ${posicao ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400 dark:text-zinc-600"}`}
                          title={posicao ? undefined : `Fora do ranking: abaixo do mínimo (${criterioAnuncios.minimo})`}>{formatarMetrica(valor, defAnuncio.formato, ctx.moeda)}</p>
                        <p className="text-[10.5px] text-zinc-400 dark:text-zinc-500">{defAnuncio.curto}</p>
                      </div>
                      <BotaoIcone Icone={Settings2} rotulo={`Gerenciar ${a.name}`} disabled={!podeGerenciar} onClick={() => aoGerenciar(a)} className="size-7" />
                    </li>
                  );
                })}
              </ul>
            </>
          ))}
        </Secao>

        <Secao titulo="Conjuntos" contagem={carregando ? undefined : conjuntos.length}>
          {falhou ?? (carregando ? <Carregando /> : conjuntos.length === 0 ? <Vazio>Esta campanha não tem conjuntos cadastrados.</Vazio> : (
            <ul>
              {conjuntos.map((j) => (
                <li key={j.id} className={`${LINHA} cursor-default`}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-zinc-900 dark:text-zinc-50">
                      <span className="truncate" title={j.name}>{j.name}</span>
                      {j.effective_status === "ACTIVE" && <span role="img" aria-label="Em veiculação" className="size-1.5 shrink-0 rounded-full bg-emerald-400" />}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {[j.effective_status !== "ACTIVE" ? entregaLegivel(j.effective_status) : null, dinheiro(j.metricas.gasto),
                        `${inteiro(j.metricas.leads)} ${j.metricas.leads === 1 ? "lead" : "leads"} na Meta`,
                        j.crm ? `${inteiro(j.crm.leads)} no CRM` : null, `alcance ${fmt("alcance", j)}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{j.crm ? fmt("custoLeadCrm", j) : fmt("custoPorLead", j)}</p>
                    <p className="text-[10.5px] text-zinc-400 dark:text-zinc-500">{j.crm ? "CPL CRM" : "CPL Meta"}</p>
                  </div>
                  <BotaoIcone Icone={Settings2} rotulo={`Gerenciar ${j.name}`} disabled={!podeGerenciar} onClick={() => aoGerenciar(j)} className="size-7" />
                </li>
              ))}
            </ul>
          ))}
        </Secao>

        <Secao titulo="Todas as métricas">
          <GradeMetricas linha={linha} ctx={ctx} colunas="grid-cols-2 sm:grid-cols-3" />
        </Secao>

        <p className="break-all px-5 pt-2 text-[10.5px] text-zinc-400 dark:text-zinc-500">ID {linha.id}</p>
      </CorpoGaveta>
    </CascaGaveta>
  );
}

// Investimento (área, eixo da esquerda) e leads na Meta e no CRM (linhas, eixo
// da direita) por dia. Dois eixos aqui, ao contrário do LinhasPorDia: dinheiro
// e contagem não dividem escala. As cores dos leads são as do resumo da conta
// (o par azul de .viz[data-tom="blue"]), lidas do CSS na hora de desenhar.
function SerieDiaria({ dias, crm, moeda }: { dias: DiaCampanhaAds[]; crm: boolean; moeda: string }) {
  const desenhar = useCallback((canvas: HTMLCanvasElement): Desenho => {
    const corMeta = corDoCss(canvas, "var(--serie-tom-claro)"), corCrm = corDoCss(canvas, "var(--serie-tom-escuro)");
    // Moldura e tooltip pelos tokens do tema (.viz e :root), como o LinhasPorDia.
    const cor = (v: string) => corDoCss(canvas, v);
    const traco = cor("var(--viz-eixo)"), grade = cor("var(--viz-grade)"), fundo = cor("var(--background)"), tinta = cor("var(--foreground)");
    const eixo = { color: traco, font: { size: 9 } };
    const ponto = (c: string) => ({
      borderColor: c, cubicInterpolationMode: "monotone" as const,
      pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: c, pointHoverBorderColor: fundo, pointHoverBorderWidth: 2,
    });
    return {
      data: {
        labels: dias.map((d) => diaCurto(d.dia)),
        datasets: [
          { label: "Investido", yAxisID: "gasto", data: dias.map((d) => d.gasto), ...ponto("#71717a"), borderWidth: 1, backgroundColor: degrade("#71717a", 0.3), fill: "origin", order: 1 },
          { label: "Leads na Meta", yAxisID: "leads", data: dias.map((d) => d.leadsMeta), ...ponto(corMeta), borderWidth: 2, fill: false, order: 0 },
          ...(crm ? [{ label: "Leads no CRM", yAxisID: "leads", data: dias.map((d) => d.leadsCrm), ...ponto(corCrm), borderWidth: 2, fill: false, order: 0 }] : []),
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
            afterFit: (e) => { e.width = 52; } },
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
              title: ([p]) => (p ? dias[p.dataIndex].dia.split("-").reverse().join("/") : ""),
              label: (p) => (p.datasetIndex === 0
                ? `Investido: ${Number(p.parsed.y).toLocaleString("pt-BR", { style: "currency", currency: moeda })}`
                : `${p.dataset.label}: ${inteiro(Number(p.parsed.y))}`),
              labelColor: (p) => { const c = String(p.dataset.borderColor); return { borderColor: c, backgroundColor: c }; },
            },
          },
        },
      },
    };
  }, [dias, crm, moeda]);
  const canvas = useGrafico(desenhar);
  // Legenda sempre: duas linhas azuis sem nome seriam adivinhação.
  const legenda = [
    { nome: "Investido", marca: <span className="h-2 w-3 shrink-0 rounded-sm bg-zinc-400/50" aria-hidden="true" /> },
    { nome: "Leads na Meta", marca: <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: "var(--serie-tom-claro)" }} aria-hidden="true" /> },
    ...(crm ? [{ nome: "Leads no CRM", marca: <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: "var(--serie-tom-escuro)" }} aria-hidden="true" /> }] : []),
  ];
  return (
    <div className="viz" data-tom="blue">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {legenda.map((l) => <span key={l.nome} className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{l.marca}{l.nome}</span>)}
      </div>
      <div className="relative h-44"><canvas ref={canvas} aria-hidden="true" /></div>
    </div>
  );
}

// Barra com largura mínima visível: 3 vendas contra 4.000 cliques dariam menos
// de um pixel e sumiriam justamente onde o número importa.
function Barra({ rotulo, valor, largura, detalhe }: { rotulo: string; valor: string; largura: number; detalhe?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] text-zinc-600 dark:text-zinc-300">{rotulo}</span>
        <span className="shrink-0 text-[12px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{valor}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-zinc-400 dark:bg-zinc-600" style={{ width: `${largura > 0 ? Math.max(largura, 1.5) : 0}%` }} />
      </div>
      {detalhe && <p className="mt-1 text-[10.5px] text-zinc-400 dark:text-zinc-500">{detalhe}</p>}
    </div>
  );
}