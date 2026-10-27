"use client";

import { useMemo, useState } from "react";
import type { CriativosAds, LinhaAds, RecursosAds, RelatorioAds } from "@/lib/meta-ads-tipos";
import type { ContextoMetrica } from "@/lib/meta-ads-metricas";
import { preferenciaDeCriterio, primeiroQueRanqueia, ranquear } from "@/lib/meta-ads-ranking";
import { teveResultado } from "@/lib/meta-ads-metricas";
import { ArrowUpRight, Plus, RefreshCw } from "@/app/components/icones";
import { Seta, campo } from "../components/filtros-ui";
import LogoMeta from "../components/logo-meta";
import { useConsulta } from "./use-consulta";
import VisaoGeralAds from "./visao-geral-ads";
import TabelaCampanhas from "./tabela-campanhas";
import GaleriaCriativos from "./galeria-criativos";
import GavetaCampanha from "./gaveta-campanha";
import GavetaCriativo from "./gaveta-criativo";
import GestaoAds from "./gestao-ads";
import { criativoComoItem } from "./ranking-ads";
import { Segmentado } from "./metricas-ui";
import { Aviso, botaoAds, botaoPrincipalAds, entregaLegivel } from "./pecas";

// Meta Ads: o que a Meta contou e o que chegou ao CRM.
//
// REDESENHO DE 2026-10-23 (pedido dele: "o melhor dos módulos, o mais intuitivo
// e fácil de ver", com todas as métricas do Gerenciador e o ranking das
// melhores campanhas e do melhor criativo). Quatro abas sob um período só:
//   · Visão geral — a conta inteira: os números com a seta contra o período
//     anterior, o dia a dia, o funil da impressão à venda, o pódio e todas as
//     métricas (./visao-geral-ads.tsx);
//   · Campanhas — a tabela com as visões do Gerenciador (./tabela-campanhas.tsx);
//   · Criativos — a galeria das peças, ranqueada (./galeria-criativos.tsx);
//   · Públicos e integrações — o inventário da conta.
// Campanha e criativo abrem na gaveta da direita, de qualquer aba.
//
// OS PERÍODOS PRONTOS VÃO ATÉ ONTEM (7, 30, 90 dias completos), como no
// Gerenciador — e os números batem com os dele. Até 2026-10-23 terminavam hoje:
// um dia pela metade comparado com dias inteiros deixava a seta vermelha toda
// manhã, numa semana igual à anterior. Hoje entra pelo "Datas".
//
// RÁPIDA POR CONSTRUÇÃO: o relatório e, depois dele, os criativos, guardados
// por alguns minutos no servidor (lib/meta.ts, `lembrar`); trocar o período
// mantém os números anteriores na tela até os novos chegarem; o botão
// Atualizar é o único que força uma ida à Meta.

type Conta = { id: string; name: string; currency: string; timezone_name?: string };
type Aba = "visao" | "campanhas" | "criativos" | "recursos";
type Janela = "7" | "30" | "90" | "livre";

const horaFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
function dataHoje(fuso: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function diasAntes(dia: string, dias: number) { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - dias); return d.toISOString().slice(0, 10); }

export default function PainelAds({ contas, erro }: { contas: Conta[]; erro?: string | null }) {
  const [contaId, setConta] = useState(contas[0]?.id ?? "");
  const conta = contas.find((c) => c.id === contaId);
  if (erro) return <div className="p-6"><Aviso erro texto={erro} /></div>;
  if (!conta) return <div className="p-6"><Aviso texto="Nenhuma conta de anúncios atribuída a esta integração." /></div>;
  return <ConteudoAds key={conta.id} conta={conta} contas={contas} aoTrocarConta={setConta} />;
}

function ConteudoAds({ conta, contas, aoTrocarConta }: { conta: Conta; contas: Conta[]; aoTrocarConta: (id: string) => void }) {
  const hoje = dataHoje(conta.timezone_name || "America/Sao_Paulo");
  const ontem = diasAntes(hoje, 1);
  const padrao = { inicio: diasAntes(ontem, 29), fim: ontem };
  const [janela, setJanela] = useState<Janela>("30");
  const [inicio, setInicio] = useState(padrao.inicio), [fim, setFim] = useState(padrao.fim);
  const [periodo, setPeriodo] = useState(padrao);
  const [aba, setAba] = useState<Aba>("visao");
  const [campanha, setCampanha] = useState("");
  const [criativo, setCriativo] = useState("");
  const [editar, setEditar] = useState<LinhaAds | null | undefined>(undefined);
  const [retorno, setRetorno] = useState("");
  // Cada clique em Atualizar é uma URL nova com `atualizar=1` — é ela que faz o
  // servidor ignorar o guardado. Trocar o período volta ao normal.
  const [forcadas, setForcadas] = useState(0);
  const ctx: ContextoMetrica = useMemo(() => ({ moeda: conta.currency }), [conta.currency]);

  const params = { conta: conta.id, ...periodo, ...(forcadas ? { atualizar: "1", n: String(forcadas) } : {}) };
  const consulta = useConsulta<RelatorioAds>(`/api/meta/ads/painel?${new URLSearchParams(params)}`, { manter: true });
  // Os criativos carregam DEPOIS do relatório (a visão geral também mostra o
  // pódio deles): juntos eram ~11 consultas simultâneas ao banco para um pool de
  // 12 (lib/db.ts), e o CRM que o relatório acabou de ler fica guardado um
  // minuto para os criativos reaproveitarem. Enquanto o relatório do período
  // novo carrega, ficam os criativos do anterior (`manter`). A aba Públicos não
  // anula a URL: voltar dela não pede tudo de novo à Meta.
  const consultaCriativos = useConsulta<CriativosAds>(consulta.carregando || !consulta.dados ? null : `/api/meta/ads/painel?${new URLSearchParams({ criativos: "1", ...params })}`, { manter: true });
  const r = consulta.dados;
  const temCrm = Boolean(r?.total.crm);
  const selecionada = r?.campanhas.find((c) => c.id === campanha) ?? null;
  const peca = consultaCriativos.dados?.criativos.find((c) => c.chave === criativo) ?? null;
  const carregando = consulta.carregando || (aba !== "recursos" && consultaCriativos.carregando);

  // A posição da peça aberta, pelo mesmo critério padrão da galeria.
  const posicaoDaPeca = useMemo(() => {
    const itens = (consultaCriativos.dados?.criativos ?? []).map(criativoComoItem);
    const c = primeiroQueRanqueia(itens, preferenciaDeCriterio(temCrm), ctx);
    const p = ranquear(itens, c, ctx).posicoes.find((x) => x.item.id === criativo);
    return { posicao: p?.posicao ?? null, rotulo: c.rotulo };
  }, [consultaCriativos.dados, criativo, temCrm, ctx]);

  // Os períodos prontos aplicam sozinhos: pedir um clique a mais em "30 dias"
  // seria cerimônia. Só "Datas" mantém o botão, porque ali as duas pontas mudam
  // e consultar no meio da digitação buscaria período torto.
  function escolherJanela(valor: Janela) {
    setJanela(valor);
    if (valor === "livre") return;
    const novo = { inicio: diasAntes(ontem, Number(valor) - 1), fim: ontem };
    setInicio(novo.inicio); setFim(novo.fim); setPeriodo(novo); setForcadas(0);
  }

  const comResultado = r?.campanhas.filter(teveResultado).length;
  const abas: Array<{ valor: Aba; rotulo: string; detalhe?: string }> = [
    { valor: "visao", rotulo: "Visão geral" },
    { valor: "campanhas", rotulo: "Campanhas", detalhe: comResultado !== undefined ? String(comResultado) : undefined },
    { valor: "criativos", rotulo: "Criativos", detalhe: consultaCriativos.dados ? String(consultaCriativos.dados.criativos.length) : undefined },
    { valor: "recursos", rotulo: "Públicos e integrações" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-zinc-200 px-6 pt-4 dark:border-zinc-800">
        <div className="flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900"><LogoMeta className="size-4" /></span>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">Meta Ads</h1>
              {/* uma conta só não é escolha: vira o subtítulo */}
              {contas.length > 1 ? (
                <div className="relative mt-0.5 inline-block">
                  <select aria-label="Conta de anúncios" value={conta.id} onChange={(e) => aoTrocarConta(e.target.value)}
                    className="appearance-none bg-transparent pr-5 text-[12px] text-zinc-500 outline-none hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
                    {contas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select><Seta />
                </div>
              ) : <p className="mt-0.5 truncate text-[12px] text-zinc-500 dark:text-zinc-400">{conta.name}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* A hora em que os números saíram da Meta: eles ficam guardados alguns
                minutos, e quem quer o de agora sabe que existe o botão ao lado. */}
            {r && aba !== "recursos" && (
              <span className="hidden text-[11.5px] text-zinc-400 sm:inline dark:text-zinc-500" title="Os números da Meta ficam guardados por alguns minutos. Atualizar busca de novo.">
                Meta às {horaFmt.format(new Date(r.atualizadoEm))}
              </span>
            )}
            {aba !== "recursos" && (
              <button className={botaoAds} disabled={carregando} onClick={() => setForcadas((n) => n + 1)} title="Buscar os números de agora na Meta">
                <RefreshCw className={`size-3.5 ${carregando ? "animate-spin" : ""}`} aria-hidden="true" /><span className="hidden md:inline">Atualizar</span>
              </button>
            )}
            <a className={botaoAds} href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${conta.id.replace("act_", "")}`} target="_blank" rel="noreferrer">
              <span className="hidden md:inline">Gerenciador</span><ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
            <button className={botaoPrincipalAds} disabled={!r?.permissoes.includes("ads_management")} onClick={() => setEditar(null)}
              title={r && !r.permissoes.includes("ads_management") ? "A integração não tem permissão para criar campanhas" : undefined}>
              <Plus className="size-4" aria-hidden="true" />Nova campanha
            </button>
          </div>
        </div>

        <div className="mt-3 flex max-w-[1600px] flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <nav className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Seções do Meta Ads">
            {abas.map((a) => {
              const ativa = aba === a.valor;
              return (
                <button key={a.valor} type="button" onClick={() => setAba(a.valor)} aria-current={ativa ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-1 text-[13px] transition ${ativa
                    ? "border-zinc-900 font-medium text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                    : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"}`}>
                  {a.rotulo}
                  {a.detalhe && <span className="rounded-full bg-zinc-100 px-1.5 text-[10.5px] font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{a.detalhe}</span>}
                </button>
              );
            })}
          </nav>
          {aba !== "recursos" && (
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <Segmentado rotulo="Período" tamanho="sm" valor={janela} aoMudar={escolherJanela} opcoes={[
                { valor: "7", rotulo: "7 dias" }, { valor: "30", rotulo: "30 dias" }, { valor: "90", rotulo: "90 dias" }, { valor: "livre", rotulo: "Datas" },
              ]} />
              {janela === "livre" && (
                <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); setPeriodo({ inicio, fim }); setForcadas(0); }}>
                  <input aria-label="Data inicial" type="date" required value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} className={`${campo} py-1 pr-2 text-[12px]`} />
                  <span className="text-[12px] text-zinc-400">a</span>
                  <input aria-label="Data final" type="date" required min={inicio} max={hoje} value={fim} onChange={(e) => setFim(e.target.value)} className={`${campo} py-1 pr-2 text-[12px]`} />
                  <button className={`${botaoAds} py-1`}>Aplicar</button>
                </form>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-[1600px] space-y-3">
          {retorno && <p role="status" className="text-[12px] text-emerald-700 dark:text-emerald-400">{retorno}</p>}
          {aba === "recursos" ? <Recursos conta={conta.id} /> : <>
            {consulta.erro && <Aviso erro texto={consulta.erro} />}
            {!r ? (consulta.carregando ? <Esqueleto /> : null) : (
              <div className={`transition-opacity ${consulta.carregando ? "opacity-60" : ""}`} aria-busy={consulta.carregando}>
                {aba === "visao" && <VisaoGeralAds r={r} ctx={ctx} criativos={consultaCriativos.dados} carregandoCriativos={consultaCriativos.carregando}
                  erroCriativos={consultaCriativos.erro} aoAbrirCampanha={setCampanha} aoAbrirCriativo={setCriativo} aoVerAba={setAba} />}
                {aba === "campanhas" && <TabelaCampanhas r={r} ctx={ctx} selecionada={campanha} aoAbrir={setCampanha} />}
                {aba === "criativos" && <GaleriaCriativos dados={consultaCriativos.dados} carregando={consultaCriativos.carregando} erro={consultaCriativos.erro}
                  ctx={ctx} temCrm={temCrm} selecionado={criativo} aoAbrir={setCriativo} />}
              </div>
            )}
          </>}
        </div>
      </div>

      {peca && !selecionada && <GavetaCriativo key={peca.chave} criativo={peca} ctx={ctx} posicao={posicaoDaPeca.posicao} rotuloCriterio={posicaoDaPeca.rotulo}
        aoFechar={() => setCriativo("")} aoAbrirCampanha={(id) => { setCriativo(""); setCampanha(id); }}
        // Campanha arquivada não vem na lista da Meta: o anúncio dela aparece, mas não abre.
        temCampanha={(id) => Boolean(r?.campanhas.some((c) => c.id === id))} />}
      {selecionada && r && <GavetaCampanha key={selecionada.id} linha={selecionada}
        conta={conta} periodo={periodo}
        podeGerenciar={r.permissoes.includes("ads_management")} gerenciando={editar !== undefined}
        aoGerenciar={setEditar} aoFechar={() => setCampanha("")} />}
      {editar !== undefined && <GestaoAds key={editar?.id ?? "nova"} conta={conta.id} moeda={conta.currency} item={editar}
        aoFechar={() => setEditar(undefined)}
        aoSalvar={() => { setEditar(undefined); setRetorno("Alteração enviada à Meta. Os dados estão sendo atualizados."); setForcadas((n) => n + 1); }} />}
    </div>
  );
}

// Enquanto o primeiro relatório não chega: a forma da tela, sem número. Nas
// trocas de período seguintes quem fica é o relatório anterior, esmaecido.
function Esqueleto() {
  const bloco = "rounded bg-zinc-100 dark:bg-zinc-800/70";
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Consultando a Meta e o CRM">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2 rounded-xl border border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
            <div className={`h-3 w-20 ${bloco}`} /><div className={`h-6 w-28 ${bloco}`} /><div className={`h-3 w-32 ${bloco}`} />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className={`h-60 rounded-xl xl:col-span-2 ${bloco}`} /><div className={`h-60 rounded-xl ${bloco}`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className={`h-72 rounded-xl ${bloco}`} /><div className={`h-72 rounded-xl ${bloco}`} />
      </div>
    </div>
  );
}

function Recursos({ conta }: { conta: string }) {
  const { dados, erro, carregando, atualizar } = useConsulta<RecursosAds>(`/api/meta/ads/painel?recursos=1&conta=${conta}`);
  return <>
    <div className="flex items-center justify-between gap-3">
      <p className="text-[12px] text-zinc-500">Ativos que esta integração enxerga na conta.</p>
      <button className={botaoAds} onClick={() => void atualizar()}><RefreshCw className={`size-3.5 ${carregando ? "animate-spin" : ""}`} aria-hidden="true" />Atualizar</button>
    </div>
    {erro && <Aviso erro texto={erro} />}
    {carregando ? <Esqueleto /> : dados && <>
      <div className="grid gap-3 md:grid-cols-2">
        {([["Públicos", dados.publicos], ["Pixels e conjuntos de dados", dados.pixels], ["Páginas", dados.paginas], ["Formulários de leads", dados.formularios]] as const).map(([titulo, itens]) =>
          <section key={titulo} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-[12.5px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo} <span className="ml-1 font-normal text-zinc-400">{itens.length}</span></h2>
            <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">{itens.map((i) =>
              <li key={i.id} className="text-[12px] text-zinc-700 dark:text-zinc-300">{i.name || i.id}
                <p className="text-[11px] text-zinc-400">{i.id}{i.status ? ` · ${entregaLegivel(i.status)}` : ""}{i.subtype ? ` · ${i.subtype}` : ""}</p>
              </li>)}</ul>
            {!itens.length && <p className="mt-2 text-[12px] text-zinc-400">Nenhum ativo retornado.</p>}
          </section>)}
      </div>
      {dados.avisos.map((a) => <Aviso key={a} texto={a} />)}
      <p className="text-[11px] leading-relaxed text-zinc-500">
        O inventário confirma o acesso. Enviar eventos pela Conversions API, sincronizar públicos e importar formulários ainda exige escolher o ativo de destino e mapear os campos do CRM.
      </p>
    </>}
  </>;
}