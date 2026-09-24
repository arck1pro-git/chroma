"use client";

import { useState } from "react";
import { useConsulta } from "../campanhas/use-consulta";
import { filtroCampanhasVazio, type FiltroCampanhas } from "./filtro-campanhas";

type Campanha = {id:string;name:string;effective_status:string};
type Conjunto = {id:string;nome:string;anuncios:Array<{id:string;nome:string}>};

export default function DashboardMetaAds({corSelecionada, filtro, aoFiltrar}:{corSelecionada:string; filtro:FiltroCampanhas; aoFiltrar:(filtro:FiltroCampanhas)=>void}){
  const status=useConsulta<{contasAds:Array<{id:string;name:string}>}>("/api/meta/status");
  const [contaId,setConta]=useState("");
  const conta=contaId||status.dados?.contasAds[0]?.id;
  const ads=useConsulta<{campanhas:Campanha[]}>(conta?`/api/meta/ads?conta=${encodeURIComponent(conta)}`:null);
  const disparos=useConsulta<{campanhas:Array<{id:string;nome:string}>}>("/api/meta/whatsapp/campanhas");
  const campanhaId=filtro.campanha?.id;
  const [disparoId,setDisparo]=useState<string|null>(null);
  const conjuntoId=filtro.conjunto?.id;
  const anuncioId=filtro.anuncio?.id;
  const campanha=ads.dados?.campanhas.find(c=>c.id===campanhaId);
  const detalhes=useConsulta<{grupos:Conjunto[]}>(campanha?`/api/meta/ads?estrutura=${encodeURIComponent(campanha.id)}`:null);
  const conjuntos=detalhes.dados?.grupos??[];
  const conjunto=conjuntos.find(c=>c.id===conjuntoId);
  const erro=status.erro||ads.erro||disparos.erro||detalhes.erro;
  return <section className="surge mb-3 shrink-0 space-y-2 pr-6 xl:pr-16">
    {(status.dados?.contasAds.length??0)>1&&<Nivel titulo="Conta"><select aria-label="Conta de anúncios" value={conta} onChange={e=>{setConta(e.target.value);aoFiltrar(filtroCampanhasVazio)}} className="rounded-lg bg-transparent text-xs">{status.dados?.contasAds.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Nivel>}
    {erro&&<p role="alert" className="text-xs text-amber-600">{erro} <button onClick={()=>{void status.atualizar();void ads.atualizar();void disparos.atualizar();void detalhes.atualizar()}}>Tentar novamente</button></p>}
    <Nivel titulo="Campanhas">{ads.dados?.campanhas.map(c=><Pill key={c.id} campanhaAtiva={c.effective_status==="ACTIVE"} ativo={c.id===campanhaId} corSelecionada={corSelecionada} onClick={()=>{aoFiltrar({campanha:campanhaId===c.id?null:{id:c.id,nome:c.name},conjunto:null,anuncio:null})}}>{c.name}</Pill>)}{(status.carregando||ads.carregando)?<span className="text-xs text-zinc-400">Carregando…</span>:!erro&&!ads.dados?.campanhas.length&&<span className="text-xs text-zinc-400">Nenhuma campanha.</span>}</Nivel>
    {campanha&&<Nivel titulo="Conjuntos">{conjuntos.map(c=><Pill key={c.id} ativo={c.id===conjuntoId} corSelecionada={corSelecionada} onClick={()=>{aoFiltrar({...filtro,conjunto:conjuntoId===c.id?null:{id:c.id,nome:c.nome},anuncio:null})}}>{c.nome}</Pill>)}{detalhes.carregando&&<span className="text-xs text-zinc-400">Carregando…</span>}</Nivel>}
    {conjunto&&<Nivel titulo="Anúncios"><Pill ativo={!anuncioId} corSelecionada={corSelecionada} onClick={()=>aoFiltrar({...filtro,anuncio:null})}>Todos</Pill>{conjunto.anuncios.map(a=><Pill key={a.id} ativo={a.id===anuncioId} corSelecionada={corSelecionada} onClick={()=>aoFiltrar({...filtro,anuncio:anuncioId===a.id?null:{id:a.id,nome:a.nome}})}>{a.nome}</Pill>)}</Nivel>}
    <Nivel titulo="Disparos">{disparos.dados?.campanhas.map(d=><Pill key={d.id} ativo={d.id===disparoId} corSelecionada={corSelecionada} onClick={()=>setDisparo(atual=>atual===d.id?null:d.id)}>{d.nome}</Pill>)}{disparos.carregando?<span className="text-xs text-zinc-400">Carregando…</span>:!disparos.erro&&!disparos.dados?.campanhas.length&&<span className="text-xs text-zinc-400">Nenhum disparo.</span>}</Nivel>
  </section>;
}

function Nivel({titulo,children}:{titulo:string;children:React.ReactNode}){return <div className="flex min-w-0 items-center gap-2"><p className="w-14 shrink-0 text-[9px] text-zinc-400">{titulo}</p><div className="flex min-w-0 flex-wrap gap-1">{children}</div></div>}
function Pill({ativo,campanhaAtiva=false,corSelecionada,onClick,children}:{ativo:boolean;campanhaAtiva?:boolean;corSelecionada:string;onClick:()=>void;children:React.ReactNode}){return <button type="button" aria-pressed={ativo} onClick={onClick} title={campanhaAtiva?"Campanha ativa":undefined} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] transition ${ativo?`${corSelecionada} text-white`:"bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>{children}{campanhaAtiva&&<span role="img" className="size-1.5 shrink-0 rounded-full bg-emerald-400" aria-label="Campanha ativa"/>}</button>}
