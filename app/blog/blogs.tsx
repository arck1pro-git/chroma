"use client";

// Tela /blog: o CADASTRO dos blogs — criar, configurar, excluir.
//
// O trabalho do dia (ler os feeds e virar notícia em artigo) mora dentro de
// cada blog, em /blog/[id]: a notícia só faz sentido ao lado da auditoria que
// vai escrever o artigo e dos artigos que já saíram dela. Esta tela leva até
// lá; ela não é o lugar de escolher pauta.
//
// Cada blog é orientado por uma AUDITORIA — que neste sistema é um contexto
// ligado (lib/contextos.ts). Sem nenhum cadastrado não há formulário de
// criação: criar blog sem auditoria produziria um blog que não consegue gerar
// artigo nenhum, e descobrir isso só na hora de gerar é pior do que ser barrado
// aqui.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import type { Blog } from "@/lib/artigo";
import { BotaoExcluir, BotaoSalvar, Gaveta, Tag } from "./pecas";

export interface Auditoria {
  id: string;
  nome: string;
}

type Rascunho = {
  nome: string;
  auditoriaId: string;
  descricao: string;
  url_base: string;
  autor: string;
};

function deBlog(b: Blog): Rascunho {
  return {
    nome: b.nome,
    auditoriaId: b.auditoria_id ?? "",
    descricao: b.descricao ?? "",
    url_base: b.url_base ?? "",
    autor: b.autor ?? "",
  };
}

export default function Blogs() {
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [auditorias, setAuditorias] = useState<Auditoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Criação em linha, no cabeçalho: criar blog é dois campos, e um modal para
  // dois campos é cerimônia demais.
  const [nomeNovo, setNomeNovo] = useState("");
  const [auditoriaNova, setAuditoriaNova] = useState("");
  const [criando, setCriando] = useState(false);

  // O blog aberto na gaveta de configuração.
  const [aberto, setAberto] = useState<Blog | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      fetch("/api/blogs").then((r) => r.json()),
      fetch("/api/auditorias").then((r) => r.json()),
    ])
      .then(([bs, as]) => {
        if (!vivo) return;
        setBlogs(Array.isArray(bs) ? bs : []);
        setAuditorias(Array.isArray(as) ? as : []);
        if (Array.isArray(as) && as.length) setAuditoriaNova(as[0].id);
      })
      .catch(() => vivo && setErro("Não foi possível carregar os blogs."))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, []);

  async function criar() {
    const nome = nomeNovo.trim();
    if (!nome || !auditoriaNova || criando) return;
    setCriando(true);
    setErro(null);

    const r = await fetch("/api/blogs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nome, auditoriaId: auditoriaNova }),
    });
    const dados = await r.json();
    setCriando(false);

    if (!r.ok) {
      setErro(dados.error ?? "Não foi possível criar o blog.");
      return;
    }

    setBlogs((atuais) =>
      [...atuais, dados as Blog].sort((a, b) => a.nome.localeCompare(b.nome)),
    );
    setNomeNovo("");
    // Abre a configuração do blog recém-criado: endereço, autor e descrição
    // ainda estão vazios, e é isso que o próximo artigo vai usar.
    setAberto(dados as Blog);
  }

  const trocar = useCallback((b: Blog) => {
    setBlogs((atuais) =>
      atuais
        .map((x) => (x.id === b.id ? b : x))
        .sort((a, c) => a.nome.localeCompare(c.nome)),
    );
    setAberto(b);
  }, []);

  const remover = useCallback((id: number) => {
    setBlogs((atuais) => atuais.filter((b) => b.id !== id));
    setAberto(null);
  }, []);

  return (
    <div className="pagina-surge min-h-screen bg-conteudo">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        {/* ── Criação ────────────────────────────────────────────────────── */}
        {/* A tela abre direto no que se faz nela. O título e a explicação que
            moravam aqui diziam o que a própria tela mostra: os blogs estão
            logo abaixo, e a auditoria aparece em cada cartão. */}
        {!carregando && (
          <div>
            {auditorias.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 px-4 py-3 text-[12px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                Crie uma auditoria antes: é ela que orienta a linha editorial do
                blog.{" "}
                <Link href="/contextos" className="underline underline-offset-2">
                  Ir para Contextos
                </Link>
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={nomeNovo}
                  onChange={(e) => setNomeNovo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && criar()}
                  placeholder="Nome do blog"
                  className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-transparent px-4 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
                />
                <select
                  value={auditoriaNova}
                  onChange={(e) => setAuditoriaNova(e.target.value)}
                  className="rounded-full border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-700 outline-none dark:border-zinc-800 dark:text-zinc-300"
                >
                  {auditorias.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={criar}
                  disabled={criando || !nomeNovo.trim()}
                  className="rounded-full bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {criando ? "Criando…" : "Criar blog"}
                </button>
              </div>
            )}
          </div>
        )}

        {erro && (
          <p className="mt-3 text-[12px] text-red-600 dark:text-red-400">{erro}</p>
        )}

        {/* ── Lista ──────────────────────────────────────────────────────── */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {carregando
            ? [0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-36 animate-pulse rounded-2xl border border-zinc-200 dark:border-zinc-800"
                />
              ))
            : blogs.map((b) => (
                <div key={b.id} className="surge relative">
                  {/* O cartão inteiro é o link; a engrenagem fica por cima. */}
                  <Link
                    href={`/blog/${b.id}`}
                    className="flex h-36 flex-col rounded-2xl border border-zinc-200 p-4 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50"
                  >
                    <h2 className="truncate pr-8 text-[14px] font-medium text-zinc-900 dark:text-zinc-50">
                      {b.nome}
                    </h2>

                    <div className="mt-1.5">
                      {b.auditoria_nome ? (
                        <Tag>{b.auditoria_nome}</Tag>
                      ) : (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">
                          Sem auditoria
                        </span>
                      )}
                    </div>

                    <p className="mt-2 line-clamp-2 flex-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {b.descricao || b.url_base || "Sem descrição ainda."}
                    </p>

                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {b.artigos ?? 0} artigo{(b.artigos ?? 0) === 1 ? "" : "s"}
                    </span>
                  </Link>

                  <button
                    type="button"
                    onClick={() => setAberto(b)}
                    aria-label={`Configurar ${b.nome}`}
                    title="Configurar"
                    className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                  >
                    <Settings2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
        </div>

        {!carregando && blogs.length === 0 && auditorias.length > 0 && (
          <p className="mt-6 text-[12px] text-zinc-400 dark:text-zinc-500">
            Nenhum blog ainda. Crie o primeiro acima.
          </p>
        )}

      </div>

      {aberto && (
        <ConfigBlog
          key={aberto.id}
          blog={aberto}
          auditorias={auditorias}
          aoFechar={() => setAberto(null)}
          aoSalvar={trocar}
          aoExcluir={remover}
        />
      )}
    </div>
  );
}

// ── Gaveta de configuração ──────────────────────────────────────────────────

function ConfigBlog({
  blog,
  auditorias,
  aoFechar,
  aoSalvar,
  aoExcluir,
}: {
  blog: Blog;
  auditorias: Auditoria[];
  aoFechar: () => void;
  aoSalvar: (b: Blog) => void;
  aoExcluir: (id: number) => void;
}) {
  const [r, setR] = useState<Rascunho>(() => deBlog(blog));
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const muda = (campo: keyof Rascunho) => (v: string) =>
    setR((atual) => ({ ...atual, [campo]: v }));

  async function salvar() {
    setSalvando(true);
    setErro(null);

    const resposta = await fetch(`/api/blogs/${blog.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r),
    });
    const dados = await resposta.json();
    setSalvando(false);

    if (!resposta.ok) {
      setErro(dados.error ?? "Não foi possível salvar.");
      return;
    }

    aoSalvar(dados as Blog);
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2000);
  }

  async function excluir() {
    setSalvando(true);
    await fetch(`/api/blogs/${blog.id}`, { method: "DELETE" });
    aoExcluir(blog.id);
  }

  const quantos = blog.artigos ?? 0;

  return (
    <Gaveta largura="sm:w-[32rem]" aoFechar={aoFechar}>
      <header className="shrink-0 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h2 className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
          Configurar blog
        </h2>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            Nome
          </span>
          <input
            value={r.nome}
            onChange={(e) => muda("nome")(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            Auditoria
          </span>
          <select
            value={r.auditoriaId}
            onChange={(e) => muda("auditoriaId")(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none dark:border-zinc-800 dark:text-zinc-50"
          >
            <option value="">— escolha —</option>
            {auditorias.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            Orienta todo artigo deste blog.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            Endereço do blog
          </span>
          <input
            value={r.url_base}
            onChange={(e) => muda("url_base")(e.target.value)}
            placeholder="https://seusite.com.br/blog"
            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
          />
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            Monta o canonical e o breadcrumb do artigo.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            Autor padrão
          </span>
          <input
            value={r.autor}
            onChange={(e) => muda("autor")(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
          />
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            Entra no schema do artigo.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            Sobre o blog
          </span>
          <textarea
            value={r.descricao}
            onChange={(e) => muda("descricao")(e.target.value)}
            rows={4}
            className="w-full resize-y rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
          />
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            Entra no prompt de geração.
          </span>
        </label>

        {erro && (
          <p className="text-[12px] text-red-600 dark:text-red-400">{erro}</p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <BotaoExcluir
          rotulo="Excluir"
          confirmacao={`Excluir blog e ${quantos} artigo${quantos === 1 ? "" : "s"}`}
          aoConfirmar={excluir}
          ocupado={salvando}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-full px-3 py-1.5 text-[12px] text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Fechar
          </button>
          <BotaoSalvar aoSalvar={salvar} salvando={salvando} salvo={salvo} />
        </div>
      </footer>
    </Gaveta>
  );
}
