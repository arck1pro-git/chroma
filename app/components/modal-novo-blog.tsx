"use client";

// Criar blog sem sair de onde se está: o modal abre por cima da tela central,
// pelo "+ Novo blog" da barra lateral.
//
// POR QUE UM MODAL, E NÃO UMA IDA A /blog: criar blog é um formulário de dois
// campos. Mandar a pessoa para a tela de cadastro só para preencher dois campos
// custa uma navegação e, no caminho de volta, o lugar onde ela estava.
//
// SÃO DOIS CAMPOS PORQUE A API EXIGE DOIS. `POST /api/blogs` recusa blog sem
// contexto (app/api/blogs/route.ts), e a regra é do servidor, não desta tela: um
// blog sem contexto não consegue gerar artigo nenhum, e descobrir isso na hora
// de gerar é pior do que ser barrado aqui.
//
// O resto do cadastro — endereço, autor, descrição, chave de publicação — fica
// em /blog, na engrenagem do cartão. Aqui entra só o que a criação não dispensa.
//
// Este componente NÃO importa nada de app/blog: a barra lateral está em todas as
// telas, e puxar as peças daquele módulo carregaria o Blog inteiro no bundle de
// quem nunca abre o Blog.
import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

/** Um contexto ligado, como /api/auditorias devolve. */
type Contexto = { id: string; nome: string };

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
  const [contextoId, setContextoId] = useState("");
  const [contextos, setContextos] = useState<Contexto[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // A lista chega depois da primeira pintura: o modal já aparece com o campo de
  // nome pronto, que é onde a pessoa vai digitar primeiro de qualquer jeito.
  //
  // `null` é "ainda buscando" e é o que segura o botão de criar. Lista vazia é
  // outra coisa — nenhum contexto cadastrado — e tem tela própria mais abaixo.
  useEffect(() => {
    let vivo = true;
    fetch("/api/auditorias")
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: unknown) => {
        if (!vivo) return;
        const limpa = Array.isArray(lista) ? (lista as Contexto[]) : [];
        setContextos(limpa);
        if (limpa.length) setContextoId(limpa[0].id);
      })
      .catch(() => {
        if (vivo) setContextos([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

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

  const podeCriar = Boolean(nome.trim() && contextoId) && !criando;

  async function criar() {
    if (!podeCriar) return;
    setCriando(true);
    setErro(null);

    try {
      const r = await fetch("/api/blogs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), auditoriaId: contextoId }),
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

  const semContexto = contextos !== null && contextos.length === 0;

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
              O contexto orienta a linha editorial de tudo que for gerado aqui.
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

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Contexto
            </span>
            <select
              value={contextoId}
              onChange={(e) => setContextoId(e.target.value)}
              disabled={contextos === null || semContexto}
              className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-950 outline-none disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-50"
            >
              {contextos === null ? (
                <option value="">Carregando…</option>
              ) : semContexto ? (
                <option value="">Nenhum contexto ligado</option>
              ) : (
                contextos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))
              )}
            </select>
          </label>

          {/* Sem contexto não há blog, e o caminho para resolver é uma tela
              adiante. Dizer só "escolha um contexto" deixaria a pessoa presa
              num seletor vazio. */}
          {semContexto && (
            <p className="rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Crie um contexto antes: é ele que orienta a linha editorial do
              blog.{" "}
              <Link
                href="/contextos"
                onClick={aoFechar}
                className="underline underline-offset-2"
              >
                Ir para Contextos
              </Link>
            </p>
          )}

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
