"use client";

import { useState } from "react";
import { Copy, LoaderCircle, X } from "lucide-react";
import type { LinhaAds } from "@/lib/meta-ads-tipos";
import { consultar } from "./use-consulta";
import { Aviso, botaoAds, botaoPrincipalAds, campoAds, entregaLegivel, objetivos } from "./pecas";

export default function GestaoAds({ conta, moeda, item, aoFechar, aoSalvar }: { conta: string; moeda: string; item: LinhaAds | null; aoFechar: () => void; aoSalvar: () => void }) {
  const [nome, setNome] = useState(item?.name ?? "");
  const [status, setStatus] = useState(item?.status === "ACTIVE" ? "ACTIVE" : "PAUSED");
  const [objetivo, setObjetivo] = useState("OUTCOME_LEADS");
  const [categorias, setCategorias] = useState<string[]>([]);
  const tipoOrcamento = Number(item?.daily_budget) > 0 ? "daily_budget" : Number(item?.lifetime_budget) > 0 ? "lifetime_budget" : null;
  const original = tipoOrcamento ? Number(item?.[tipoOrcamento]) / 100 : null;
  const [orcamento, setOrcamento] = useState(original?.toString() ?? "");
  const [revisao, setRevisao] = useState<"salvar" | "duplicar" | null>(null);
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState("");
  const podeOrcamento = item?.nivel !== "ad" && tipoOrcamento && moeda === "BRL";
  const alterouOrcamento = podeOrcamento && Number(orcamento) !== original;
  const temAlteracao = !item || nome.trim() !== item.name || status !== item.status || alterouOrcamento;
  async function executar() {
    setOcupado(true); setErro("");
    try {
      const base = { conta, confirmar: true };
      const entrada = revisao === "duplicar" && item ? { ...base, acao: "duplicar", id: item.id, nivel: item.nivel }
        : item ? { ...base, acao: "editar", id: item.id, nivel: item.nivel,
          ...(nome.trim() !== item.name ? { nome: nome.trim() } : {}),
          ...(status !== item.status ? { status } : {}),
          ...(alterouOrcamento ? { orcamento: Math.round(Number(orcamento) * 100), tipoOrcamento } : {}),
        } : { ...base, acao: "criar_campanha", nome: nome.trim(), objetivo, categorias };
      await consultar("/api/meta/ads/painel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entrada) });
      aoSalvar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setOcupado(false); }
  }
  return <div className="veu-surge fixed inset-0 z-[105] bg-transparent" role="presentation" onClick={() => { if (!ocupado) aoFechar(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="titulo-gestao-ads" className="ficha-entra fixed bottom-4 right-4 top-4 z-[110] flex w-[30rem] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape" && !ocupado) aoFechar(); }}>
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800"><div><h2 id="titulo-gestao-ads" className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{item ? "Gerenciar " + (item.nivel === "campaign" ? "campanha" : item.nivel === "adset" ? "conjunto" : "anúncio") : "Nova campanha"}</h2></div><button type="button" aria-label="Fechar" disabled={ocupado} onClick={aoFechar} className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"><X className="size-4" aria-hidden="true"/></button></header>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={e => { e.preventDefault(); setRevisao("salvar"); }}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {item && <p className="break-all text-xs text-zinc-500">ID {item.id} · Entrega: {entregaLegivel(item.effective_status)}</p>}
          {item?.creative && <div className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"><p className="text-xs font-medium">Criativo vinculado</p><p className="text-sm">{item.creative.title || item.creative.name || item.creative.id}</p><p className="whitespace-pre-wrap text-xs text-zinc-500">{item.creative.body}</p>{(item.creative.image_url || item.creative.thumbnail_url) && <a href={item.creative.image_url || item.creative.thumbnail_url} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-600 underline dark:text-zinc-300">Ver imagem do criativo</a>}</div>}
          <label className="block space-y-2 text-xs">Nome<input autoFocus required maxLength={200} value={nome} onChange={e => { setNome(e.target.value); setRevisao(null); }} className={campoAds}/></label>
          {item ? <label className="block space-y-2 text-xs">Status desejado<select value={status} onChange={e => { setStatus(e.target.value); setRevisao(null); }} className={campoAds}><option value="PAUSED">Pausado</option><option value="ACTIVE">Ativo</option></select><span className="block text-zinc-500">A entrega também depende do status dos níveis superiores e da aprovação da Meta.</span></label>
            : <><label className="block space-y-2 text-xs">Objetivo<select value={objetivo} onChange={e => { setObjetivo(e.target.value); setRevisao(null); }} className={campoAds}>{Object.entries(objetivos).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select></label><fieldset className="space-y-2"><legend className="mb-2 text-xs">Categorias especiais, quando aplicáveis</legend>{[["CREDIT", "Crédito"], ["EMPLOYMENT", "Emprego"], ["HOUSING", "Moradia"], ["ISSUES_ELECTIONS_POLITICS", "Questões sociais, eleições ou política"]].map(([id, nome]) => <label key={id} className="flex gap-2 text-xs"><input type="checkbox" checked={categorias.includes(id)} onChange={e => { setCategorias(atual => e.target.checked ? [...atual, id] : atual.filter(c => c !== id)); setRevisao(null); }}/>{nome}</label>)}</fieldset><p className="rounded-lg bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">A campanha será criada pausada. Conjuntos, criativos e anúncios precisam ser configurados antes de veicular.</p></>}
          {podeOrcamento && <label className="block space-y-2 text-xs">Orçamento {tipoOrcamento === "daily_budget" ? "diário" : "total"} (R$)<input required type="number" min="0.01" step="0.01" max="1000000" value={orcamento} onChange={e => { setOrcamento(e.target.value); setRevisao(null); }} className={campoAds}/></label>}
          {item?.targeting && <details className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800"><summary className="cursor-pointer">Segmentação configurada</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-500">{JSON.stringify(item.targeting, null, 2)}</pre></details>}
          {item && <button type="button" className={botaoAds} disabled={ocupado} onClick={() => setRevisao("duplicar")}><Copy className="size-3.5"/>Duplicar como pausado</button>}
          {revisao && <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-[12px] dark:border-zinc-700 dark:bg-zinc-900"><p className="font-medium">Revisar alteração</p>{revisao === "duplicar" ? <p className="text-xs">Criar uma cópia pausada de “{item?.name}”{item?.nivel !== "ad" ? " e seus itens" : ""}.</p> : <div className="space-y-1 text-xs"><p>Nome: {nome}</p><p>Status: {item ? status === "ACTIVE" ? "Ativo — pode iniciar veiculação e gastos" : "Pausado" : "Pausado"}</p>{alterouOrcamento && <p>Orçamento: R$ {original?.toFixed(2)} → R$ {Number(orcamento).toFixed(2)}</p>}</div>}<button type="button" disabled={ocupado} onClick={() => void executar()} className={botaoPrincipalAds}>{ocupado && <LoaderCircle className="size-3.5 animate-spin"/>}Confirmar e enviar à Meta</button></div>}
          {erro && <Aviso erro texto={erro}/>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800"><button type="button" className={botaoAds} disabled={ocupado} onClick={aoFechar}>Fechar</button><button type="submit" disabled={ocupado || !temAlteracao} className={botaoAds}>Revisar {item ? "alterações" : "criação"}</button></footer>
      </form>
    </section>
  </div>;
}
