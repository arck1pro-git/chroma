"use client";

// Tela /blog: os blogs, cada um num cartão com o que pede atenção — quantos
// artigos esperam revisão, quantos estão no ar e se o blog está na automação.
// O clique entra no blog (/blog/[id]); a engrenagem abre a mesma gaveta de
// configuração da tela do blog (./[id]/gaveta-blog.tsx).
//
// A barra lateral também lista os blogs (sanfona do Blog); esta tela é a visão
// de todos lado a lado e o lugar de criar.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Blog } from "@/lib/artigo";
import { urlComparavel } from "@/lib/blog-google-tipos";
import { Newspaper, Plus, Settings2 } from "@/app/components/icones";
import { mensagemDeErro } from "./pecas";
import GavetaBlog from "./[id]/gaveta-blog";

export default function Blogs({
  iniciais,
  base,
  basePublica,
  pode,
}: {
  iniciais: Blog[];
  base: string;
  basePublica: boolean;
  pode: { criar: boolean; editar: boolean; excluir: boolean };
}) {
  const router = useRouter();
  const [blogs, setBlogs] = useState(iniciais);
  const [nomeNovo, setNomeNovo] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Blog | null>(null);

  async function criar() {
    const nome = nomeNovo.trim();
    if (!nome || criando) return;
    setCriando(true);
    setErro(null);
    const r = await fetch("/api/blogs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nome }),
    }).catch(() => null);
    const dados = await r?.json().catch(() => null);
    setCriando(false);
    if (!r?.ok) {
      setErro(mensagemDeErro(dados, "Não foi possível criar o blog."));
      return;
    }
    // Entra no blog novo: endereço, descrição e fontes ainda estão vazios, e é
    // de lá (Configurar e Automação) que se completa.
    router.push(`/blog/${(dados as Blog).id}`);
  }

  return (
    <div className="pagina-surge min-h-screen bg-conteudo">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 @container md:px-6 tela-baixa:py-4">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Blogs</h1>
            <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">
              Os artigos nascem das notícias, passam pela revisão e vão para o site.
            </p>
          </div>
          {pode.criar && (
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <input
                value={nomeNovo}
                onChange={(e) => setNomeNovo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && criar()}
                placeholder="Nome do novo blog"
                maxLength={200}
                className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-transparent px-4 py-1.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 sm:w-60 sm:flex-none dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
              />
              <button
                type="button"
                onClick={criar}
                disabled={criando || !nomeNovo.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Plus className="size-3" aria-hidden="true" />
                {criando ? "Criando…" : "Criar blog"}
              </button>
            </div>
          )}
        </header>

        {erro && <p className="mt-3 text-[12px] text-red-600 dark:text-red-400">{erro}</p>}

        {blogs.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
            <Newspaper className="size-6 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
            <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">Nenhum blog ainda</p>
            <p className="max-w-sm text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Crie o primeiro acima. Depois é dar o endereço do site, uma descrição do tema e escolher as fontes de notícia.
            </p>
          </div>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {blogs.map((b, i) => (
              <CartaoBlog key={b.id} blog={b} ordem={i} podeConfigurar={pode.editar || pode.excluir} aoConfigurar={() => setAberto(b)} />
            ))}
          </ul>
        )}
      </div>

      {aberto && (
        <GavetaBlog
          key={aberto.id}
          blog={aberto}
          base={base}
          basePublica={basePublica}
          pode={pode}
          aoFechar={() => setAberto(null)}
          aoSalvar={(b) => {
            setBlogs((xs) => xs.map((x) => (x.id === b.id ? { ...x, ...b } : x)).sort((a, c) => a.nome.localeCompare(c.nome)));
            setAberto((x) => (x ? { ...x, ...b } : x));
          }}
          aoExcluir={(id) => {
            setBlogs((xs) => xs.filter((x) => x.id !== id));
            setAberto(null);
          }}
        />
      )}
    </div>
  );
}

function CartaoBlog({
  blog,
  ordem,
  podeConfigurar,
  aoConfigurar,
}: {
  blog: Blog;
  ordem: number;
  podeConfigurar: boolean;
  aoConfigurar: () => void;
}) {
  const emRevisao = blog.em_revisao ?? 0;
  const postados = (blog.artigos ?? 0) - emRevisao;

  return (
    <li className="surge relative" style={{ animationDelay: `${ordem * 26}ms` }}>
      <Link
        href={`/blog/${blog.id}`}
        className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
      >
        <div className="flex items-start gap-3 pr-8">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-[15px] font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
            {blog.nome.trim().charAt(0).toUpperCase() || "B"}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">{blog.nome}</h2>
            <p className={`truncate text-[12px] ${blog.url_base ? "text-zinc-500 dark:text-zinc-400" : "text-amber-700 dark:text-amber-400"}`}>
              {blog.url_base ? urlComparavel(blog.url_base) : "Sem endereço do site"}
            </p>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 flex-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {blog.descricao || "Sem descrição. A IA usa a descrição para escolher as notícias e dar o ângulo dos artigos."}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span
            className={`rounded-full px-2 py-0.5 font-medium tabular-nums ${
              emRevisao > 0
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {emRevisao} em revisão
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium tabular-nums text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {postados} postado{postados === 1 ? "" : "s"}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
            <span className={`size-1.5 rounded-full ${blog.rss_ativo ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`} aria-hidden="true" />
            {blog.rss_ativo ? "Na automação" : (blog.feeds ?? 0) === 0 ? "Sem fontes" : "Fora da automação"}
          </span>
        </div>
      </Link>

      {podeConfigurar && (
        <button
          type="button"
          onClick={aoConfigurar}
          aria-label={`Configurar ${blog.nome}`}
          title="Configurar"
          className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <Settings2 className="size-4" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}
