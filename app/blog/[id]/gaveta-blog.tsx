"use client";

// A configuração do blog numa gaveta: os dados que orientam a IA e o site, e a
// conexão com o site (a URL que o site consome).
//
// UM LUGAR SÓ (2026-11-05): antes, nome e descrição ficavam numa gaveta da
// lista de blogs, e a URL de conexão num balão da tela do blog. São a mesma
// pergunta — "como este blog está configurado?" — e agora abrem do mesmo botão,
// aqui e na lista de blogs.
//
// A DESCRIÇÃO É O CAMPO QUE MAIS PESA: é ela que a IA lê para escolher as
// notícias da automação (lib/blog-curadoria.ts) e para dar o ângulo do artigo
// (lib/artigo-geracao.ts). Por isso o texto de ajuda dela é o mais longo.
//
// A CHAVE DA CONEXÃO É O SEGREDO E FICA VISÍVEL: quem configura o site precisa
// copiá-la. O que existe é o botão de trocar, para quando ela vazar — e ele
// avisa que a URL antiga morre na hora.
import { useEffect, useRef, useState } from "react";
import type { Blog } from "@/lib/artigo";
import { promptDeImplementacao, urlDeConexao } from "@/lib/blog-conexao";
import { Check, Copy, RefreshCw, X } from "@/app/components/icones";
import { CascaGaveta } from "@/app/components/gaveta";
import { BotaoExcluir, BotaoSalvar, mensagemDeErro } from "../pecas";

type Rascunho = Pick<Blog, "nome" | "descricao" | "url_base" | "autor">;

export type FocoDaGaveta = "descricao" | "url_base" | null;

export default function GavetaBlog({
  blog,
  base,
  basePublica,
  pode,
  foco,
  demo,
  aoFechar,
  aoSalvar,
  aoExcluir,
}: {
  blog: Blog;
  /** Endereço deste CRM, do request (lib/endereco.ts). Sem barra no fim. */
  base: string;
  /** false em localhost/rede local: a URL existe, mas não sai daqui. */
  basePublica: boolean;
  pode: { editar: boolean; excluir: boolean };
  /** O campo a destacar quando a gaveta abre de um aviso ("escreva a descrição"). */
  foco?: FocoDaGaveta;
  demo?: boolean;
  aoFechar: () => void;
  aoSalvar: (b: Blog) => void;
  aoExcluir: (id: number) => void;
}) {
  const [r, setR] = useState<Rascunho>({
    nome: blog.nome,
    descricao: blog.descricao ?? "",
    url_base: blog.url_base ?? "",
    autor: blog.autor ?? "",
  });
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const descricaoRef = useRef<HTMLTextAreaElement>(null);
  const enderecoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  useEffect(() => {
    const alvo = foco === "descricao" ? descricaoRef.current : foco === "url_base" ? enderecoRef.current : null;
    alvo?.focus();
  }, [foco]);

  const muda = (campo: keyof Rascunho) => (v: string) => setR((atual) => ({ ...atual, [campo]: v }));

  async function salvar() {
    setErro(null);
    if (demo) {
      aoSalvar({ ...blog, ...r });
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2000);
      return;
    }
    setSalvando(true);
    const resposta = await fetch(`/api/blogs/${blog.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r),
    }).catch(() => null);
    const dados = await resposta?.json().catch(() => null);
    setSalvando(false);
    if (!resposta?.ok) {
      setErro(mensagemDeErro(dados, "Não foi possível salvar."));
      return;
    }
    aoSalvar(dados as Blog);
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2000);
  }

  async function excluir() {
    if (demo) return aoExcluir(blog.id);
    setSalvando(true);
    const resposta = await fetch(`/api/blogs/${blog.id}`, { method: "DELETE" }).catch(() => null);
    setSalvando(false);
    if (!resposta?.ok) {
      setErro(mensagemDeErro(await resposta?.json().catch(() => null), "Não foi possível excluir."));
      return;
    }
    aoExcluir(blog.id);
  }

  const quantos = blog.artigos ?? 0;
  const leitura = !pode.editar;
  const classeCampo =
    "w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 disabled:opacity-70 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600";

  return (
    <CascaGaveta rotulo="Configurar blog" largura="w-[34rem]" aoFechar={aoFechar}>
      <header className="flex shrink-0 items-start gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">Configurar blog</h2>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{blog.nome}</p>
        </div>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar"
          className="flex size-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        <section className="flex flex-col gap-4">
          <Rotulo titulo="Nome">
            <input value={r.nome} onChange={(e) => muda("nome")(e.target.value)} disabled={leitura} maxLength={200} className={classeCampo} />
          </Rotulo>

          <Rotulo titulo="Sobre o blog" ajuda="A IA lê este texto para escolher as notícias da automação e para dar o ângulo de cada artigo. Diga o tema, o público e o que o blog quer que o leitor faça.">
            <textarea
              ref={descricaoRef}
              value={r.descricao}
              onChange={(e) => muda("descricao")(e.target.value)}
              disabled={leitura}
              rows={5}
              placeholder="Ex.: blog da AMAAN sobre investimento imobiliário em SCP para quem tem de R$ 50 mil a R$ 1 milhão…"
              className={`${classeCampo} resize-y leading-relaxed ${foco === "descricao" ? "ring-2 ring-amber-300 dark:ring-amber-700" : ""}`}
            />
          </Rotulo>

          <Rotulo titulo="Endereço do blog" ajuda="Monta o link de cada artigo e diz ao Search Console qual é o site.">
            <input
              ref={enderecoRef}
              value={r.url_base}
              onChange={(e) => muda("url_base")(e.target.value)}
              disabled={leitura}
              placeholder="https://seusite.com.br/blog"
              className={`${classeCampo} font-mono text-[12px] ${foco === "url_base" ? "ring-2 ring-amber-300 dark:ring-amber-700" : ""}`}
            />
          </Rotulo>

          <Rotulo titulo="Autor" ajuda="A assinatura que vai nos dados estruturados de cada artigo.">
            <input value={r.autor} onChange={(e) => muda("autor")(e.target.value)} disabled={leitura} maxLength={200} className={classeCampo} />
          </Rotulo>

          {erro && <p className="text-[12px] text-red-600 dark:text-red-400">{erro}</p>}
        </section>

        <Conexao blog={blog} base={base} basePublica={basePublica} podeTrocar={pode.editar && !demo} aoTrocarChave={aoSalvar} />
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
        {pode.excluir ? (
          <BotaoExcluir
            rotulo="Excluir blog"
            confirmacao={`Excluir o blog e ${quantos} artigo${quantos === 1 ? "" : "s"}`}
            aoConfirmar={excluir}
            ocupado={salvando}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-full px-3 py-1.5 text-[12px] text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Fechar
          </button>
          {pode.editar && <BotaoSalvar aoSalvar={salvar} salvando={salvando} salvo={salvo} />}
        </div>
      </footer>
    </CascaGaveta>
  );
}

function Rotulo({ titulo, ajuda, children }: { titulo: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{titulo}</span>
      {children}
      {ajuda && <span className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{ajuda}</span>}
    </label>
  );
}

// ── Conexão com o site ──────────────────────────────────────────────────────

function Conexao({
  blog,
  base,
  basePublica,
  podeTrocar,
  aoTrocarChave,
}: {
  blog: Blog;
  base: string;
  basePublica: boolean;
  podeTrocar: boolean;
  aoTrocarChave: (b: Blog) => void;
}) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [armado, setArmado] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const url = urlDeConexao(base, blog.chave);

  async function copiar(qual: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      setErro("O navegador bloqueou a cópia.");
    }
  }

  async function trocar() {
    setTrocando(true);
    setErro(null);
    const r = await fetch(`/api/blogs/${blog.id}/chave`, { method: "POST" }).catch(() => null);
    const dados = await r?.json().catch(() => null);
    setTrocando(false);
    setArmado(false);
    if (!r?.ok) {
      setErro(mensagemDeErro(dados, "Não foi possível trocar a chave."));
      return;
    }
    aoTrocarChave(dados as Blog);
  }

  return (
    <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Conexão com o site</h3>
      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        O site lê os artigos postados por esta URL. Só o que está em Postado sai nela.
      </p>

      <div className="mt-3 flex items-start gap-2 rounded-xl bg-zinc-50 py-2 pl-3 pr-1.5 dark:bg-zinc-900">
        {/* `break-all`: a chave é uma palavra só e estouraria a coluna; o
            endereço inteiro tem que ficar visível para conferência. */}
        <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">{url}</code>
        <button
          type="button"
          onClick={() => copiar("url", url)}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-500 transition hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          {copiado === "url" ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
          {copiado === "url" ? "Copiado" : "Copiar"}
        </button>
      </div>

      {!basePublica && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Este endereço é local: serve para testar, mas nenhum site na internet o alcança. No CRM no ar a URL nasce com o
          domínio certo.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* O prompt é a documentação DE VERDADE desta integração: quem vai
            implementar o blog no site é uma IA no editor de quem faz o site. */}
        <button
          type="button"
          onClick={() => copiar("prompt", promptDeImplementacao(blog, base))}
          className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {copiado === "prompt" ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          {copiado === "prompt" ? "Prompt copiado" : "Copiar prompt para o site"}
        </button>

        {podeTrocar && (
          <button
            type="button"
            disabled={trocando}
            onBlur={() => setArmado(false)}
            onClick={() => (armado ? trocar() : setArmado(true))}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
              armado
                ? "bg-red-600 text-white hover:bg-red-700"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            }`}
          >
            <RefreshCw className="size-3 shrink-0" aria-hidden="true" />
            {trocando ? "Trocando…" : armado ? "Trocar e derrubar a URL atual" : "Trocar chave"}
          </button>
        )}
      </div>
      {erro && <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
    </section>
  );
}
