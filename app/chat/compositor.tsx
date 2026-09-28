"use client";

// Onde se escreve. O mesmo campo nos dois canais, com uma diferença que a tela
// tem que deixar óbvia: na API oficial existe a JANELA DE 24H.
//
//   · Janela aberta  → escreve normal; uma linha discreta mostra quanto falta.
//   · Janela fechada → o campo dá lugar a um aviso e ao botão de template,
//                      porque texto livre seria recusado pela Meta. Esconder o
//                      campo é melhor do que deixar digitar e falhar no envio.
import { useEffect, useRef, useState, useTransition } from "react";
import { FileText, LayoutTemplate, Loader2, Lock, Paperclip, RotateCcw, SendHorizonal, Timer, X } from "lucide-react";
import type { Documento } from "@/lib/documentos";
import type { ConversaResumo } from "./tipos";
import { duracao, restanteDaJanela, tipoDaConversa } from "./ui";

export function Compositor({
  conversa,
  documentos,
  demo,
  aoEnviar,
  aoEnviarDocumento,
  aoReabrir,
  aoTemplates,
}: {
  conversa: ConversaResumo;
  documentos: Documento[];
  demo: boolean;
  /** `erro` quando falha; `registrada` quando a falha já está na conversa. */
  aoEnviar: (texto: string) => Promise<{ erro?: string; registrada?: boolean }>;
  aoEnviarDocumento: (documentoId: string, legenda: string) => Promise<{ erro?: string; registrada?: boolean }>;
  aoReabrir: () => void;
  aoTemplates: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [anexo, setAnexo] = useState<Documento | null>(null);
  const [biblioteca, setBiblioteca] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const campo = useRef<HTMLTextAreaElement>(null);

  // O relógio da janela anda sozinho: quem está com a conversa aberta vê o
  // "fecha em" diminuir e o campo trocar por template quando zera.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Trocou de conversa: rascunho, anexo e erro eram da outra.
  const [conversaVista, setConversaVista] = useState(conversa.id);
  if (conversaVista !== conversa.id) {
    setConversaVista(conversa.id);
    setTexto("");
    setAnexo(null);
    setBiblioteca(false);
    setErro(null);
  }

  // O campo cresce com o texto até ~7 linhas.
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [texto]);

  const oficial = tipoDaConversa(conversa) === "api";
  const restante = oficial ? restanteDaJanela(conversa, agora) : Infinity;
  const janelaFechada = oficial && restante <= 0;

  function submeter() {
    if (enviando || demo) return;
    const corpo = texto;
    const doc = anexo;
    if (!doc && !corpo.trim()) return;
    setErro(null);
    setTexto("");
    setAnexo(null);
    iniciar(async () => {
      const r = doc ? await aoEnviarDocumento(doc.id, corpo) : await aoEnviar(corpo);
      if (r.erro) {
        setErro(r.erro);
        // Recusada antes de gravar: devolve o rascunho (e o anexo), para a
        // pessoa não perder o que escreveu. Gravada com erro, ela já está na
        // conversa marcada em vermelho — devolver duplicaria.
        if (!r.registrada) {
          setTexto((atual) => atual || corpo);
          if (doc) setAnexo(doc);
        }
      }
    });
    campo.current?.focus();
  }

  if (conversa.status === "encerrado") {
    return (
      <div className="flex shrink-0 items-center justify-center gap-3 border-t border-zinc-200 bg-white px-4 py-3 text-[12.5px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        Conversa encerrada.
        <button
          type="button"
          onClick={aoReabrir}
          disabled={demo}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <RotateCcw className="size-3.5" /> Reabrir para responder
        </button>
      </div>
    );
  }

  if (janelaFechada) {
    return (
      <div className="shrink-0 border-t border-zinc-200 bg-white px-3 py-3 sm:px-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-3.5 sm:flex-row sm:items-center dark:border-violet-400/20 dark:bg-violet-500/10">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 ring-1 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/20">
            <Lock className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-violet-950 dark:text-violet-100">
              {conversa.janela_ate ? "A janela de 24h fechou" : "O contato ainda não escreveu"}
            </p>
            <p className="text-[12px] leading-relaxed text-violet-900/70 dark:text-violet-200/70">
              Pela API oficial, mensagem livre só até 24h depois da última mensagem do contato. Para
              chamar agora, envie um template aprovado — a janela reabre quando ele responder.
            </p>
          </div>
          <button
            type="button"
            onClick={aoTemplates}
            disabled={demo}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-[12.5px] font-medium text-white transition hover:bg-violet-700 disabled:opacity-40"
          >
            <LayoutTemplate className="size-4" />
            Enviar template
          </button>
        </div>
        {erro && <p className="mx-auto mt-2 max-w-3xl text-[12px] text-red-600 dark:text-red-400">{erro}</p>}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white px-3 pb-3 pt-2 sm:px-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {oficial && (
          <div className="flex items-center justify-between gap-2 px-1 text-[11.5px]">
            <span
              className={`inline-flex items-center gap-1.5 ${
                restante < 3_600_000 ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              <Timer className="size-3.5" />
              Janela de 24h aberta · fecha em {duracao(restante)}
            </span>
            <button
              type="button"
              onClick={aoTemplates}
              disabled={demo}
              className="inline-flex items-center gap-1 font-medium text-violet-600 transition hover:text-violet-800 disabled:opacity-40 dark:text-violet-300 dark:hover:text-violet-100"
            >
              <LayoutTemplate className="size-3.5" /> Templates
            </button>
          </div>
        )}

        {erro && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
            <span className="min-w-0 flex-1">{erro}</span>
            <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso" className="shrink-0 opacity-70 hover:opacity-100">
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {anexo && (
          <div className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
            <FileText className="size-4 shrink-0 text-zinc-400" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-800 dark:text-zinc-100">
              {anexo.nome}
              <span className="ml-1.5 text-zinc-400">{anexo.arquivoNome}</span>
            </span>
            <button
              type="button"
              onClick={() => setAnexo(null)}
              aria-label="Tirar anexo"
              className="shrink-0 rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* A biblioteca e não upload: o arquivo entra pelo módulo Documentos,
            senão cada atendente teria a sua cópia da tabela de preços. */}
        {biblioteca && (
          <div className="veu-surge overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Biblioteca</span>
              <button type="button" onClick={() => setBiblioteca(false)} aria-label="Fechar biblioteca" className="rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                <X className="size-3.5" />
              </button>
            </div>
            {documentos.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-zinc-400">
                Nenhum documento na biblioteca. Suba os arquivos em Documentos.
              </p>
            ) : (
              <ul className="max-h-52 overflow-y-auto">
                {documentos.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setAnexo(d);
                        setBiblioteca(false);
                        campo.current?.focus();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <FileText className="size-3.5 shrink-0 text-zinc-400" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-800 dark:text-zinc-100">{d.nome}</span>
                      <span className="shrink-0 text-[10.5px] text-zinc-400">{d.arquivoNome}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setBiblioteca((v) => !v)}
            disabled={demo}
            aria-label="Anexar documento da biblioteca"
            aria-expanded={biblioteca}
            title="Anexar da biblioteca"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <Paperclip className="size-[18px]" />
          </button>
          <textarea
            ref={campo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter envia; Shift+Enter quebra linha.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submeter();
              }
            }}
            rows={1}
            disabled={demo}
            placeholder={
              demo
                ? "Demonstração — nada é enviado"
                : anexo
                  ? "Legenda do anexo (opcional)"
                  : conversa.status === "na_fila" || !conversa.responsavel_id
                    ? "Responder assume a conversa para você…"
                    : "Escreva uma mensagem"
            }
            className="max-h-[168px] min-h-10 flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-[13.5px] leading-5 text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/5 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-600"
          />
          <button
            type="button"
            onClick={submeter}
            disabled={demo || enviando || (!texto.trim() && !anexo)}
            aria-label="Enviar"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <SendHorizonal className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
