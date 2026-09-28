"use client";

// Escolher e mandar um template da API oficial, de dentro da conversa.
//
// À esquerda os aprovados do número desta conversa; à direita a prévia como o
// contato vai ler, com um campo por variável ({{1}}, {{2}}…). O texto da
// prévia é montado com o que está sendo digitado — é a melhor revisão possível
// antes de mandar algo que não dá para editar depois.
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, LayoutTemplate, Loader2, Lock, Search, SendHorizonal, X } from "lucide-react";
import { enviarTemplate, listarTemplates } from "./actions";
import type { TemplateChat } from "./tipos";
import { TextoWhatsApp } from "./ui";

const preencher = (texto: string, valores: string[]) =>
  texto.replace(/\{\{(\d+)\}\}/g, (bruto, n) => {
    const v = valores[Number(n) - 1]?.trim();
    return v ? v : bruto;
  });

const CATEGORIA: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

export function SeletorTemplates({
  atendimentoId,
  nomeContato,
  aoFechar,
  aoEnviado,
}: {
  atendimentoId: string;
  nomeContato: string;
  aoFechar: () => void;
  aoEnviado: () => void;
}) {
  const [templates, setTemplates] = useState<TemplateChat[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<TemplateChat | null>(null);
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [corpo, setCorpo] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  useEffect(() => {
    let vivo = true;
    listarTemplates(atendimentoId).then((r) => {
      if (!vivo) return;
      if (r.erro) setErroLista(r.erro);
      else setTemplates(r.templates ?? []);
    });
    return () => {
      vivo = false;
    };
  }, [atendimentoId]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [aoFechar]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!templates) return [];
    return t ? templates.filter((x) => x.nome.toLowerCase().includes(t) || x.corpo.toLowerCase().includes(t)) : templates;
  }, [templates, busca]);

  function escolher(t: TemplateChat) {
    setEscolhido(t);
    setErro(null);
    // O primeiro campo do corpo quase sempre é o nome — já vem preenchido.
    const primeiroNome = nomeContato.split(/\s+/)[0] ?? "";
    setCabecalho(Array.from({ length: t.variaveisCabecalho }, () => ""));
    setCorpo(Array.from({ length: t.variaveisCorpo }, (_, i) => (i === 0 && !/^\d/.test(primeiroNome) ? primeiroNome : "")));
  }

  const completo =
    escolhido !== null &&
    !escolhido.bloqueio &&
    cabecalho.every((v) => v.trim()) &&
    corpo.every((v) => v.trim());

  function enviar() {
    if (!escolhido || !completo) return;
    setErro(null);
    iniciar(async () => {
      const r = await enviarTemplate(atendimentoId, escolhido.nome, escolhido.idioma, { cabecalho, corpo });
      if (r.erro) setErro(r.erro);
      else aoEnviado();
    });
  }

  return (
    <div
      className="veu-surge fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[1px] sm:items-center sm:p-4"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label="Enviar template"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl sm:h-[80vh] sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <span className="flex size-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
            <LayoutTemplate className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Enviar template</h2>
            <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">Para {nomeContato} · só aparecem os aprovados pela Meta</p>
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Lista */}
          <div className={`min-h-0 w-full flex-col border-r border-zinc-200 sm:flex sm:w-72 sm:shrink-0 dark:border-zinc-800 ${escolhido ? "hidden" : "flex"}`}>
            <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
                <input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar template"
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-8 pr-2.5 text-[13px] outline-none focus:border-zinc-400 focus:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {erroLista ? (
                <li className="px-3 py-8 text-center text-[12.5px] text-red-600 dark:text-red-400">{erroLista}</li>
              ) : templates === null ? (
                <li className="flex justify-center py-10">
                  <Loader2 className="size-5 animate-spin text-zinc-400" />
                </li>
              ) : filtrados.length === 0 ? (
                <li className="px-3 py-8 text-center text-[12.5px] text-zinc-500">
                  {templates.length === 0 ? "Nenhum template aprovado neste número. Crie em Templates." : "Nada com esse nome."}
                </li>
              ) : (
                filtrados.map((t) => (
                  <li key={`${t.nome}|${t.idioma}`}>
                    <button
                      type="button"
                      onClick={() => escolher(t)}
                      aria-current={escolhido?.nome === t.nome && escolhido.idioma === t.idioma ? "true" : undefined}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition ${
                        escolhido?.nome === t.nome && escolhido.idioma === t.idioma
                          ? "bg-violet-50 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:ring-violet-400/20"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      } ${t.bloqueio ? "opacity-60" : ""}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[12px] font-medium text-zinc-900 dark:text-zinc-50">{t.nome}</span>
                        <span className="shrink-0 text-[10px] text-zinc-400">{t.idioma}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">{t.corpo}</span>
                      <span className="mt-1.5 flex items-center gap-1.5">
                        <span className="rounded-full bg-zinc-100 px-1.5 py-px text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {CATEGORIA[t.categoria] ?? t.categoria}
                        </span>
                        {t.bloqueio && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
                            <Lock className="size-2.5" /> só por Campanhas
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          {/* Prévia e variáveis */}
          <div className={`min-h-0 flex-1 flex-col sm:flex ${escolhido ? "flex" : "hidden"}`}>
            {!escolhido ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
                <LayoutTemplate className="size-8 text-zinc-300 dark:text-zinc-700" />
                <p className="text-[13px] text-zinc-500">Escolha um template para ver como ele chega.</p>
              </div>
            ) : (
              <>
                <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
                  <button
                    type="button"
                    onClick={() => setEscolhido(null)}
                    className="-mt-1 inline-flex items-center gap-1 self-start text-[12px] text-zinc-500 sm:hidden"
                  >
                    <ArrowLeft className="size-3.5" /> Templates
                  </button>

                  {/* Como o contato vai ler */}
                  <div className="rounded-2xl bg-zinc-100 p-4 dark:bg-zinc-900/60">
                    <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Prévia</p>
                    <div className="ml-auto max-w-sm rounded-2xl rounded-tr-md bg-violet-50 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-violet-950 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-50 dark:ring-violet-400/25">
                      {escolhido.cabecalho !== null && (
                        <p className="mb-1 font-semibold">{preencher(escolhido.cabecalho, cabecalho)}</p>
                      )}
                      <p className="whitespace-pre-wrap break-words">
                        <TextoWhatsApp texto={preencher(escolhido.corpo, corpo)} link="text-sky-600" />
                      </p>
                      {escolhido.rodape && <p className="mt-1.5 text-[11.5px] text-violet-900/60 dark:text-violet-200/60">{escolhido.rodape}</p>}
                      {escolhido.botoes.length > 0 && (
                        <div className="mt-2.5 flex flex-col gap-1 border-t border-violet-200/70 pt-2 dark:border-violet-400/20">
                          {escolhido.botoes.map((b) => (
                            <span key={b} className="text-center text-[12.5px] font-medium text-sky-600 dark:text-sky-400">{b}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {escolhido.bloqueio ? (
                    <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                      <Lock className="mt-0.5 size-3.5 shrink-0" />
                      {escolhido.bloqueio}
                    </p>
                  ) : (
                    (cabecalho.length > 0 || corpo.length > 0) && (
                      <div className="flex flex-col gap-3">
                        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Variáveis</p>
                        {cabecalho.map((v, i) => (
                          <Campo key={`c${i}`} rotulo={`Cabeçalho {{${i + 1}}}`} valor={v} aoMudar={(x) => setCabecalho((a) => a.map((y, j) => (j === i ? x : y)))} />
                        ))}
                        {corpo.map((v, i) => (
                          <Campo key={`b${i}`} rotulo={`{{${i + 1}}}`} valor={v} aoMudar={(x) => setCorpo((a) => a.map((y, j) => (j === i ? x : y)))} />
                        ))}
                      </div>
                    )
                  )}
                </div>

                <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
                  <p className="min-w-0 text-[12px] text-red-600 dark:text-red-400">{erro}</p>
                  <button
                    type="button"
                    onClick={enviar}
                    disabled={!completo || enviando}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-violet-700 disabled:opacity-40"
                  >
                    {enviando ? <Loader2 className="size-4 animate-spin" /> : <SendHorizonal className="size-4" />}
                    Enviar template
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Campo({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11.5px] text-zinc-500">{rotulo}</span>
      <input
        type="text"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      />
    </label>
  );
}
