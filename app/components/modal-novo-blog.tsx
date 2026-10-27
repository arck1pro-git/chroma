"use client";

// Criar blog sem sair de onde se está: o modal abre por cima da tela central,
// pelo "+ Novo blog" da barra lateral.
//
import { useEffect, useState } from "react";
import { X } from "./icones";

/** O que a barra precisa saber do blog recém-criado. */
export type BlogCriado = { id: number; nome: string };

export default function ModalNovoBlog({
  aoFechar,
  aoCriar,
}: {
  aoFechar: () => void;
  /** Chamado com o blog salvo, para a barra listar sem recarregar a rota. */
  aoCriar: (blog: BlogCriado) => void;
}) {
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Esc fecha, como em todo modal do app. Não fecha no meio de uma criação: o
  // POST já saiu, e sumir com a tela deixaria a pessoa sem saber se o blog
  // nasceu.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !criando) aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, criando]);

  const podeCriar = Boolean(nome.trim()) && !criando;

  async function criar() {
    if (!podeCriar) return;
    setCriando(true);
    setErro(null);

    try {
      const r = await fetch("/api/blogs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome: nome.trim() }),
      });
      const dados = await r.json();

      if (!r.ok) {
        setErro(dados?.error ?? "Não foi possível criar o blog.");
        setCriando(false);
        return;
      }

      // Quem fecha o modal é quem chamou: a barra usa o mesmo retorno para
      // inserir o item na lista e para navegar até o blog novo.
      aoCriar({ id: dados.id as number, nome: dados.nome as string });
    } catch {
      setErro("Não foi possível criar o blog.");
      setCriando(false);
    }
  }

  return (
    <>
      <div
        className="veu-surge fixed inset-0 z-40 bg-zinc-900/30 dark:bg-black/50"
        onClick={() => !criando && aoFechar()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Novo blog"
        className="surge fixed left-1/2 top-1/2 z-50 flex w-[min(26rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-200 bg-conteudo shadow-xl dark:border-zinc-800"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-[14px] font-semibold text-zinc-950 dark:text-zinc-50">
              Novo blog
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              Crie o blog e configure sua descrição, autor e endereço.
            </p>
          </div>

          <button
            type="button"
            onClick={aoFechar}
            disabled={criando}
            aria-label="Fechar"
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-950 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Nome
            </span>
            <input
              // O foco nasce aqui: o modal abriu porque a pessoa clicou em
              // "Novo blog", e o primeiro gesto dela é digitar o nome.
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              placeholder="Nome do blog"
              maxLength={200}
              className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
            />
          </label>

          {erro && (
            <p className="text-[12px] text-red-600 dark:text-red-400">{erro}</p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={aoFechar}
            disabled={criando}
            className="rounded-full px-4 py-2 text-[13px] font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={criar}
            disabled={!podeCriar}
            className="rounded-full bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {criando ? "Criando…" : "Criar blog"}
          </button>
        </footer>
      </div>
    </>
  );
}
