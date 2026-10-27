"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { IaResumo } from "@/lib/ia/catalogo";
import type { AutomacaoComentarioInstagram, RegraIaInstagram } from "@/lib/instagram-tipos";
import { AUTOMACAO_COMENTARIO_PADRAO } from "@/lib/instagram-automacao";
import { Bot, Loader2, X } from "@/app/components/icones";
import CamadaTopo from "../components/camada-topo";
import { salvarAutomacaoInstagram, salvarRegraIaInstagram } from "./acoes-instagram";

export function regraEfetiva(regras: RegraIaInstagram[], midiaId: string): RegraIaInstagram | null {
  return regras.find((r) => r.midiaId === midiaId) ?? regras.find((r) => r.midiaId === null) ?? null;
}

const botao = "rounded-lg px-3 py-2 text-xs font-medium hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-50 dark:hover:bg-zinc-800";
const campo = "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900";

function configuracao(regra: RegraIaInstagram | null): AutomacaoComentarioInstagram {
  return regra?.automacao ?? { ...AUTOMACAO_COMENTARIO_PADRAO, modo: "ia", continuarComIa: true };
}

export function RegraIaComentarios({ contaId, usuario, midiaId, regras, ias, podeAdministrar, demo }: {
  contaId: string; usuario: string; midiaId: string | null; regras: RegraIaInstagram[];
  ias: IaResumo[]; podeAdministrar: boolean; demo: boolean;
}) {
  const daConta = regras.find((r) => r.midiaId === null) ?? null;
  const propria = regras.find((r) => r.midiaId === midiaId) ?? null;
  const efetiva = propria ?? (midiaId !== null ? daConta : null);
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const bloqueado = demo || ocupado || !podeAdministrar;
  const origem = midiaId === null ? "Todas as postagens, menos anúncios" : propria ? "Regra desta postagem" : "Segue a conta";
  const descricao = efetiva ? configuracao(efetiva).modo === "mensagem" ? "Mensagem pronta → direct" : "IA → direct" : "Sem configuração";

  function executar(operacao: () => ReturnType<typeof salvarAutomacaoInstagram>, fechar = false) {
    if (bloqueado) return;
    setErro(null);
    iniciar(async () => {
      try {
        const resultado = await operacao();
        if (!resultado.ok) setErro(resultado.erro);
        else if (fechar) setEditando(false);
      } catch { setErro("Não consegui salvar a automação. Tente novamente."); }
    });
  }

  return <div>
    <div className="flex items-center gap-2">
      <Bot className={`size-4 shrink-0 ${efetiva?.ligada ? "text-violet-500" : "text-zinc-400"}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">Automação de comentários</p>
        <p className="text-[11px] text-zinc-500">{origem} · {efetiva?.ligada ? "Ativa" : "Desligada"} · {descricao}</p>
      </div>
      {podeAdministrar && <div className="flex flex-wrap justify-end gap-1">
        {midiaId !== null && propria && <button type="button" className={botao} disabled={bloqueado}
          onClick={() => executar(() => salvarRegraIaInstagram(contaId, midiaId, null, false))}>Seguir a conta</button>}
        {midiaId === null && propria && <button type="button" className={botao} disabled={bloqueado}
          onClick={() => executar(() => salvarRegraIaInstagram(contaId, midiaId, null, false))}>Excluir</button>}
        {efetiva?.ligada && <button type="button" className={botao} disabled={bloqueado}
          onClick={() => executar(() => salvarAutomacaoInstagram(contaId, midiaId, efetiva.iaId, false, configuracao(efetiva)))}>Desligar</button>}
        <button type="button" className={botao} disabled={bloqueado} title={demo ? "Indisponível na demonstração" : undefined}
          onClick={() => { setErro(null); setEditando(true); }}>{propria ? "Editar" : "Criar automação"}</button>
      </div>}
    </div>
    {erro && !editando && <p role="alert" className="mt-2 text-xs text-red-600">{erro}</p>}
    {editando && <EditorAutomacao usuario={usuario} midiaId={midiaId} inicial={efetiva} ias={ias} ocupado={ocupado}
      erro={erro} aoFechar={() => { if (!ocupado) { setEditando(false); setErro(null); } }}
      aoSalvar={(iaId, ligada, automacao) => executar(() => salvarAutomacaoInstagram(contaId, midiaId, iaId, ligada, automacao), true)} />}
  </div>;
}

function EditorAutomacao({ usuario, midiaId, inicial, ias, ocupado, erro, aoFechar, aoSalvar }: {
  usuario: string; midiaId: string | null; inicial: RegraIaInstagram | null; ias: IaResumo[];
  ocupado: boolean; erro: string | null; aoFechar: () => void;
  aoSalvar: (iaId: string | null, ligada: boolean, automacao: AutomacaoComentarioInstagram) => void;
}) {
  const [config, setConfig] = useState(() => configuracao(inicial));
  const [palavras, setPalavras] = useState(() => configuracao(inicial).palavras.join(", "));
  const [iaId, setIaId] = useState(inicial?.iaId ?? "");
  const [validacao, setValidacao] = useState<string | null>(null);
  const tituloId = useId();
  const painel = useRef<HTMLDivElement>(null);
  const primeiro = useRef<HTMLSelectElement>(null);
  const precisaIa = config.modo === "ia" || config.continuarComIa;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    primeiro.current?.focus();
    return () => { anterior?.focus(); };
  }, []);

  useEffect(() => {
    if (ocupado) painel.current?.focus();
  }, [ocupado]);

  function salvar(ligada: boolean) {
    if (ocupado) return;
    const lista = [...new Set(palavras.split(/[,\n]/).map((p) => p.trim()).filter(Boolean))];
    if (lista.length > 30 || lista.some((p) => p.length > 80)) { setValidacao("Use até 30 palavras ou expressões, com até 80 caracteres cada."); return; }
    if (config.modo === "mensagem" && !lista.length) { setValidacao("Informe pelo menos uma palavra ou expressão para disparar a mensagem."); return; }
    if (precisaIa && !ias.some((ia) => ia.id === iaId)) { setValidacao("Escolha uma IA para continuar."); return; }
    if (config.modo === "mensagem" && !config.mensagemDirect.trim()) { setValidacao("Escreva a mensagem do direct."); return; }
    if (config.mensagemDirect.length > 1000 || config.respostaPublica.length > 2200) { setValidacao("Revise o tamanho das mensagens."); return; }
    setValidacao(null);
    aoSalvar(precisaIa ? iaId : null, ligada, { ...config, palavras: lista });
  }

  return <CamadaTopo>
    <div className="fixed inset-0 z-[300] bg-black/40 backdrop-blur-[2px]" aria-hidden="true" onClick={() => { if (!ocupado) aoFechar(); }} />
    <div className="pointer-events-none fixed inset-0 z-[310] flex items-center justify-center p-4">
      <div ref={painel} role="dialog" aria-modal="true" aria-labelledby={tituloId} tabIndex={-1}
        onKeyDown={(evento) => {
          if (evento.key === "Escape") { evento.preventDefault(); evento.stopPropagation(); if (!ocupado) aoFechar(); }
          if (evento.key !== "Tab") return;
          const elementos = painel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex="0"]');
          if (!elementos?.length) { evento.preventDefault(); return; }
          const primeiroElemento = elementos[0], ultimo = elementos[elementos.length - 1];
          if (evento.shiftKey && (document.activeElement === primeiroElemento || document.activeElement === painel.current)) { evento.preventDefault(); ultimo.focus(); }
          else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primeiroElemento.focus(); }
        }}
        className="pointer-events-auto flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="min-h-0 overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 id={tituloId} className="font-semibold">Automação de comentários</h2>
              <p className="mt-1 text-xs text-zinc-500">@{usuario} · {midiaId === null ? "todas as postagens, menos anúncios" : "somente esta postagem"}</p></div>
            <button type="button" aria-label="Fechar" disabled={ocupado} onClick={aoFechar} className={botao}><X className="size-4" /></button>
          </div>
          <fieldset disabled={ocupado} className="mt-5 space-y-4 disabled:opacity-60">
            <label className="block text-xs font-medium">Como responder
              <select ref={primeiro} className={campo} value={config.modo} onChange={(e) => setConfig({ ...config, modo: e.target.value as AutomacaoComentarioInstagram["modo"] })}>
                <option value="ia">IA</option><option value="mensagem">Mensagem pronta</option>
              </select>
            </label>
            <label className="block text-xs font-medium">Palavras ou frases do comentário
              <textarea className={campo} rows={2} value={palavras} onChange={(e) => setPalavras(e.target.value)} placeholder="quero, saber mais" />
              <span className="mt-1 block font-normal leading-relaxed text-zinc-500">Separe por vírgula ou linha. Basta uma opção corresponder; frases são procuradas inteiras, sem diferenciar maiúsculas ou acentos. {config.modo === "ia" ? "Vazio: todos os comentários elegíveis." : "Informe pelo menos uma opção."}</span>
            </label>
            {config.modo === "mensagem" && <>
              <label className="block text-xs font-medium">Mensagem no direct
                <textarea className={campo} rows={4} maxLength={1000} value={config.mensagemDirect} onChange={(e) => setConfig({ ...config, mensagemDirect: e.target.value })} placeholder="Olá! Aqui está o link que você pediu…" />
                <span className="block text-right font-normal text-zinc-500">{config.mensagemDirect.length}/1000 · pode incluir link</span>
              </label>
              <label className="block text-xs font-medium">Resposta pública (opcional)
                <textarea className={campo} rows={2} maxLength={2200} value={config.respostaPublica} onChange={(e) => setConfig({ ...config, respostaPublica: e.target.value })} placeholder="Enviei os detalhes no seu direct!" />
                <span className="block text-right font-normal text-zinc-500">{config.respostaPublica.length}/2200</span>
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.continuarComIa} onChange={(e) => setConfig({ ...config, continuarComIa: e.target.checked })} />Continuar o atendimento com IA no direct</label>
            </>}
            {precisaIa && <label className="block text-xs font-medium">IA de atendimento
              <select className={campo} value={iaId} onChange={(e) => setIaId(e.target.value)} required>
                <option value="">Escolha uma IA</option>{ias.map((ia) => <option key={ia.id} value={ia.id}>{ia.nome}</option>)}
              </select>
              {ias.length === 0 && <span className="mt-1 block font-normal text-zinc-500">Crie uma IA no dashboard para usar este modo.</span>}
            </label>}
          </fieldset>
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">Ao ativar, esta conta responde em nome da marca e envia mensagens no direct. Confira se outro robô, como ManyChat, já responde aqui para evitar respostas duplicadas.</p>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">Vale para comentários novos na postagem, uma vez por pessoa em cada postagem. Respeita atendimento humano e IA desligada no contato. Uma regra da postagem vence a da conta. Editar não ativa automaticamente.</p>
          {(validacao || erro) && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">{validacao || erro}</p>}
        </div>
        <footer className="flex flex-wrap justify-end gap-1 border-t border-zinc-200 p-3 dark:border-zinc-800">
          <button type="button" className={botao} disabled={ocupado} onClick={aoFechar}>Cancelar</button>
          <button type="button" className={botao} disabled={ocupado} onClick={() => salvar(false)}>Salvar desligada</button>
          <button type="button" className={`${botao} inline-flex items-center gap-2 bg-violet-600 text-white hover:bg-violet-700`} disabled={ocupado} onClick={() => salvar(true)}>{ocupado && <Loader2 className="size-3 animate-spin" />}Salvar e ativar</button>
        </footer>
      </div>
    </div>
  </CamadaTopo>;
}
