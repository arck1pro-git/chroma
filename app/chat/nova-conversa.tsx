"use client";

// Começar uma conversa: quem (contato) e POR QUAL NÚMERO.
//
// O número é escolha explícita, e vem marcado com o canal aberto na tela. Sem
// isso a conversa nascia sem número quando havia mais de uma instância, e o
// primeiro envio não sabia por onde sair.
import { useEffect, useState, useTransition } from "react";
import { Loader2, MessageSquarePlus, Search, X } from "lucide-react";
import { buscarContatos, iniciarConversa, type ContatoBusca } from "./actions";
import type { CanalChat } from "./tipos";
import { Avatar, ESTADO, PAPEL, formatarTelefone } from "./ui";

export function NovaConversa({
  canais,
  canalAtual,
  aoFechar,
  aoCriada,
}: {
  canais: CanalChat[];
  canalAtual: string;
  aoFechar: () => void;
  aoCriada: (atendimentoId: string, canal: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [contatos, setContatos] = useState<ContatoBusca[] | null>(null);
  const [contato, setContato] = useState<ContatoBusca | null>(null);
  const [canal, setCanal] = useState(
    () => canalAtual || canais.find((c) => c.tipo === "web" && c.estado === "conectado")?.chave || canais[0]?.chave || "",
  );
  const [erro, setErro] = useState<string | null>(null);
  const [criando, iniciar] = useTransition();

  // Busca com um respiro de 250 ms: digitar "mariana" não vira sete consultas.
  useEffect(() => {
    let vivo = true;
    const id = setTimeout(() => {
      buscarContatos(busca).then((r) => vivo && setContatos(r)).catch(() => vivo && setContatos([]));
    }, busca ? 250 : 0);
    return () => {
      vivo = false;
      clearTimeout(id);
    };
  }, [busca]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [aoFechar]);

  const escolhido = canais.find((c) => c.chave === canal);

  function criar() {
    if (!contato || !canal) return;
    setErro(null);
    iniciar(async () => {
      const r = await iniciarConversa(contato.id, canal);
      if (r.erro || !r.id) setErro(r.erro ?? "Não consegui abrir a conversa.");
      else aoCriada(r.id, canal);
    });
  }

  return (
    <div
      className="veu-surge fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[1px] sm:items-center sm:p-4"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label="Nova conversa"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl sm:h-[76vh] sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            <MessageSquarePlus className="size-4" />
          </span>
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Nova conversa</h2>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
            <X className="size-4" />
          </button>
        </header>

        {/* 1. Por qual número */}
        <div className="shrink-0 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Sai pelo número</p>
          {canais.length === 0 ? (
            <p className="text-[12.5px] text-zinc-500">Nenhum número conectado. Pareie um em Configurações.</p>
          ) : (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              {canais.map((c) => {
                const ativo = c.chave === canal;
                const papel = PAPEL[c.tipo];
                return (
                  <button
                    key={c.chave}
                    type="button"
                    onClick={() => setCanal(c.chave)}
                    aria-pressed={ativo}
                    className={`flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                      ativo
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <Avatar nome={c.perfil ?? c.nome} src={c.foto} tamanho={26}>
                      <span className={`absolute -bottom-px -right-px size-2 rounded-full ring-2 ring-white dark:ring-zinc-950 ${ESTADO[c.estado].ponto}`} />
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block max-w-32 truncate text-[12.5px] font-medium">{c.nome}</span>
                      <span className={`flex items-center gap-1 text-[10.5px] ${ativo ? "opacity-70" : "text-zinc-500"}`}>
                        <papel.Icone className="size-2.5" /> {papel.rotulo}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {escolhido?.tipo === "api" && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-violet-700 dark:text-violet-300">
              Pela API oficial, o primeiro contato é sempre um template aprovado. A conversa abre e o seletor de
              templates fica logo embaixo.
            </p>
          )}
          {escolhido && escolhido.estado !== "conectado" && escolhido.tipo === "web" && (
            <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-400">
              Este número está {ESTADO[escolhido.estado].rotulo.toLowerCase()} — o envio vai falhar até reconectar.
            </p>
          )}
        </div>

        {/* 2. Com quem */}
        <div className="shrink-0 px-5 pt-3.5">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Com quem</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              aria-label="Buscar contato"
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome, e-mail ou telefone"
              autoFocus
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-8 pr-2.5 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {contatos === null ? (
            <li className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-zinc-400" />
            </li>
          ) : contatos.length === 0 ? (
            <li className="px-3 py-10 text-center text-[12.5px] text-zinc-500">Nenhum contato encontrado.</li>
          ) : (
            contatos.map((c) => {
              const semNumero = !c.whatsapp;
              const ativo = contato?.id === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setContato(c)}
                    disabled={semNumero}
                    aria-pressed={ativo}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition disabled:opacity-45 ${
                      ativo ? "bg-zinc-100 ring-1 ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-700" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <Avatar nome={c.nome} tamanho={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{c.nome}</span>
                      <span className="block truncate text-[11.5px] text-zinc-500 dark:text-zinc-400">
                        {semNumero ? "Sem WhatsApp cadastrado" : formatarTelefone(c.whatsapp)}
                        {c.email ? ` · ${c.email}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <p className="min-w-0 truncate text-[12px] text-red-600 dark:text-red-400">{erro}</p>
          <button
            type="button"
            onClick={criar}
            disabled={!contato || !canal || criando}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {criando && <Loader2 className="size-4 animate-spin" />}
            Abrir conversa
          </button>
        </footer>
      </div>
    </div>
  );
}
