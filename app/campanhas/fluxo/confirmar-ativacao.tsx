"use client";

// A confirmação de ativar (ou retomar) uma campanha: TODAS as mensagens que o
// fluxo pode mandar, como saem, e tudo o que ele faz no CRM e na equipe, com
// o que cada bloco causa fora dele (a cadência da etapa que manda WhatsApp, o
// evento da Meta, outra campanha que inscreve; em âmbar, debaixo do efeito). Num
// modal do projeto, e não no window.confirm — lá não cabe ler um fluxo
// inteiro, e o clique de ativar não pode ser às cegas (ainda mais num rascunho
// que a IA montou).
import { useEffect, useId, useRef } from "react";
import type { FluxoCampanha } from "@/lib/campanhas-fluxo";
import type { TemplateWhatsApp } from "@/lib/templates-whatsapp";
import CamadaTopo from "@/app/components/camada-topo";
import { LoaderCircle, Send, TriangleAlert, X } from "@/app/components/icones";
import { botaoAds, botaoPrincipalAds } from "../pecas";
import { ICONE_DO_BLOCO } from "./aparencia";
import { revisaoDoFluxo, type OpcoesFluxo } from "./grafo";

const FOCAVEIS = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

export default function ConfirmarAtivacao({
  titulo,
  rotuloConfirmar,
  publico,
  fluxo,
  templates,
  opcoes,
  enviando,
  erro,
  aoConfirmar,
  aoCancelar,
}: {
  titulo: string;
  rotuloConfirmar: string;
  /** Segmentos, quantos contatos e o número que envia, numa linha. */
  publico: string;
  fluxo: FluxoCampanha;
  templates: TemplateWhatsApp[];
  opcoes: OpcoesFluxo;
  enviando: boolean;
  erro: string;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  const { mensagens, efeitos } = revisaoDoFluxo(fluxo, templates, opcoes);
  const tituloId = useId();
  const painel = useRef<HTMLDivElement>(null);
  const cancelar = useRef<HTMLButtonElement>(null);

  // O foco começa no Cancelar (Enter não ativa por engano) e volta para onde
  // estava quando o modal fecha.
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    cancelar.current?.focus();
    return () => anterior?.focus();
  }, []);

  function fechar() {
    if (!enviando) aoCancelar();
  }

  return (
    <CamadaTopo>
      <div className="veu-surge fixed inset-0 z-[300] bg-black/40 backdrop-blur-[2px]" aria-hidden="true" onClick={fechar} />
      <div className="pointer-events-none fixed inset-0 z-[310] flex items-center justify-center p-4">
        <div
          ref={painel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={tituloId}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              fechar();
            }
            if (e.key !== "Tab") return;
            const itens = painel.current?.querySelectorAll<HTMLElement>(FOCAVEIS);
            if (!itens?.length) return;
            const primeiro = itens[0];
            const ultimo = itens[itens.length - 1];
            if (e.shiftKey && document.activeElement === primeiro) {
              e.preventDefault();
              ultimo.focus();
            } else if (!e.shiftKey && document.activeElement === ultimo) {
              e.preventDefault();
              primeiro.focus();
            }
          }}
          className="veu-surge pointer-events-auto flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
        >
          <div className="flex items-start gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <div className="min-w-0 flex-1">
              <h2 id={tituloId} className="text-[15px] font-semibold tracking-tight">
                {titulo}
              </h2>
              <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{publico}</p>
            </div>
            <button
              type="button"
              onClick={fechar}
              disabled={enviando}
              aria-label="Fechar"
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {/* "Podem": cada contato recebe só as do caminho que tomar. */}
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Mensagens que podem sair ({mensagens.length})
            </h3>
            <ol className="mt-2 space-y-3">
              {mensagens.map((m) => {
                const Icone = ICONE_DO_BLOCO[m.tipo];
                return (
                  <li key={m.blocoId} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      <Icone className="size-3" aria-hidden="true" />
                      {m.titulo}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-zinc-800 dark:text-zinc-100">{m.texto}</p>
                  </li>
                );
              })}
            </ol>

            {efeitos.length > 0 && (
              <>
                <h3 className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">O que mais acontece</h3>
                <ul className="mt-2 space-y-1.5">
                  {efeitos.map((e) => {
                    const Icone = ICONE_DO_BLOCO[e.tipo];
                    return (
                      <li key={e.blocoId} className="flex items-start gap-2 text-[12.5px] leading-snug text-zinc-700 dark:text-zinc-200">
                        <Icone className="mt-0.5 size-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
                        <div className="min-w-0">
                          <span className="break-words">{e.texto}</span>
                          {/* O que o bloco causa fora dele: mensagem que sai por outro caminho, evento na Meta. */}
                          {e.consequencias.map((c) => (
                            <p key={c} className="mt-1 flex items-start gap-1.5 text-[12px] text-amber-800 dark:text-amber-300">
                              <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                              <span className="break-words">{c}</span>
                            </p>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {erro && (
              <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                {erro}
              </p>
            )}
          </div>

          <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <button ref={cancelar} type="button" onClick={fechar} disabled={enviando} className={botaoAds}>
              Cancelar
            </button>
            <button type="button" onClick={aoConfirmar} disabled={enviando} className={botaoPrincipalAds}>
              {enviando ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Send className="size-3.5" aria-hidden="true" />}
              {rotuloConfirmar}
            </button>
          </footer>
        </div>
      </div>
    </CamadaTopo>
  );
}
