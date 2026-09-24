"use client";

import { useEffect } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, LoaderCircle, Settings2, Target, TrendingUp, Trophy, Wallet, X } from "lucide-react";
import type { LinhaAds, SerieCampanhaAds } from "@/lib/meta-ads-tipos";
import { dividir } from "@/lib/meta-ads-calculos";
import Indicador from "../components/indicador";
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
// Tudo que veio no relatório da conta é lido das props; a série diária é a única
// consulta nova, e só sai quando a gaveta abre.

const numero = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const inteiro = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const diaCurto = (v: string) => String(v).slice(5).split("-").reverse().join("/");

export default function GavetaCampanha({ linha, conjuntos, anuncios, conta, periodo, podeGerenciar, gerenciando, aoGerenciar, aoFechar }: {
  linha: LinhaAds; conjuntos: LinhaAds[]; anuncios: LinhaAds[];
  conta: { id: string; currency: string }; periodo: { inicio: string; fim: string };
  podeGerenciar: boolean; gerenciando: boolean; aoGerenciar: (item: LinhaAds) => void; aoFechar: () => void;
}) {
  const m = linha.metricas, crm = linha.crm;
  const moedasIguais = conta.currency === "BRL";
  const dinheiro = (v: number | null, moeda = conta.currency) => v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: moeda });
  const serie = useConsulta<SerieCampanhaAds>(`/api/meta/ads/painel?${new URLSearchParams({ serie: "1", conta: conta.id, campanha: linha.id, ...periodo })}`);

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
          <Indicador ordem={1} Icone={Target} rotulo="Oportunidades" valor={crm ? inteiro(crm.oportunidades) : "—"} detalhe={crm ? `${inteiro(crm.leads)} leads · ${inteiro(crm.abertas)} em aberto` : "Sem acesso ao funil"}/>
          <Indicador ordem={2} Icone={Trophy} rotulo="Valor ganho" valor={crm ? dinheiro(crm.valorGanho, "BRL") : "—"} detalhe={crm ? `${inteiro(crm.ganhas)} ganhas · ${inteiro(crm.perdidas)} perdidas` : "Sem acesso ao funil"}/>
          <Indicador ordem={3} Icone={TrendingUp} rotulo="Retorno" valor={crm && moedasIguais && m.gasto > 0 ? `${numero(crm.valorGanho / m.gasto)}×` : "—"}
            detalhe={crm ? `${dinheiro(crm.valorAberto, "BRL")} ainda em aberto` : `Investimento em ${conta.currency}`}/>
        </div>

        <Bloco titulo="Dia a dia" descricao="Investimento da campanha e oportunidades criadas no mesmo dia, no fuso da conta.">
          {serie.erro ? <p role="alert" className="py-10 text-center text-[11px] text-red-600 dark:text-red-400">{serie.erro}</p>
            : serie.carregando || !serie.dados ? <p className="flex items-center justify-center gap-2 py-14 text-[11px] text-zinc-400"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true"/>Consultando a série da campanha…</p>
            : <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={serie.dados.dias} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <defs><linearGradient id={`gasto-${linha.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#71717a" stopOpacity={0.3}/><stop offset="100%" stopColor="#71717a" stopOpacity={0}/></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7"/>
                    <XAxis dataKey="dia" tickFormatter={diaCurto} tick={{ fontSize: 9 }} minTickGap={16}/>
                    <YAxis yAxisId="gasto" width={52} tick={{ fontSize: 9 }}/>
                    <YAxis yAxisId="crm" orientation="right" width={26} allowDecimals={false} tick={{ fontSize: 9 }}/>
                    <Tooltip labelFormatter={v => String(v).split("-").reverse().join("/")}
                      formatter={(v, nome) => [nome === "gasto" ? dinheiro(Number(v)) : inteiro(Number(v)), nome === "gasto" ? "Investido" : "Oportunidades"]}/>
                    <Area yAxisId="gasto" type="monotone" dataKey="gasto" stroke="#71717a" fill={`url(#gasto-${linha.id})`}/>
                    {serie.dados.crm && <Line yAxisId="crm" type="monotone" dataKey="oportunidades" stroke="#10b981" strokeWidth={2} dot={false}/>}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>}
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

        <Bloco titulo={`Conjuntos e anúncios · ${conjuntos.length}`}>
          <div className="space-y-2">
            {conjuntos.map(j => <div key={j.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <Peca item={j} dinheiro={dinheiro} podeGerenciar={podeGerenciar} aoGerenciar={aoGerenciar}/>
              {anuncios.filter(a => a.adset_id === j.id).map(a => <div key={a.id} className="mt-2 border-l border-zinc-200 pl-3 dark:border-zinc-800">
                <Peca item={a} dinheiro={dinheiro} podeGerenciar={podeGerenciar} aoGerenciar={aoGerenciar} miudo/>
              </div>)}
            </div>)}
            {!conjuntos.length && <p className="py-8 text-center text-[11px] text-zinc-400">Esta campanha não tem conjuntos cadastrados.</p>}
          </div>
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
        {item.crm ? ` · ${item.crm.oportunidades} oportunidades · ${item.crm.ganhas} ganhas` : ""}
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
