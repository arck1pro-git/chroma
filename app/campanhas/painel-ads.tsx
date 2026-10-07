"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpRight, ChevronRight, Contact, Megaphone, Plus, RefreshCw,
  type LucideIcon,
} from "lucide-react";
import type { LeadsCrm, LinhaAds, RecursosAds, RelatorioAds } from "@/lib/meta-ads-tipos";
import { dividir } from "@/lib/meta-ads-calculos";
import { CampoBusca, Seta, campo } from "../components/filtros-ui";
import { LinhasPorDia, type SerieLinha } from "../components/grafico-linhas";
import { useConsulta } from "./use-consulta";
import GavetaCampanha from "./gaveta-campanha";
import GestaoAds from "./gestao-ads";
import { Aviso, Vazio, abaAds, abaAtivaAds, abaInativaAds, botaoAds, botaoPrincipalAds, entregaLegivel, objetivos, rotuloColuna } from "./pecas";

// Meta Ads: o que a Meta contou e o que chegou ao CRM, lado a lado.
//
// A PERGUNTA DA TELA (pedido dele de 2026-10-07): quantos leads cada campanha
// gerou na Meta e quantos chegaram ao CRM. Por isso, de cima para baixo:
//   · o resumo do período — investido, leads na Meta, leads no CRM e
//     oportunidades — com o gráfico dos leads por dia, Meta × CRM;
//   · as campanhas com as mesmas colunas, ordenáveis por qualquer uma;
//   · o detalhe (conjuntos, anúncios, série, funil) a um clique, na gaveta.
//
// RÁPIDA POR CONSTRUÇÃO: o relatório pede três leituras à Meta e o servidor as
// guarda por alguns minutos (lib/meta.ts, `lembrar`); trocar o período mantém
// os números anteriores na tela até os novos chegarem; o botão Atualizar é o
// único que força uma ida à Meta.

type Conta = { id: string; name: string; currency: string; timezone_name?: string };
type Coluna = "gasto" | "leadsMeta" | "leadsCrm" | "custo" | "oportunidades";

const inteiro = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const porcento = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
const diaCurto = (v: string) => v.slice(5).split("-").reverse().join("/");
const horaFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const faixa = "shrink-0 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800";

function dataHoje(fuso: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function diasAntes(dia: string, dias: number) { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - dias); return d.toISOString().slice(0, 10); }

// As duas cores do par Meta × CRM, as mesmas no gráfico e nos números do
// resumo: a ponta clara do azul é onde o lead nasce (a Meta), a escura é onde
// ele fica (o CRM). Validadas para daltonismo em globals.css (.viz[data-tom]).
const TOM = "blue";
const COR_META = "var(--serie-tom-claro)";
const COR_CRM = "var(--serie-tom-escuro)";

type Dia = RelatorioAds["diario"][number];

// O que cada coluna ordena. Custo por lead é o único que começa do menor:
// quem ordena por custo quer o lead mais barato no topo.
const COLUNAS: Array<{ chave: Coluna; rotulo: string; largura: string; doMenor?: boolean }> = [
  { chave: "gasto", rotulo: "Investido", largura: "w-24" },
  { chave: "leadsMeta", rotulo: "Leads Meta", largura: "w-20" },
  { chave: "leadsCrm", rotulo: "Leads CRM", largura: "w-20" },
  { chave: "custo", rotulo: "Custo/lead", largura: "hidden w-24 lg:block", doMenor: true },
  { chave: "oportunidades", rotulo: "Oportunidades", largura: "hidden w-24 xl:block" },
];

/** O custo por lead da linha: o do CRM quando há acesso ao funil, senão o da Meta. */
function custoPorLead(l: { metricas: { gasto: number; leads: number }; crm: { leads: number } | null }) {
  return l.crm ? dividir(l.metricas.gasto, l.crm.leads) : dividir(l.metricas.gasto, l.metricas.leads);
}

function valorDaColuna(l: LinhaAds, coluna: Coluna): number | null {
  switch (coluna) {
    case "gasto": return l.metricas.gasto;
    case "leadsMeta": return l.metricas.leads;
    case "leadsCrm": return l.crm?.leads ?? null;
    case "custo": return custoPorLead(l);
    case "oportunidades": return l.crm?.oportunidades ?? null;
  }
}

/** Gastou, gerou lead ou trouxe gente ao CRM no período. As outras ficam atrás de um clique. */
function teveResultado(l: LinhaAds) {
  return l.metricas.gasto > 0 || l.metricas.leads > 0 || (l.crm?.leads ?? 0) > 0 || (l.crm?.oportunidades ?? 0) > 0;
}

export default function PainelAds({ contas, erro }: { contas: Conta[]; erro?: string | null }) {
  const [contaId, setConta] = useState(contas[0]?.id ?? "");
  const conta = contas.find(c => c.id === contaId);
  if (erro) return <div className="p-6"><Aviso erro texto={erro}/></div>;
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
  const [ordem, setOrdem] = useState<{ coluna: Coluna; desc: boolean }>({ coluna: "gasto", desc: true });
  const [verTodas, setVerTodas] = useState(false);
  // Cada clique em Atualizar é uma URL nova com `atualizar=1` — é ela que faz o
  // servidor ignorar o guardado. Trocar o período volta ao normal.
  const [forcadas, setForcadas] = useState(0);

  const url = `/api/meta/ads/painel?${new URLSearchParams({ conta: conta.id, ...periodo, ...(forcadas ? { atualizar: "1", n: String(forcadas) } : {}) })}`;
  const consulta = useConsulta<RelatorioAds>(url, { manter: true });
  const r = consulta.dados;
  const selecionada = r?.campanhas.find(c => c.id === campanha) ?? null;
  const moedasIguais = conta.currency === "BRL";
  const dinheiro = (v: number | null, moeda = conta.currency) => v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: moeda });

  const { linhas, ocultas } = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase();
    const todas = (r?.campanhas ?? []).filter(l => l.name.toLocaleLowerCase().includes(termo));
    // Buscando, aparece o que casar — inclusive a campanha parada.
    const visiveis = verTodas || termo ? todas : todas.filter(teveResultado);
    const sentido = ordem.desc ? -1 : 1;
    const ordenadas = [...visiveis].sort((a, b) => {
      const x = valorDaColuna(a, ordem.coluna), y = valorDaColuna(b, ordem.coluna);
      // Sem valor (custo sem lead, CRM sem acesso) vai para o fim nos dois sentidos.
      if (x === null || y === null) return x === y ? b.metricas.gasto - a.metricas.gasto : x === null ? 1 : -1;
      return x === y ? b.metricas.gasto - a.metricas.gasto : (x - y) * sentido;
    });
    return { linhas: ordenadas, ocultas: todas.length - visiveis.length };
  }, [r, busca, ordem, verTodas]);
  const maiorGasto = Math.max(...linhas.map(l => l.metricas.gasto), 1);

  function ordenarPor(coluna: Coluna, doMenor = false) {
    setOrdem(atual => atual.coluna === coluna ? { coluna, desc: !atual.desc } : { coluna, desc: !doMenor });
  }

  // Os períodos prontos aplicam sozinhos: pedir um clique a mais em "Últimos 30
  // dias" seria cerimônia. Só "Datas específicas" mantém o botão, porque ali as
  // duas pontas mudam e consultar no meio da digitação buscaria período torto.
  function escolherJanela(valor: string) {
    setJanela(valor);
    if (valor === "livre") return;
    const novo = { inicio: diasAntes(hoje, Number(valor) - 1), fim: hoje };
    setInicio(novo.inicio); setFim(novo.fim); setPeriodo(novo); setForcadas(0);
  }

  function exportar() {
    const escapar = (v: unknown) => { const texto = String(v ?? ""); return `"${(/^[=+@\-\t\r]/.test(texto) ? "'" : "") + texto.replaceAll('"', '""')}"`; };
    const cabecalho = ["ID", "Nome", "Entrega", "Moeda gasto", "Gasto", "Cliques", "Leads Meta", "Custo por lead Meta", "Leads CRM", "Custo por lead CRM", "Oportunidades", "Avançadas", "Ganhas", "Valor ganho BRL", "Retorno CRM", "Início", "Fim"];
    const dados = linhas.map(l => [l.id, l.name, entregaLegivel(l.effective_status), conta.currency, l.metricas.gasto, l.metricas.cliques, l.metricas.leads, dividir(l.metricas.gasto, l.metricas.leads),
      l.crm?.leads, l.crm && moedasIguais ? dividir(l.metricas.gasto, l.crm.leads) : null, l.crm?.oportunidades, l.crm?.avancaram, l.crm?.ganhas, l.crm?.valorGanho,
      l.crm && moedasIguais ? dividir(l.crm.valorGanho, l.metricas.gasto) : null, periodo.inicio, periodo.fim]);
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
        {([["resultado", "Leads e investimento"], ["recursos", "Públicos e integrações"]] as const).map(([id, titulo]) =>
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
      {janela === "livre" && <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); setPeriodo({ inicio, fim }); setForcadas(0); }}>
        <input aria-label="Data inicial" type="date" required value={inicio} max={fim} onChange={e => setInicio(e.target.value)} className={campo}/>
        <input aria-label="Data final" type="date" required min={inicio} max={hoje} value={fim} onChange={e => setFim(e.target.value)} className={campo}/>
        <button className={botaoAds}>Aplicar</button>
      </form>}
      <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar campanha"/>
      {/* A hora em que os números saíram da Meta: eles ficam guardados alguns
          minutos, e quem quer o de agora sabe que existe o botão ao lado. */}
      {r && <span className="text-[11px] text-zinc-500 dark:text-zinc-400" title="Os números da Meta ficam guardados por alguns minutos. Atualizar busca de novo.">
        Meta às {horaFmt.format(new Date(r.atualizadoEm))}
      </span>}
      <button className={botaoAds} disabled={consulta.carregando} onClick={() => setForcadas(n => n + 1)}><RefreshCw className={`size-3.5 ${consulta.carregando ? "animate-spin" : ""}`} aria-hidden="true"/>Atualizar</button>
      <button className={botaoAds} disabled={!linhas.length} onClick={exportar}><ArrowDownToLine className="size-3.5" aria-hidden="true"/>CSV</button>
    </div>}

    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="max-w-[1600px] space-y-3">
        {retorno && <p role="status" className="text-[12px] text-emerald-700 dark:text-emerald-400">{retorno}</p>}
        {aba === "recursos" ? <Recursos conta={conta.id}/> : <>
          {consulta.erro && <Aviso erro texto={consulta.erro}/>}
          {!r ? (consulta.carregando ? <Esqueleto/> : null) : <div className={`space-y-3 transition-opacity ${consulta.carregando ? "opacity-60" : ""}`} aria-busy={consulta.carregando}>
            {r.avisos.map(a => <Aviso key={a} texto={a}/>)}
            <Resumo r={r} dinheiro={dinheiro}/>

            {linhas.length ? <section aria-label="Campanhas" className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
              {/* os rótulos das colunas aparecem UMA vez, e cada um ordena a lista */}
              <div className="hidden items-center gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-2 sm:flex dark:border-zinc-800 dark:bg-zinc-900/50">
                <span className={`min-w-0 flex-1 ${rotuloColuna}`}>Campanha</span>
                {COLUNAS.map(c => {
                  const ativa = ordem.coluna === c.chave;
                  const Direcao = ordem.desc ? ArrowDown : ArrowUp;
                  return <span key={c.chave} className={`${c.largura} shrink-0 text-right`} aria-sort={ativa ? (ordem.desc ? "descending" : "ascending") : undefined}>
                    <button type="button" onClick={() => ordenarPor(c.chave, c.doMenor)} title={`Ordenar por ${c.rotulo.toLowerCase()}`}
                      className={`inline-flex items-center gap-1 ${rotuloColuna} transition hover:text-zinc-700 dark:hover:text-zinc-200 ${ativa ? "text-zinc-700 dark:text-zinc-200" : ""}`}>
                      {ativa && <Direcao className="size-3" aria-hidden="true"/>}{c.rotulo}
                    </button>
                  </span>;
                })}
                <span className="w-4 shrink-0" aria-hidden="true"/>
              </div>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">{linhas.map(l => <li key={l.id}>
                <LinhaCampanha l={l} selecionada={l.id === campanha} maiorGasto={maiorGasto} dinheiro={dinheiro} aoAbrir={() => setCampanha(l.id)}/>
              </li>)}</ul>
              {ocultas > 0 && <button type="button" onClick={() => setVerTodas(true)}
                className="w-full border-t border-zinc-200 px-4 py-2 text-left text-[11px] text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-50">
                +{ocultas} {ocultas === 1 ? "campanha" : "campanhas"} sem investimento nem lead no período
              </button>}
            </section> : <Vazio Icone={Megaphone} texto={busca ? "Nenhuma campanha com esse nome." : "Nenhuma campanha veiculou neste período."}/>}
          </div>}
        </>}
      </div>
    </div>

    {selecionada && r && <GavetaCampanha key={selecionada.id} linha={selecionada}
      conta={conta} periodo={periodo}
      podeGerenciar={r.permissoes.includes("ads_management")} gerenciando={editar !== undefined}
      aoGerenciar={setEditar} aoFechar={() => setCampanha("")}/>}
    {editar !== undefined && <GestaoAds key={editar?.id ?? "nova"} conta={conta.id} moeda={conta.currency} item={editar}
      aoFechar={() => setEditar(undefined)}
      aoSalvar={() => { setEditar(undefined); setRetorno("Alteração enviada à Meta. Os dados estão sendo atualizados."); setForcadas(n => n + 1); }}/>}
  </div>;
}

// ── O resumo do período ─────────────────────────────────────────────────────

// O custo por lead é gasto ÷ pessoas, na moeda da conta: não mistura moedas e
// vale mesmo com a conta fora do real. Quem mistura é o retorno (valor ganho
// em BRL ÷ gasto), que fica na gaveta.
function Resumo({ r, dinheiro }: { r: RelatorioAds; dinheiro: (v: number | null, moeda?: string) => string }) {
  const crm = r.total.crm;
  const custo = (gasto: number, leads: number) => {
    const v = dividir(gasto, leads);
    return v === null ? "sem lead no período" : `${dinheiro(v)} por lead`;
  };
  const series: SerieLinha<Dia>[] = [
    { nome: "Leads na Meta", cor: COR_META, Icone: Megaphone, valor: d => d.leadsMeta },
    ...(crm ? [{ nome: "Leads no CRM", cor: COR_CRM, Icone: Contact, valor: (d: Dia) => d.leadsCrm }] : []),
  ];
  const aproveitamento = crm && r.total.leadsMeta > 0 ? ` · ${porcento(crm.leads / r.total.leadsMeta * 100)} da Meta` : "";

  return <section aria-label="Resumo do período" className="viz rounded-xl border border-zinc-200 px-4 pb-3 pt-4 dark:border-zinc-800" data-tom={TOM}>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
      <Numero rotulo="Investido" valor={dinheiro(r.total.gasto)} detalhe={`${inteiro(r.total.cliques)} cliques · ${inteiro(r.total.impressoes)} impressões`}/>
      <Numero rotulo="Leads na Meta" Icone={Megaphone} cor={COR_META} valor={inteiro(r.total.leadsMeta)} detalhe={custo(r.total.gasto, r.total.leadsMeta)}/>
      <Numero rotulo="Leads no CRM" Icone={Contact} cor={COR_CRM} valor={crm ? inteiro(crm.leads) : "—"}
        detalhe={crm ? custo(r.total.gasto, crm.leads) + aproveitamento : "Sem acesso ao funil"}/>
      <Numero rotulo="Oportunidades" valor={crm ? inteiro(crm.oportunidades) : "—"}
        detalhe={crm ? `${inteiro(crm.ganhas)} ${crm.ganhas === 1 ? "ganha" : "ganhas"} · ${dinheiro(crm.valorGanho, "BRL")}` : "Sem acesso ao funil"}/>
    </dl>

    <div className="mt-4">
      <LinhasPorDia
        dados={r.diario}
        series={series}
        tom={TOM}
        altura="h-24"
        resumo={`por dia · ${diaCurto(r.periodo.inicio)} a ${diaCurto(r.periodo.fim)}`}
        notaNoDia={d => d.gasto > 0 ? `${dinheiro(d.gasto)} investidos` : null}
        vazio="Nenhum lead no período, nem na Meta nem no CRM."
        titulo={`Leads por dia na Meta e no CRM, de ${diaCurto(r.periodo.inicio)} a ${diaCurto(r.periodo.fim)}`}
      />
    </div>

    {r.leadsCrm && <Origem leads={r.leadsCrm}/>}
  </section>;
}

// Um número do resumo. O ícone na cor da série é o que liga o número à linha
// do gráfico logo abaixo.
function Numero({ rotulo, valor, detalhe, Icone, cor }: { rotulo: string; valor: string; detalhe: string; Icone?: LucideIcon; cor?: string }) {
  return <div className="min-w-0">
    <dt className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
      {Icone && <Icone className="size-3.5 shrink-0" style={{ color: cor }} aria-hidden="true"/>}
      {rotulo}
    </dt>
    <dd className="mt-0.5 truncate text-xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">{valor}</dd>
    <dd className="truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={detalhe}>{detalhe}</dd>
  </div>;
}

// De onde vieram os leads do CRM no período. Sem esta linha, "62 no CRM contra
// 80 na Meta" pareceria perda — quando parte da diferença é lead que chegou sem
// UTM ou por outra porta. Os números somam o total, sem sobra.
function Origem({ leads }: { leads: LeadsCrm }) {
  const partes = [
    { n: leads.semOrigem, texto: "sem origem (WhatsApp direto, cadastro à mão)" },
    { n: leads.semCorrespondencia, texto: "de outra origem (outra conta, Google, nome antigo)" },
    { n: leads.ambiguas, texto: "com nome que bate em duas campanhas" },
  ].filter(p => p.n > 0);
  return <p className="mt-2 border-t border-zinc-100 pt-2 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
    No período o CRM recebeu <strong className="font-semibold text-zinc-700 dark:text-zinc-200">{inteiro(leads.total)} {leads.total === 1 ? "lead" : "leads"}</strong>:
    {" "}{inteiro(leads.atribuidos)} de campanhas desta conta{partes.map(p => `, ${inteiro(p.n)} ${p.texto}`).join("")}.
    <span className="text-zinc-400 dark:text-zinc-500"> Lead é pessoa: o contato que entrou ou que voltou com uma oportunidade nova, contado uma vez.</span>
  </p>;
}

// ── Uma campanha da lista ───────────────────────────────────────────────────

function LinhaCampanha({ l, selecionada, maiorGasto, dinheiro, aoAbrir }: {
  l: LinhaAds; selecionada: boolean; maiorGasto: number;
  dinheiro: (v: number | null, moeda?: string) => string; aoAbrir: () => void;
}) {
  const m = l.metricas, crm = l.crm;
  const custo = custoPorLead(l);
  // Chegou ao CRM bem menos do que a Meta contou: vale olhar a página e a
  // captação. Só com volume — 1 de 2 não diz nada.
  const perda = crm && m.leads >= 5 && crm.leads < m.leads * 0.5;
  return <button type="button" onClick={aoAbrir} aria-label={`Abrir ${l.name}`}
    className={`flex w-full items-center gap-4 px-4 py-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${selecionada ? "bg-zinc-50 dark:bg-zinc-900/50" : ""}`}>
    <div className="min-w-0 flex-1">
      {/* Até duas linhas: os nomes desta conta carregam a estrutura entre
          colchetes ([LEADS][CBO][LP1]), e cortar em uma linha escondia
          justamente a parte que distingue uma campanha da outra. */}
      <p className="flex items-start gap-1.5 text-[13px] font-medium leading-snug text-zinc-900 dark:text-zinc-50" title={l.name}>
        <span className="line-clamp-2 break-words">{l.name}</span>
        {l.effective_status === "ACTIVE" && <span role="img" aria-label="Em veiculação" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-400"/>}
      </p>
      {/* o ponto verde já diz "ativa"; a palavra só entra quando é outra coisa */}
      <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
        {objetivos[l.objective ?? ""] ?? "Campanha"}
        {l.effective_status !== "ACTIVE" && ` · ${entregaLegivel(l.effective_status)}`}
      </p>
      {/* participação no investimento: o olho compara as barras antes de ler os números */}
      <div className="mt-1.5 h-1 w-full max-w-64 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-zinc-400 dark:bg-zinc-600" style={{ width: `${m.gasto / maiorGasto * 100}%` }}/>
      </div>
    </div>
    <Valor largura="w-24">{dinheiro(m.gasto)}</Valor>
    <Valor largura="w-20" detalhe={m.leads > 0 ? `${inteiro(m.cliques)} cliques` : undefined}>{inteiro(m.leads)}</Valor>
    <Valor largura="w-20" alerta={Boolean(perda)}
      detalhe={crm && m.leads > 0 ? `${porcento(crm.leads / m.leads * 100)} da Meta` : undefined}>{crm ? inteiro(crm.leads) : "—"}</Valor>
    <Valor largura="hidden w-24 lg:block"
      detalhe={crm && m.leads > 0 ? `Meta ${dinheiro(dividir(m.gasto, m.leads))}` : undefined}>{custo === null ? "—" : dinheiro(custo)}</Valor>
    <Valor largura="hidden w-24 xl:block" detalhe={crm && crm.ganhas > 0 ? `${inteiro(crm.ganhas)} ${crm.ganhas === 1 ? "ganha" : "ganhas"}` : undefined}>{crm ? inteiro(crm.oportunidades) : "—"}</Valor>
    <ChevronRight className="size-4 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true"/>
  </button>;
}

function Valor({ children, detalhe, largura, alerta }: { children: React.ReactNode; detalhe?: string; largura: string; alerta?: boolean }) {
  return <div className={`shrink-0 text-right ${largura}`}>
    <p className="truncate text-[13px] font-medium tabular-nums text-zinc-900 dark:text-zinc-50">{children}</p>
    {detalhe && <p className={`mt-0.5 truncate text-[11px] tabular-nums ${alerta ? "font-medium text-amber-700 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}`}
      title={alerta ? "Chegou ao CRM menos da metade dos leads que a Meta contou" : undefined}>{detalhe}</p>}
  </div>;
}

// Enquanto o primeiro relatório não chega: a forma da tela, sem número. Nas
// trocas de período seguintes quem fica é o relatório anterior, esmaecido.
function Esqueleto() {
  const bloco = "rounded bg-zinc-100 dark:bg-zinc-800/70";
  return <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Consultando a Meta e o CRM">
    <div className="rounded-xl border border-zinc-200 px-4 pb-3 pt-4 dark:border-zinc-800">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="space-y-1.5"><div className={`h-3 w-20 ${bloco}`}/><div className={`h-6 w-28 ${bloco}`}/><div className={`h-3 w-32 ${bloco}`}/></div>)}
      </div>
      <div className={`mt-4 h-24 ${bloco}`}/>
    </div>
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      {[0, 1, 2, 3, 4].map(i => <div key={i} className="flex items-center gap-4 border-b border-zinc-100 px-4 py-3 last:border-0 dark:border-zinc-800">
        <div className="flex-1 space-y-1.5"><div className={`h-3.5 w-2/5 ${bloco}`}/><div className={`h-2.5 w-1/5 ${bloco}`}/></div>
        <div className={`h-3.5 w-20 ${bloco}`}/><div className={`h-3.5 w-12 ${bloco}`}/><div className={`h-3.5 w-12 ${bloco}`}/>
      </div>)}
    </div>
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
    {carregando ? <Esqueleto/> : dados && <>
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
