"use client";

// O modal de geração: link de matéria → rascunho de artigo → salvar.
//
// Abre de dois lugares, e os dois caminhos são o mesmo componente:
//   · de dentro de um blog — `blogId` fixo, o seletor de blog nem aparece;
//   · de uma lista de pautas — chega `{ titulo, link }` da matéria e quem
//     escolhe o blog é a pessoa, aqui dentro.
//
// A PRÉVIA NÃO ESTÁ SALVA. A rota de geração devolve o rascunho e não grava
// nada; a linha só nasce em "Salvar artigo". É o que evita encher o blog de
// tentativa descartada — e é por isso que "Refazer" custa só uma nova geração,
// não uma exclusão.
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  analiseSeo,
  extrairSumario,
  renderArtigo,
  type ArtigoRascunho,
  type Blog,
} from "@/lib/artigo";
import { SeloSeo, prefixarIds } from "./pecas";

type Etapa = "form" | "gerando" | "preview" | "salvando" | "salvo";
type Tamanho = "curto" | "medio" | "longo";

const TAMANHOS: { id: Tamanho; rotulo: string; dica: string }[] = [
  { id: "curto", rotulo: "Curto", dica: "~800 palavras" },
  { id: "medio", rotulo: "Médio", dica: "~1.300 palavras" },
  { id: "longo", rotulo: "Longo", dica: "~2.000 palavras" },
];

export interface PautaInicial {
  titulo: string;
  link: string;
}

export default function ModalArtigo({
  blogId,
  blogs,
  pauta,
  aoFechar,
  aoSalvar,
}: {
  /** Fixo quando o modal abre de dentro de um blog. */
  blogId?: number;
  /** Necessário quando `blogId` não vem: é a lista do seletor. */
  blogs?: Blog[];
  /** Matéria já escolhida numa lista de pautas. */
  pauta?: PautaInicial;
  aoFechar: () => void;
  /** Chamado com o artigo salvo, para a lista se atualizar sem recarregar. */
  aoSalvar?: (artigoId: number) => void;
}) {
  const [etapa, setEtapa] = useState<Etapa>("form");
  const [erro, setErro] = useState<string | null>(null);

  const [alvo, setAlvo] = useState<number | undefined>(blogId ?? blogs?.[0]?.id);
  const [link, setLink] = useState(pauta?.link ?? "");
  const [titulo, setTitulo] = useState(pauta?.titulo ?? "");
  const [palavraChave, setPalavraChave] = useState("");
  const [tamanho, setTamanho] = useState<Tamanho>("medio");
  const [instrucoes, setInstrucoes] = useState("");

  const [rascunho, setRascunho] = useState<ArtigoRascunho | null>(null);
  const [fonte, setFonte] = useState<{ titulo: string; url: string }>({
    titulo: "",
    url: "",
  });
  const [salvoEm, setSalvoEm] = useState<{ id: number; blogId: number } | null>(
    null,
  );

  // Esc fecha — menos enquanto a geração está em voo, para não perder o que já
  // foi pago em token por um toque de tecla.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && etapa !== "gerando" && etapa !== "salvando") {
        aoFechar();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [etapa, aoFechar]);

  const blogEscolhido = blogs?.find((b) => b.id === alvo);
  const semAuditoria = blogEscolhido ? !blogEscolhido.auditoria_id : false;

  async function gerar() {
    if (!alvo || !link.trim()) return;
    setEtapa("gerando");
    setErro(null);

    try {
      const resposta = await fetch("/api/artigos/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blogId: alvo,
          link: link.trim(),
          newsTitle: titulo.trim(),
          palavraChave: palavraChave.trim(),
          tamanho,
          instrucoes: instrucoes.trim(),
        }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        setErro(dados.error ?? "Não foi possível gerar o artigo.");
        setEtapa("form");
        return;
      }

      setRascunho(dados.artigo as ArtigoRascunho);
      setFonte({ titulo: dados.fonte_titulo ?? "", url: dados.fonte_url ?? "" });
      setEtapa("preview");
    } catch {
      setErro("Falha de rede ao gerar o artigo.");
      setEtapa("form");
    }
  }

  async function salvar() {
    if (!rascunho || !alvo) return;
    setEtapa("salvando");
    setErro(null);

    const resposta = await fetch("/api/artigos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        blogId: alvo,
        ...rascunho,
        fonte_titulo: fonte.titulo,
        fonte_url: fonte.url,
      }),
    });
    const dados = await resposta.json();

    if (!resposta.ok) {
      setErro(dados.error ?? "Não foi possível salvar o artigo.");
      setEtapa("preview");
      return;
    }

    setSalvoEm({ id: dados.id as number, blogId: alvo });
    aoSalvar?.(dados.id as number);
    setEtapa("salvo");
  }

  const nomeDoBlog =
    blogEscolhido?.nome ?? (blogId ? "este blog" : "o blog escolhido");

  return (
    <>
      <div
        className="veu-surge fixed inset-0 z-40 bg-zinc-900/30 dark:bg-black/50"
        onClick={() => etapa !== "gerando" && etapa !== "salvando" && aoFechar()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Gerar artigo"
        className="surge fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(46rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-200 bg-conteudo shadow-xl dark:border-zinc-800"
      >
        <header className="shrink-0 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
            Gerar artigo
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            A IA lê a matéria e escreve em cima dela, seguindo a auditoria do
            blog.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* ── form / gerando ────────────────────────────────────────── */}
          {(etapa === "form" || etapa === "gerando") && (
            <div className="flex flex-col gap-4">
              {!blogId && blogs && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    Blog
                  </span>
                  <select
                    value={alvo ?? ""}
                    onChange={(e) => setAlvo(Number(e.target.value))}
                    className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none dark:border-zinc-800 dark:text-zinc-50"
                  >
                    {blogs.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nome}
                        {b.auditoria_nome ? ` — ${b.auditoria_nome}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {!pauta && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                      Link da matéria
                    </span>
                    <input
                      value={link}
                      onChange={(e) => setLink(e.target.value)}
                      placeholder="https://…"
                      className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                      Título da matéria (opcional)
                    </span>
                    <input
                      value={titulo}
                      onChange={(e) => setTitulo(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
                    />
                  </label>
                </>
              )}

              {pauta && (
                <div className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <p className="text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
                    {pauta.titulo}
                  </p>
                  <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                    {pauta.link}
                  </p>
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Palavra-chave (opcional)
                </span>
                <input
                  value={palavraChave}
                  onChange={(e) => setPalavraChave(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
                />
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                  Em branco, a IA escolhe pela matéria.
                </span>
              </label>

              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Tamanho
                </span>
                <div className="flex gap-2">
                  {TAMANHOS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTamanho(t.id)}
                      className={`flex-1 rounded-full border px-3 py-2 text-[12px] transition ${
                        tamanho === t.id
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                          : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {t.rotulo}
                      <span className="ml-1 opacity-60">{t.dica}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* A auditoria é herdada do blog, não se escolhe aqui: trocá-la
                  por artigo quebraria a linha editorial que o blog define. */}
              {semAuditoria ? (
                <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  Este blog não tem auditoria vinculada. Edite o blog e escolha
                  uma antes de gerar.
                </p>
              ) : (
                blogEscolhido?.auditoria_nome && (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Este blog é orientado por{" "}
                    <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                      {blogEscolhido.auditoria_nome}
                    </strong>
                    . Para trocar, edite o blog.
                  </p>
                )
              )}

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Instruções extras (opcional)
                </span>
                <textarea
                  value={instrucoes}
                  onChange={(e) => setInstrucoes(e.target.value)}
                  rows={2}
                  className="w-full resize-y rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
                />
              </label>

              {etapa === "gerando" && (
                <p className="respira text-[12px] text-zinc-500 dark:text-zinc-400">
                  Lendo a matéria e montando estrutura, SEO e FAQ. Artigo longo
                  leva um pouco mais.
                </p>
              )}
            </div>
          )}

          {/* ── preview ───────────────────────────────────────────────── */}
          {(etapa === "preview" || etapa === "salvando") && rascunho && (
            <Previa rascunho={rascunho} blog={blogEscolhido} />
          )}

          {/* ── salvo ─────────────────────────────────────────────────── */}
          {etapa === "salvo" && (
            <p className="py-6 text-center text-[13px] text-zinc-600 dark:text-zinc-300">
              O artigo entrou como pendente em{" "}
              <strong className="font-medium">{nomeDoBlog}</strong>. Ajuste SEO e
              texto na tela do blog e aprove — é o que o libera para o site.
            </p>
          )}

          {erro && (
            <p className="mt-3 text-[12px] text-red-600 dark:text-red-400">{erro}</p>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          {(etapa === "form" || etapa === "gerando") && (
            <>
              <button
                type="button"
                onClick={aoFechar}
                disabled={etapa === "gerando"}
                className="rounded-full px-3 py-1.5 text-[12px] text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={gerar}
                disabled={
                  etapa === "gerando" || !link.trim() || !alvo || semAuditoria
                }
                className="rounded-full bg-zinc-900 px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {etapa === "gerando"
                  ? "Lendo matéria e escrevendo…"
                  : "Gerar artigo"}
              </button>
            </>
          )}

          {(etapa === "preview" || etapa === "salvando") && (
            <>
              <button
                type="button"
                onClick={() => setEtapa("form")}
                disabled={etapa === "salvando"}
                className="rounded-full px-3 py-1.5 text-[12px] text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Refazer
              </button>
              <button
                type="button"
                onClick={salvar}
                disabled={etapa === "salvando"}
                className="rounded-full bg-zinc-900 px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {etapa === "salvando" ? "Salvando…" : "Salvar artigo"}
              </button>
            </>
          )}

          {etapa === "salvo" && (
            <>
              <button
                type="button"
                onClick={aoFechar}
                className="rounded-full px-3 py-1.5 text-[12px] text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Fechar
              </button>
              {salvoEm && (
                <Link
                  href={`/blog/${salvoEm.blogId}`}
                  className="rounded-full bg-zinc-900 px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Abrir o blog
                </Link>
              )}
            </>
          )}
        </footer>
      </div>
    </>
  );
}

// ── Prévia ──────────────────────────────────────────────────────────────────

/**
 * O que a pessoa avalia antes de gravar: como o artigo aparece no Google, o
 * índice que ele gera e o texto renderizado. Os ids da prévia ficam de fora do
 * HTML aqui (o corpo é só leitura, sem índice clicável) — quem precisa deles é
 * o painel do artigo.
 */
function Previa({
  rascunho,
  blog,
}: {
  rascunho: ArtigoRascunho;
  blog?: Blog;
}) {
  const { nota } = analiseSeo(rascunho);
  const sumario = extrairSumario(rascunho.conteudo);
  const { html } = renderArtigo(rascunho.conteudo);

  const base = (blog?.url_base ?? "").trim().replace(/\/+$/, "");
  const url = base ? `${base}/${rascunho.slug}` : `/${rascunho.slug}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Cartão de SERP: o resultado como ele aparece na busca. */}
      <div className="rounded-2xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] text-emerald-700 dark:text-emerald-400">
              {url}
            </p>
            <p className="mt-0.5 text-[15px] leading-snug text-blue-700 underline underline-offset-2 dark:text-blue-400">
              {rascunho.meta_title || rascunho.titulo}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              {rascunho.meta_description || rascunho.resumo}
            </p>
          </div>
          <SeloSeo nota={nota} grande />
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
          Índice gerado · {sumario.length} âncoras
        </p>
        <ol className="mt-1.5 flex flex-col gap-0.5">
          {sumario.map((h, i) => (
            <li
              key={`${h.id}-${i}`}
              className={`truncate text-[12px] text-zinc-600 dark:text-zinc-400 ${
                h.nivel === 3 ? "pl-4" : ""
              }`}
            >
              {h.texto}
            </li>
          ))}
        </ol>
      </div>

      <article className="artigo-preview max-h-[38vh] overflow-y-auto rounded-2xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-[16px] font-semibold text-zinc-900 dark:text-zinc-50">
          {rascunho.titulo}
        </h1>
        {/* Seguro pelo mesmo motivo do painel: renderArtigo escapa o conteúdo e
            filtra o esquema de todo href. Os ids levam prefixo para não
            colidirem com os da tela por trás do modal. */}
        <div dangerouslySetInnerHTML={{ __html: prefixarIds(html) }} />
      </article>
    </div>
  );
}
