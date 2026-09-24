"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, ChevronRight, LoaderCircle, Megaphone, Plus, RefreshCw } from "lucide-react";
import type { LinhaAds, RecursosAds, RelatorioAds } from "@/lib/meta-ads-tipos";
import { dividir } from "@/lib/meta-ads-calculos";
import { CampoBusca, Seta, campo } from "../components/filtros-ui";
import { useConsulta } from "./use-consulta";
import GavetaCampanha from "./gaveta-campanha";
import GestaoAds from "./gestao-ads";
import { Aviso, Vazio, abaAds, abaAtivaAds, abaInativaAds, botaoAds, botaoPrincipalAds, entregaLegivel, objetivos, rotuloColuna } from "./pecas";

// Meta Ads em duas faixas e uma lista, no mesmo desenho das outras telas: faixa
// de identidade com a ação principal, faixa de filtros e o corpo rolando embaixo.
//
// A lista responde a UMA pergunta — em qual campanha vale mexer. Todo o detalhe
// (conjuntos, anúncios, evolução, funil) está a um clique, na gaveta da direita,
// e não repetido aqui.

type Conta = { id: string; name: string; currency: string; timezone_name?: string };
const numero = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const inteiro = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const faixa = "shrink-0 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800";

function dataHoje(fuso: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function diasAntes(dia: string, dias: number) { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - dias); return d.toISOString().slice(0, 10); }

export default function PainelAds({ contas }: { contas: Conta[] }) {
  const [contaId, setConta] = useState(contas[0]?.id ?? "");
  const conta = contas.find(c => c.id === contaId);
  if (!conta) return <div className="p-6"><Aviso texto="Nenhuma conta de anúncios atribuída a esta integração."/></div>;
  return <ConteudoAds key={conta.id} conta={conta} contas={contas} aoTrocarConta={setConta}/>;
}

function ConteudoAds({ conta, contas, aoTrocarConta }: { conta: Conta; contas: Conta[]; aoTrocarConta: (id: string) => void }) {
  const hoje = dataHoje(conta.timezone_name || "America/Sao_Paulo");
  const padrao = { inicio: diasAntes(hoje, 29), fim: hoje };
  const [janela, setJanela] = useState("30");
  const [inicio, setInicio] = useState(padrao.inicio), [fim, setFim] = useState(padrao.fim);
  const [periodo, setPeriodo] = useState(padrao);
  const [aba, setAba] = useState<"resultado" | "recursos">("resultado");
  const [campanha, setCampanha] = useState("");
  const [busca, setBusca] = useState(""), [editar, setEditar] = useState<LinhaAds | null | undefined>(undefined);
  const [retorno, setRetorno] = useState("");
  const consulta = useConsulta<RelatorioAds>(`/api/meta/ads/painel?${new URLSearchParams({ conta: conta.id, ...periodo })}`);
  const r = consulta.dados;
  // Conjuntos e anúncios não têm lista própria: aparecem dentro da gaveta da
  // campanha a que pertencem, que é onde a comparação faz sentido.
  const selecionada = r?.campanhas.find(c => c.id === campanha) ?? null;
  const moedasIguais = conta.currency === "BRL";
  const dinheiro = (v: number | null, moeda = conta.currency) => v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: moeda });
  const linhas = useMemo(() => (r?.campanhas ?? [])
    .filter(l => l.name.toLocaleLowerCase().includes(busca.toLocaleLowerCase()))
    .sort((a, b) => b.metricas.gasto - a.metricas.gasto), [r, busca]);
  const maiorGasto = Math.max(...linhas.map(l => l.metricas.gasto), 1);

  // Os períodos prontos aplicam sozinhos: pedir um clique a mais em "Últimos 30
  // dias" seria cerimônia. Só "Datas específicas" mantém o botão, porque ali as
  // duas pontas mudam e consultar no meio da digitação buscaria período torto.
  function escolherJanela(valor: string) {
    setJanela(valor);
    if (valor === "livre") return;
    const novo = { inicio: diasAntes(hoje, Number(valor) - 1), fim: hoje };
    setInicio(novo.inicio); setFim(novo.fim); setPeriodo(novo);
  }

  function exportar() {
    const escapar = (v: unknown) => { const texto = String(v ?? ""); return `"${(/^[=+@\-\t\r]/.test(texto) ? "'" : "") + texto.replaceAll('"', '""')}"`; };
    const cabecalho = ["ID", "Nome", "Entrega", "Moeda gasto", "Gasto", "Cliques", "Leads Meta", "Leads no funil", "Oportunidades", "Avançadas", "Ganhas", "Valor ganho BRL", "Custo por ganho", "Retorno CRM", "Início", "Fim"];
    const dados = linhas.map(l => [l.id, l.name, entregaLegivel(l.effective_status), conta.currency, l.metricas.gasto, l.metricas.cliques, l.metricas.leads, l.crm?.leads, l.crm?.oportunidades, l.crm?.avancaram, l.crm?.ganhas, l.crm?.valorGanho, l.crm && moedasIguais ? dividir(l.metricas.gasto, l.crm.ganhas) : null, l.crm && moedasIguais ? dividir(l.crm.valorGanho, l.metricas.gasto) : null, periodo.inicio, periodo.fim]);
    const url = URL.createObjectURL(new Blob(["﻿" + [cabecalho, ...dados].map(l => l.map(escapar).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `meta-ads-campanhas-${periodo.inicio}-${periodo.fim}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return <div className="flex h-full flex-col overflow-hidden">
    <div className={faixa}>
      <div className="flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Meta Ads</h1>
          {/* uma conta só não é escolha: vira ruído ao lado do título */}
          {contas.length > 1 && <div className="relative">
            <select aria-label="Conta de anúncios" value={conta.id} onChange={e => aoTrocarConta(e.target.value)} className={campo}>
              {contas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select><Seta/>
          </div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className={botaoAds} href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${conta.id.replace("act_", "")}`} target="_blank" rel="noreferrer">Gerenciador Meta<ArrowUpRight className="size-3.5" aria-hidden="true"/></a>
          <button className={botaoPrincipalAds} disabled={!r?.permissoes.includes("ads_management")} onClick={() => setEditar(null)}><Plus className="size-4" aria-hidden="true"/>Nova campanha</button>
        </div>
      </div>
      <nav className="mt-3 flex gap-1" aria-label="Seções do Meta Ads">
        {([["resultado", "Investimento e funil"], ["recursos", "Públicos e integrações"]] as const).map(([id, titulo]) =>
          <button key={id} type="button" onClick={() => setAba(id)} aria-current={aba === id ? "page" : undefined} className={`${abaAds} ${aba === id ? abaAtivaAds : abaInativaAds}`}>{titulo}</button>)}
      </nav>
    </div>

    {aba === "resultado" && <div className={`${faixa} flex flex-wrap items-center gap-2`}>
      <div className="relative">
        <select aria-label="Período" value={janela} onChange={e => escolherJanela(e.target.value)} className={campo}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="livre">Datas específicas</option>
        </select><Seta/>
      </div>
      {janela === "livre" && <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); setPeriodo({ inicio, fim }); }}>
        <input aria-label="Data inicial" type="date" required value={inicio} max={fim} onChange={e => setInicio(e.target.value)} className={campo}/>
        <input aria-label="Data final" type="date" required min={inicio} max={hoje} value={fim} onChange={e => setFim(e.target.value)} className={campo}/>
        <button className={botaoAds}>Aplicar</button>
      </form>}
      <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar campanha"/>
      {r && <span className="text-[11px] text-zinc-500">{linhas.length} {linhas.length === 1 ? "campanha" : "campanhas"}</span>}
      <button className={botaoAds} disabled={consulta.carregando} onClick={() => void consulta.atualizar()}><RefreshCw className={`size-3.5 ${consulta.carregando ? "animate-spin" : ""}`} aria-hidden="true"/>Atualizar</button>
      <button className={botaoAds} disabled={!linhas.length} onClick={exportar}><ArrowDownToLine className="size-3.5" aria-hidden="true"/>CSV</button>
    </div>}

    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="max-w-[1600px] space-y-3">
        {retorno && <p role="status" className="text-[12px] text-emerald-700 dark:text-emerald-400">{retorno}</p>}
        {aba === "recursos" ? <Recursos conta={conta.id}/> : <>
          {consulta.erro && <Aviso erro texto={consulta.erro}/>}
          {consulta.carregando ? <Vazio Icone={LoaderCircle} girando texto="Consultando investimento e resultados do funil…"/> : r && <>
            {r.avisos.map(a => <Aviso key={a} texto={a}/>)}
            {linhas.length ? <section className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              {/* os rótulos das colunas aparecem UMA vez; a linha só traz números */}
              <div className="hidden items-center gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-2 sm:flex dark:border-zinc-800 dark:bg-zinc-900/50">
                <span className={`min-w-0 flex-1 ${rotuloColuna}`}>Campanha</span>
                <span className={`w-28 text-right ${rotuloColuna}`}>Investido</span>
                <span className={`hidden w-28 text-right lg:block ${rotuloColuna}`}>Oportunidades</span>
                <span className={`hidden w-28 text-right lg:block ${rotuloColuna}`}>Valor ganho</span>
                <span className={`w-20 text-right ${rotuloColuna}`}>Retorno</span>
                <span className="w-4 shrink-0" aria-hidden="true"/>
              </div>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">{linhas.map(l => <li key={l.id}>
                <button type="button" onClick={() => setCampanha(l.id)} aria-label={`Abrir ${l.name}`}
                  className={`flex w-full items-center gap-4 px-4 py-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${l.id === campanha ? "bg-zinc-50 dark:bg-zinc-900/50" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                      <span className="truncate">{l.name}</span>
                      {l.effective_status === "ACTIVE" && <span role="img" aria-label="Em veiculação" className="size-1.5 shrink-0 rounded-full bg-emerald-400"/>}
                    </p>
                    {/* o ponto verde já diz "ativa"; a palavra só entra quando é outra coisa */}
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {objetivos[l.objective ?? ""] ?? "Campanha"}
                      {l.effective_status !== "ACTIVE" && ` · ${entregaLegivel(l.effective_status)}`}
                      {` · ${inteiro(l.metricas.cliques)} cliques`}
                    </p>
                    {/* participação no investimento: o olho compara as barras antes de ler os números */}
                    <div className="mt-1.5 h-1 w-full max-w-64 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div className="h-full rounded-full bg-zinc-400 dark:bg-zinc-600" style={{ width: `${l.metricas.gasto / maiorGasto * 100}%` }}/>
                    </div>
                  </div>
                  <Valor>{dinheiro(l.metricas.gasto)}</Valor>
                  <Valor recolhivel detalhe={l.crm ? `${inteiro(l.crm.ganhas)} ganhas` : undefined}>{l.crm ? inteiro(l.crm.oportunidades) : "—"}</Valor>
                  <Valor recolhivel>{l.crm ? dinheiro(l.crm.valorGanho, "BRL") : "—"}</Valor>
                  <Valor estreita>{l.crm && moedasIguais && l.metricas.gasto > 0 ? `${numero(l.crm.valorGanho / l.metricas.gasto)}×` : "—"}</Valor>
                  <ChevronRight className="size-4 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true"/>
                </button>
              </li>)}</ul>
            </section> : <Vazio Icone={Megaphone} texto={busca ? "Nenhuma campanha com esse nome." : "Nenhuma campanha veiculou neste período."}/>}

            {r.atribuicao && <details className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <summary className="cursor-pointer text-[12px] text-zinc-600 dark:text-zinc-300">
                Atribuição · {r.atribuicao.atribuidas} de {r.atribuicao.total} oportunidades ligadas a uma campanha desta conta
              </summary>
              <div className="mt-3 grid gap-x-4 gap-y-1 text-[11px] text-zinc-500 sm:grid-cols-3">
                <p>Sem origem: {r.atribuicao.semOrigem}</p>
                <p>Sem correspondência: {r.atribuicao.semCorrespondencia}</p>
                <p>Origem ambígua: {r.atribuicao.ambiguas}</p>
                <p>Ligadas sem conjunto: {r.atribuicao.semConjunto}</p>
                <p>Ligadas sem anúncio: {r.atribuicao.semAnuncio}</p>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                IDs têm prioridade sobre nomes e UTMs, e nome repetido em duas campanhas não recebe atribuição. A Meta conta conversões pelas próprias regras, então os dois lados não batem número a número. O relatório olha as oportunidades criadas no período: não reconstrói a trajetória histórica nem soma vendas de coortes anteriores.
              </p>
            </details>}
          </>}
        </>}
      </div>
    </div>

    {selecionada && r && <GavetaCampanha key={selecionada.id} linha={selecionada}
      conjuntos={r.conjuntos.filter(j => j.campaign_id === selecionada.id)}
      anuncios={r.anuncios.filter(a => a.campaign_id === selecionada.id)}
      conta={conta} periodo={periodo}
      podeGerenciar={r.permissoes.includes("ads_management")} gerenciando={editar !== undefined}
      aoGerenciar={setEditar} aoFechar={() => setCampanha("")}/>}
    {editar !== undefined && <GestaoAds key={editar?.id ?? "nova"} conta={conta.id} moeda={conta.currency} item={editar}
      aoFechar={() => setEditar(undefined)}
      aoSalvar={() => { setEditar(undefined); setRetorno("Alteração enviada à Meta. Os dados estão sendo atualizados."); void consulta.atualizar(); }}/>}
  </div>;
}

// Número da lista. `recolhivel` some antes de `estreita` nas telas menores:
// sobram nome, investimento e retorno, o mínimo para escolher o que abrir.
function Valor({ children, detalhe, recolhivel, estreita }: { children: React.ReactNode; detalhe?: string; recolhivel?: boolean; estreita?: boolean }) {
  return <div className={`shrink-0 text-right ${estreita ? "w-20" : "w-28"} ${recolhivel ? "hidden lg:block" : ""}`}>
    <p className="truncate text-[13px] font-medium tabular-nums text-zinc-900 dark:text-zinc-50">{children}</p>
    {detalhe && <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{detalhe}</p>}
  </div>;
}

function Recursos({ conta }: { conta: string }) {
  const { dados, erro, carregando, atualizar } = useConsulta<RecursosAds>(`/api/meta/ads/painel?recursos=1&conta=${conta}`);
  return <>
    <div className="flex items-center justify-between gap-3">
      <p className="text-[12px] text-zinc-500">Ativos que esta integração enxerga na conta.</p>
      <button className={botaoAds} onClick={() => void atualizar()}><RefreshCw className={`size-3.5 ${carregando ? "animate-spin" : ""}`} aria-hidden="true"/>Atualizar</button>
    </div>
    {erro && <Aviso erro texto={erro}/>}
    {carregando ? <Vazio Icone={LoaderCircle} girando texto="Consultando ativos da Meta…"/> : dados && <>
      <div className="grid gap-3 md:grid-cols-2">
        {([["Públicos", dados.publicos], ["Pixels e conjuntos de dados", dados.pixels], ["Páginas", dados.paginas], ["Formulários de leads", dados.formularios]] as const).map(([titulo, itens]) =>
          <section key={titulo} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo} <span className="ml-1 font-normal text-zinc-400">{itens.length}</span></h2>
            <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">{itens.map(i =>
              <li key={i.id} className="text-[12px] text-zinc-700 dark:text-zinc-300">{i.name || i.id}
                <p className="text-[11px] text-zinc-400">{i.id}{i.status ? ` · ${entregaLegivel(i.status)}` : ""}{i.subtype ? ` · ${i.subtype}` : ""}</p>
              </li>)}</ul>
            {!itens.length && <p className="mt-2 text-[12px] text-zinc-400">Nenhum ativo retornado.</p>}
          </section>)}
      </div>
      {dados.avisos.map(a => <Aviso key={a} texto={a}/>)}
      <p className="text-[11px] leading-relaxed text-zinc-500">
        O inventário confirma o acesso. Enviar eventos pela Conversions API, sincronizar públicos e importar formulários ainda exige escolher o ativo de destino e mapear os campos do CRM.
      </p>
    </>}
  </>;
}
