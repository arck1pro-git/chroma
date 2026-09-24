"use client";

import { type ReactNode } from "react";
import { Background, BackgroundVariant, Controls, MarkerType, Panel, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GitBranch, MessageSquareText, Plus, Tag, Trash2, UserRoundPlus } from "lucide-react";

type Acao = { tipo: "registrar_lead" } | { tipo: "adicionar_tag"; tagId: string } | { tipo: "adicionar_segmento"; segmentoId: string } | { tipo: "criar_oportunidade"; funilId: string; etapaId: string; nome: string };
type Opcao = { id: string; nome: string };
type EtapaOpcao = Opcao & { funil_id: string };
type Ramo = "respondeu" | "expirou";
type Props = { template: string; idioma?:string; espera: number; aoResponder: Acao[]; aoExpirar: Acao[]; editavel?: boolean; templates?:Array<{name:string;language:string;status:string}>; tags?: Opcao[]; segmentos?: Opcao[]; funis?: Opcao[]; etapas?: EtapaOpcao[]; mudarTemplate?:(nome:string,idioma:string)=>void; mudarEspera?:(minutos:number)=>void; mudarResponder?: (acoes: Acao[]) => void; mudarExpirar?: (acoes: Acao[]) => void };

const campo = "nodrag nopan w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[11px] text-zinc-700 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200";
const aresta = { type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } } as const;

function duracao(minutos: number) {
  if (minutos % 1440 === 0) return `${minutos / 1440} dia${minutos === 1440 ? "" : "s"}`;
  if (minutos % 60 === 0) return `${minutos / 60} hora${minutos === 60 ? "" : "s"}`;
  return `${minutos} minutos`;
}

function Cartao({ icone, titulo, subtitulo, cor = "zinc", children }: { icone: ReactNode; titulo: string; subtitulo?: string; cor?: "zinc" | "emerald" | "amber" | "blue"; children?: ReactNode }) {
  const cores = { zinc: "border-zinc-200 dark:border-zinc-700", emerald: "border-emerald-300 dark:border-emerald-800", amber: "border-amber-300 dark:border-amber-800", blue: "border-blue-300 dark:border-blue-800" };
  return <div className={`w-[230px] rounded-xl border bg-white p-3 text-left shadow-sm dark:bg-zinc-900 ${cores[cor]}`}><div className="flex items-start gap-2"><span className="mt-0.5 text-zinc-500">{icone}</span><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</p>{subtitulo&&<p className="mt-0.5 truncate text-[10px] text-zinc-500">{subtitulo}</p>}</div></div>{children&&<div className="mt-2 space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">{children}</div>}</div>;
}

export default function FluxoCampanha({ template, idioma="pt_BR", espera, aoResponder, aoExpirar, editavel = false, templates = [], tags = [], segmentos = [], funis = [], etapas = [], mudarTemplate, mudarEspera, mudarResponder, mudarExpirar }: Props) {
  function mudar(ramo: Ramo) { return ramo === "respondeu" ? mudarResponder : mudarExpirar }
  function lista(ramo: Ramo) { return ramo === "respondeu" ? aoResponder : aoExpirar }
  function atualizar(ramo: Ramo, indice: number, acao: Acao) { mudar(ramo)?.(lista(ramo).map((item, i) => i === indice ? acao : item)) }
  function remover(ramo: Ramo, indice: number) { mudar(ramo)?.(lista(ramo).filter((_, i) => i !== indice)) }
  function adicionar(ramo: Ramo, tipo: Acao["tipo"]) {
    let nova: Acao | null = tipo === "registrar_lead" ? { tipo } : null;
    if (tipo === "adicionar_tag" && tags[0]) nova = { tipo, tagId: tags[0].id };
    if (tipo === "adicionar_segmento" && segmentos[0]) nova = { tipo, segmentoId: segmentos[0].id };
    if (tipo === "criar_oportunidade" && funis[0]) { const etapa = etapas.find((item) => item.funil_id === funis[0].id); if (etapa) nova = { tipo, funilId: funis[0].id, etapaId: etapa.id, nome: "Oportunidade · {{nome}}" } }
    if (nova) mudar(ramo)?.([...lista(ramo), nova]);
  }
  function editor(acao: Acao, ramo: Ramo, indice: number) {
    if (!editavel) return null;
    return <>{acao.tipo === "adicionar_tag"&&<select className={campo} value={acao.tagId} onChange={e=>atualizar(ramo,indice,{...acao,tagId:e.target.value})}>{tags.map(x=><option key={x.id} value={x.id}>{x.nome}</option>)}</select>}{acao.tipo === "adicionar_segmento"&&<select className={campo} value={acao.segmentoId} onChange={e=>atualizar(ramo,indice,{...acao,segmentoId:e.target.value})}>{segmentos.map(x=><option key={x.id} value={x.id}>{x.nome}</option>)}</select>}{acao.tipo === "criar_oportunidade"&&<><select className={campo} value={acao.funilId} onChange={e=>{const etapa=etapas.find(x=>x.funil_id===e.target.value);if(etapa)atualizar(ramo,indice,{...acao,funilId:e.target.value,etapaId:etapa.id})}}>{funis.map(x=><option key={x.id} value={x.id}>{x.nome}</option>)}</select><select className={campo} value={acao.etapaId} onChange={e=>atualizar(ramo,indice,{...acao,etapaId:e.target.value})}>{etapas.filter(x=>x.funil_id===acao.funilId).map(x=><option key={x.id} value={x.id}>{x.nome}</option>)}</select><input className={campo} value={acao.nome} onChange={e=>atualizar(ramo,indice,{...acao,nome:e.target.value})}/></>}<button type="button" onClick={()=>remover(ramo,indice)} className="nodrag nopan flex items-center gap-1 text-[10px] font-medium text-red-500"><Trash2 className="size-3"/>Remover bloco</button></>;
  }
  const { nodes, edges } = (() => {
    const envioEditor=editavel?<><select className={campo} value={`${template}::${idioma}`} onChange={e=>{const [nome,...resto]=e.target.value.split("::");mudarTemplate?.(nome,resto.join("::"))}}><option value="::">Selecione o template</option>{templates.filter(t=>t.status==="APPROVED").map(t=><option key={`${t.name}-${t.language}`} value={`${t.name}::${t.language}`}>{t.name} · {t.language}</option>)}</select><label className="block text-[9px] font-medium uppercase tracking-wide text-zinc-400">Aguardar resposta<select className={`${campo} mt-1`} value={espera} onChange={e=>mudarEspera?.(Number(e.target.value))}><option value={60}>1 hora</option><option value={360}>6 horas</option><option value={1440}>1 dia</option><option value={4320}>3 dias</option><option value={10080}>7 dias</option><option value={43200}>30 dias</option></select></label></>:null;
    const estiloNo={padding:0,border:"none",background:"transparent",width:230};
    const nodes: Node[] = [{ id:"envio",position:{x:40,y:235},sourcePosition:Position.Right,targetPosition:Position.Left,style:estiloNo,data:{label:<Cartao cor="blue" icone={<MessageSquareText className="size-4"/>} titulo="Enviar template" subtitulo={!editavel?`${template||"Sem template"} · aguardar ${duracao(espera)}`:undefined}>{envioEditor}</Cartao>},draggable:false}];
    const edges: Edge[] = [];
    const ramos: Array<{chave:Ramo;acoes:Acao[];y:number;titulo:string;cor:"emerald"|"amber"}> = [{chave:"respondeu",acoes:aoResponder,y:90,titulo:"Respondeu",cor:"emerald"},{chave:"expirou",acoes:aoExpirar,y:390,titulo:"Não respondeu",cor:"amber"}];
    for(const ramo of ramos){let anterior="envio";(ramo.acoes.length?ramo.acoes:[null]).forEach((acao,indice)=>{const id=`${ramo.chave}-${indice}`;const titulo=!acao?"Encerrar fluxo":acao.tipo==="registrar_lead"?"Registrar conversão":acao.tipo==="adicionar_tag"?"Adicionar tag":acao.tipo==="adicionar_segmento"?"Adicionar ao segmento":"Criar oportunidade";const subtitulo=!acao?"Nenhuma ação adicional":acao.tipo==="adicionar_tag"?tags.find(x=>x.id===acao.tagId)?.nome:acao.tipo==="adicionar_segmento"?segmentos.find(x=>x.id===acao.segmentoId)?.nome:acao.tipo==="criar_oportunidade"?acao.nome:"Conta como resultado da campanha";const icone=acao?.tipo==="adicionar_tag"?<Tag className="size-4"/>:acao?.tipo==="criar_oportunidade"?<UserRoundPlus className="size-4"/>:<GitBranch className="size-4"/>;nodes.push({id,position:{x:360+indice*290,y:ramo.y},sourcePosition:Position.Right,targetPosition:Position.Left,style:estiloNo,data:{label:<Cartao cor={ramo.cor} icone={icone} titulo={titulo} subtitulo={subtitulo}>{acao?editor(acao,ramo.chave,indice):null}</Cartao>},draggable:false});edges.push({id:`${anterior}-${id}`,source:anterior,target:id,label:anterior==="envio"?ramo.titulo:undefined,labelStyle:{fontSize:10,fill:ramo.cor==="emerald"?"#059669":"#d97706"},...aresta});anterior=id})}
    return {nodes,edges};
  })();
  const botoes = [{tipo:"registrar_lead",nome:"Conversão"},{tipo:"adicionar_tag",nome:"Tag"},{tipo:"adicionar_segmento",nome:"Segmento"},{tipo:"criar_oportunidade",nome:"Oportunidade"}] as const;
  return <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"><div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"><p className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">Fluxo da campanha</p><p className="mt-0.5 text-[10px] text-zinc-500">Monte as ações pelos blocos ou descreva a campanha para a IA.</p></div><div className="h-[610px]"><ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{padding:.2}} minZoom={.55} maxZoom={1.2} nodesConnectable={false} elementsSelectable={false} proOptions={{hideAttribution:true}}><Background variant={BackgroundVariant.Dots} gap={18} size={1}/><Controls showInteractive={false}/>{editavel&&<Panel position="top-left"><div className="nodrag nopan w-48 rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"><p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Adicionar bloco</p>{([{ramo:"respondeu",titulo:"Quando responder"},{ramo:"expirou",titulo:"Sem resposta"}] as const).map(grupo=><div key={grupo.ramo} className="mb-2 last:mb-0"><p className="px-1 pb-1 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">{grupo.titulo}</p><div className="grid grid-cols-2 gap-1">{botoes.map(acao=><button type="button" key={acao.tipo} onClick={()=>adicionar(grupo.ramo,acao.tipo)} className="flex items-center gap-1 rounded-md border border-zinc-200 px-1.5 py-1.5 text-left text-[9px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"><Plus className="size-3 shrink-0"/>{acao.nome}</button>)}</div></div>)}</div></Panel>}</ReactFlow></div></section>;
}
