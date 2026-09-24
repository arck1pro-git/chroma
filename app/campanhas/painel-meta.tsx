"use client";

import { useState } from "react";
import { consultar, useConsulta } from "./use-consulta";
import { BarChart3, LoaderCircle, MessageCircle, PanelLeft, PanelLeftClose, RefreshCw, Send } from "lucide-react";
import PainelAds from "./painel-ads";
import FluxoCampanha from "./fluxo-campanha";
import IaCampanhas from "./ia-campanhas";
import { Aviso, Vazio } from "./pecas";

type Segmento = { id: string; nome: string; contatos: number };
type Opcao = { id:string; nome:string };
type EtapaOpcao = Opcao & { funil_id:string };
type AcaoFluxo = { tipo:"registrar_lead" } | { tipo:"adicionar_tag";tagId:string } | { tipo:"adicionar_segmento";segmentoId:string } | { tipo:"criar_oportunidade";funilId:string;etapaId:string;nome:string };
type StatusMeta = {
  permissoes: string[];
  contasAds: Array<{ id: string; name: string; currency: string }>;
  wabas: Array<{ id: string; name: string }>;
  telefones: Array<{ id: string; display_phone_number: string; verified_name: string }>;
  templates: Array<{ id:string; name:string; language:string; status:string; category:string }>;
  erroWhatsApp: string | null;
};
type CampanhaWpp = { id:string; nome:string; segmento_nome:string; template_nome:string; template_idioma:string; telefone_exibicao:string; status:string; total:number; enviados:number; aguardando:number; responderam:number; expiraram:number; falharam:number; conversoes:number; definicao:{template_nome?:string;template_idioma?:string;espera_minutos:number;ao_responder:AcaoFluxo[];ao_expirar:AcaoFluxo[]}; falhas:Array<{contato:string;erro:string}>; data_criacao:string; data_conclusao:string|null };

const numero = (v?: string) => Number(v ?? 0).toLocaleString("pt-BR");
const campo = "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100";

export default function PainelCampanhasMeta({ segmentos, tags, funis, etapas }: { segmentos: Segmento[]; tags:Opcao[]; funis:Opcao[]; etapas:EtapaOpcao[] }) {
  const [aba, setAba] = useState<"ads" | "whatsapp">("ads");
  const [canaisRecolhidos, setCanaisRecolhidos] = useState(false);
  const { dados: status, erro, carregando, atualizar: carregar } = useConsulta<StatusMeta>("/api/meta/status");
  return <div className="flex h-screen overflow-hidden bg-conteudo">
    <aside className={`flex h-screen shrink-0 flex-col gap-1 overflow-y-auto border-r border-zinc-200 p-2 transition-[width] dark:border-zinc-800 ${canaisRecolhidos?"w-[60px]":"w-[200px]"}`}>
      <div className={`mb-1 flex items-center py-1.5 ${canaisRecolhidos?"justify-center":"px-2.5"}`}>{!canaisRecolhidos&&<h1 className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Campanhas</h1>}<BotaoRecolher recolhida={canaisRecolhidos} alternar={()=>setCanaisRecolhidos(v=>!v)}/></div>
      <nav className="flex flex-col gap-0.5" aria-label="Canais de campanha">
        {!canaisRecolhidos&&<h2 className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">Canais</h2>}
        <ItemNav ativo={aba === "ads"} onClick={() => setAba("ads")} Icone={BarChart3} recolhida={canaisRecolhidos}>Meta Ads</ItemNav>
        <ItemNav ativo={aba === "whatsapp"} onClick={() => setAba("whatsapp")} Icone={MessageCircle} recolhida={canaisRecolhidos}>Campanhas de WPP</ItemNav>
      </nav>
    </aside>
    <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
      {carregando ? <div className="px-6 py-6"><Vazio Icone={LoaderCircle} texto="Consultando a Meta…" girando/></div> : erro ? <div className="px-6 py-6"><Aviso texto={erro}/><button onClick={()=>void carregar()} className="mt-3 text-sm">Tentar novamente</button></div> : status && (aba === "ads" ? <PainelAds contas={status.contasAds}/> : <WhatsApp status={status} segmentos={segmentos} tags={tags} funis={funis} etapas={etapas} atualizar={carregar}/>) }
    </main>
  </div>;
}

function ItemNav({ ativo, onClick, Icone, children, recolhida=false }: { ativo: boolean; onClick: () => void; Icone: typeof BarChart3; children: React.ReactNode; recolhida?:boolean }) { return <button onClick={onClick} aria-current={ativo ? "page" : undefined} title={recolhida?String(children):undefined} className={`flex items-center rounded-lg py-2 text-left text-[13px] transition-colors ${recolhida?"justify-center px-0":"gap-2.5 px-2.5"} ${ativo ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-50"}`}><Icone className="size-4 shrink-0"/>{!recolhida&&<span className="truncate">{children}</span>}</button>; }

function BotaoRecolher({recolhida,alternar}:{recolhida:boolean;alternar:()=>void}){const Icone=recolhida?PanelLeft:PanelLeftClose;return <button type="button" onClick={alternar} aria-label={recolhida?"Expandir barra":"Recolher barra"} title={recolhida?"Expandir barra":"Recolher barra"} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"><Icone className="size-4"/></button>}

function WhatsApp({ status, segmentos, tags, funis, etapas, atualizar }: { status: StatusMeta; segmentos: Segmento[]; tags:Opcao[]; funis:Opcao[]; etapas:EtapaOpcao[]; atualizar: () => Promise<void> }) {
  const [listaRecolhida,setListaRecolhida]=useState(false);
  const {dados:lista,erro:erroLista,carregando,atualizar:listar}=useConsulta<{campanhas:CampanhaWpp[]}>("/api/meta/whatsapp/campanhas");
  const campanhas=lista?.campanhas??[];
  const [selecionada,setSelecionada]=useState<string|null>(null); const [nova,setNova]=useState(false);
  const [nome,setNome]=useState(""); const [segmentoIds,setSegmentoIds]=useState<string[]>(segmentos[0]?[segmentos[0].id]:[]); const primeiroTemplate=status.templates.find(t=>t.status==="APPROVED"); const [template,setTemplate]=useState(primeiroTemplate?.name??""); const [idioma,setIdioma]=useState(primeiroTemplate?.language??"pt_BR"); const [espera,setEspera]=useState(1440); const [aoResponder,setAoResponder]=useState<AcaoFluxo[]>([{tipo:"registrar_lead"}]); const [aoExpirar,setAoExpirar]=useState<AcaoFluxo[]>([]); const [enviando,setEnviando]=useState(false); const [retorno,setRetorno]=useState("");
  if (!status.wabas.length || !status.telefones.length) return <div className="px-6 py-6"><Aviso texto={status.erroWhatsApp ?? "A conexão do WhatsApp Business ainda não possui conta e número acessíveis."}/></div>;
  const campanha=campanhas.find(c=>c.id===selecionada)??campanhas[0]??null;
  async function disparar(){
    if(!confirm("Ativar este fluxo e enviar mensagens aos contatos dos segmentos selecionados?"))return;
    setEnviando(true);setRetorno("");
    try {
      const resultado=await consultar<{id:string;total:number}>("/api/meta/whatsapp/campanhas",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmar:true,nome,segmentoIds,waba:status.wabas[0].id,telefoneId:status.telefones[0].id,telefoneExibicao:status.telefones[0].display_phone_number,definicao:{template_nome:template,template_idioma:idioma,espera_minutos:espera,ao_responder:aoResponder,ao_expirar:aoExpirar}})});
      setSelecionada(resultado.id);setNova(false);setRetorno(`Fluxo ativado para ${resultado.total} contatos.`);await listar();
    }catch(e){setRetorno(e instanceof Error?e.message:"Falha ao ativar campanha.")}finally{setEnviando(false)}
  }
  async function ativarRascunho(){
    if(!campanha||!confirm("Ativar este fluxo e inscrever os contatos do segmento?"))return;
    setEnviando(true);setRetorno("");
    try{const j=await consultar<{total:number}>(`/api/meta/whatsapp/campanhas/${campanha.id}/ativar`,{method:"POST"});setRetorno(`Fluxo ativado para ${j.total} contatos.`);await listar()}
    catch(e){setRetorno(e instanceof Error?e.message:"Falha ao ativar campanha.")}finally{setEnviando(false)}
  }
  return <section className="flex h-screen overflow-hidden"><aside className={`flex h-screen shrink-0 flex-col border-r border-zinc-200 transition-[width] dark:border-zinc-800 ${listaRecolhida?"w-[60px]":"w-[240px]"}`}><div className={`flex border-b border-zinc-200 p-3 dark:border-zinc-800 ${listaRecolhida?"flex-col items-center gap-1":"items-center gap-2"}`}><button title="Nova campanha" onClick={()=>{setNova(true);setSelecionada(null)}} className={`flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 py-2 text-[12px] font-medium text-white dark:bg-zinc-50 dark:text-zinc-900 ${listaRecolhida?"size-8 px-0":"min-w-0 flex-1 px-3"}`}><Send className="size-3.5"/>{!listaRecolhida&&"Nova campanha"}</button><BotaoRecolher recolhida={listaRecolhida} alternar={()=>setListaRecolhida(v=>!v)}/></div><div className="min-h-0 flex-1 overflow-y-auto p-2">{!listaRecolhida&&<p className="px-2.5 pb-2 pt-1 text-[11px] font-medium text-zinc-400">Campanhas</p>}{campanhas.map(c=><button key={c.id} onClick={()=>{setSelecionada(c.id);setNova(false)}} title={listaRecolhida?c.nome:undefined} className={`mb-0.5 w-full rounded-lg px-2.5 py-2 text-left ${c.id===selecionada&&!nova?"bg-zinc-100 dark:bg-zinc-800":"hover:bg-zinc-100 dark:hover:bg-zinc-800/60"}`}>{listaRecolhida?<MessageCircle className="mx-auto size-4 text-zinc-500"/>:<><p className="truncate text-[12px] font-medium text-zinc-900 dark:text-zinc-50">{c.nome}</p><p className="mt-0.5 truncate text-[10px] text-zinc-400">{c.segmento_nome} · {c.status}</p></>}</button>)}{!listaRecolhida&&!carregando&&!campanhas.length&&<p className="px-2.5 py-4 text-[11px] text-zinc-400">Nenhuma campanha.</p>}</div></aside>
  <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6 xl:px-10"><div className="mx-auto max-w-5xl"><header className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{nova?"Nova campanha":campanha?.nome??"Campanhas de WhatsApp"}</h2><p className="mt-1 text-[12px] text-zinc-500">{nova?"Configure o público e o template aprovado.":campanha?`${campanha.segmento_nome} · ${campanha.template_nome}`:"Selecione uma campanha para ver os dados."}</p></div><button onClick={()=>{void atualizar();void listar()}} className="rounded-lg border border-zinc-200 p-2 text-zinc-500 dark:border-zinc-800"><RefreshCw className="size-4"/></button></header>
  {erroLista?<Aviso texto={erroLista}/>:nova?<div className="mt-5 max-w-5xl space-y-4"><div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"><h3 className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">Dados da campanha</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><Campo rotulo="Nome da campanha"><input className={campo} value={nome} onChange={e=>setNome(e.target.value)} placeholder="Lançamento de setembro"/></Campo><Campo rotulo="Segmentos"><div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">{segmentos.map(s=><label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900"><input type="checkbox" checked={segmentoIds.includes(s.id)} onChange={e=>setSegmentoIds(atuais=>e.target.checked?[...atuais,s.id]:atuais.filter(id=>id!==s.id))}/><span className="min-w-0 flex-1 truncate">{s.nome}</span><span className="text-zinc-400">{s.contatos}</span></label>)}</div></Campo><Campo rotulo="Número"><div className={campo}>{status.telefones[0].verified_name} · {status.telefones[0].display_phone_number}</div></Campo></div></div><FluxoCampanha template={template} idioma={idioma} espera={espera} templates={status.templates} mudarTemplate={(nome,lingua)=>{setTemplate(nome);setIdioma(lingua)}} mudarEspera={setEspera} aoResponder={aoResponder} aoExpirar={aoExpirar} editavel tags={tags} segmentos={segmentos} funis={funis} etapas={etapas} mudarResponder={setAoResponder} mudarExpirar={setAoExpirar}/><button disabled={enviando||!nome||!segmentoIds.length||!template} onClick={()=>void disparar()} className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-[12px] font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900">{enviando?<LoaderCircle className="size-3.5 animate-spin"/>:<Send className="size-3.5"/>}Ativar fluxo</button>{retorno&&<p className="text-[11px] text-zinc-600">{retorno}</p>}</div>:campanha?<><div className="mt-5 grid gap-3 sm:grid-cols-3"><Metrica titulo="Contatos" valor={numero(String(campanha.total))}/><Metrica titulo="Aguardando resposta" valor={numero(String(campanha.aguardando))}/><Metrica titulo="Responderam" valor={numero(String(campanha.responderam))}/><Metrica titulo="Sem resposta" valor={numero(String(campanha.expiraram))}/><Metrica titulo="Conversões" valor={numero(String(campanha.conversoes))}/><Metrica titulo="Falhas" valor={numero(String(campanha.falharam))}/></div><FluxoCampanha template={campanha.definicao.template_nome||campanha.template_nome} idioma={campanha.definicao.template_idioma||campanha.template_idioma} espera={campanha.definicao.espera_minutos} aoResponder={campanha.definicao.ao_responder} aoExpirar={campanha.definicao.ao_expirar}/>{campanha.status==="rascunho"&&<button disabled={enviando} onClick={()=>void ativarRascunho()} className="mt-4 flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-[12px] font-medium text-white dark:bg-zinc-50 dark:text-zinc-900">Ativar campanha</button>}{retorno&&<p className="mt-3 text-[11px] text-zinc-600">{retorno}</p>}</>:carregando?<Vazio Icone={LoaderCircle} texto="Carregando campanhas…" girando/>:<Vazio Icone={MessageCircle} texto="Crie a primeira campanha de WhatsApp."/>}</div></div><IaCampanhas aoAplicar={()=>void listar()}/></section>;
}

function Campo({rotulo,children}:{rotulo:string;children:React.ReactNode}){return <label className="text-[11px] font-medium text-zinc-500">{rotulo}<div className="mt-1">{children}</div></label>}
function Metrica({titulo,valor}:{titulo:string;valor:string}){return <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"><p className="text-[10px] uppercase tracking-wide text-zinc-400">{titulo}</p><p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{valor}</p></div>}


