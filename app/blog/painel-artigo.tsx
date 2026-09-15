"use client";

// O artigo aberto POR CIMA da tela do blog: conteúdo, SEO e prévia.
//
// O PAINEL É MONTADO COM key={artigo.id} PELO PAI. Sem isso o rascunho local
// sobreviveria à troca de artigo e o texto de um apareceria dentro do outro.
//
// Tudo que a tela mostra além dos campos — índice, contagem de palavras, tempo
// de leitura, nota e checklist — é DERIVADO do markdown a cada tecla, por
// lib/artigo.ts. Não há "recalcular" nem salvar no meio: o que está na tela é o
// que aquele texto produz.
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import {
  ARTIGO_STATUS,
  ARTIGO_STATUS_LABEL,
  analiseSeo,
  artigoParaHtml,
  contarPalavras,
  jsonLd,
  metaTags,
  renderArtigo,
  slugify,
  tempoLeitura,
  type Artigo,
  type ArtigoRascunho,
  type ArtigoStatus,
  type Blog,
} from "@/lib/artigo";
import {
  BotaoExcluir,
  BotaoSalvar,
  Campo,
  SeloSeo,
  Sobreposicao,
  TagStatus,
  prefixarIds,
} from "./pecas";

type Aba = "conteudo" | "seo" | "previa";

function deArtigo(a: Artigo): ArtigoRascunho {
  return {
    titulo: a.titulo,
    slug: a.slug,
    meta_title: a.meta_title,
    meta_description: a.meta_description,
    palavra_chave: a.palavra_chave,
    keywords: a.keywords,
    resumo: a.resumo,
    conteudo: a.conteudo,
    imagem_alt: a.imagem_alt,
  };
}

export default function PainelArtigo({
  artigo,
  blog,
  aoFechar,
  aoSalvar,
  aoExcluir,
  aoTrocarStatus,
}: {
  artigo: Artigo;
  blog: Blog;
  aoFechar: () => void;
  aoSalvar: (a: Artigo) => void;
  aoExcluir: (id: number) => void;
  /** Sobe o status e o slug: aprovar pode ter dado endereço ao artigo. */
  aoTrocarStatus: (id: number, status: ArtigoStatus, slug: string) => void;
}) {
  const [aba, setAba] = useState<Aba>("conteudo");
  const [r, setR] = useState<ArtigoRascunho>(() => deArtigo(artigo));
  const [status, setStatus] = useState<ArtigoStatus>(artigo.status);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const muda = (campo: keyof ArtigoRascunho) => (v: string) =>
    setR((atual) => ({ ...atual, [campo]: v }));

  // O artigo "como está agora": o rascunho por cima da linha do banco. É o que
  // alimenta o HTML, as meta tags e o JSON-LD — assim os botões de copiar
  // entregam o que está na tela, não a última versão salva.
  const atual = useMemo<Artigo>(() => ({ ...artigo, ...r }), [artigo, r]);

  const { checks, nota } = useMemo(() => analiseSeo(r), [r]);
  const { html, sumario } = useMemo(
    () => renderArtigo(r.conteudo),
    [r.conteudo],
  );
  const palavras = useMemo(() => contarPalavras(r.conteudo), [r.conteudo]);
  const minutos = useMemo(() => tempoLeitura(r.conteudo), [r.conteudo]);
  const noVerde = checks.filter((c) => c.nivel === "ok").length;

  async function copiar(chave: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(chave);
      setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1800);
    } catch {
      setErro("O navegador bloqueou a cópia.");
    }
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);

    const resposta = await fetch(`/api/artigos/${artigo.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...r,
        fonte_titulo: artigo.fonte_titulo,
        fonte_url: artigo.fonte_url,
      }),
    });
    const dados = await resposta.json();
    setSalvando(false);

    if (!resposta.ok) {
      setErro(dados.error ?? "Não foi possível salvar.");
      return;
    }

    // O servidor pode ter desambiguado o slug — o campo passa a mostrar o
    // endereço que existe de verdade, e não o que foi digitado.
    setR((atualR) => ({ ...atualR, slug: (dados as Artigo).slug }));
    aoSalvar(dados as Artigo);
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2000);
  }

  async function mudarStatus(novo: ArtigoStatus) {
    const anterior = status;
    setStatus(novo); // otimista: o seletor responde na hora
    setErro(null);

    const resposta = await fetch(`/api/artigos/${artigo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: novo }),
    });

    if (!resposta.ok) {
      setStatus(anterior);
      const dados = await resposta.json().catch(() => ({}));
      setErro(dados.error ?? "Não foi possível mudar o status.");
      return;
    }

    // Aprovar um artigo sem endereço faz o servidor criar um a partir do
    // título (app/api/artigos/[id]/route.ts) — senão ele ficaria aprovado e
    // invisível para o site. O campo adota esse valor SÓ se estiver vazio: um
    // slug digitado e ainda não salvo é decisão de quem está editando.
    const dados = await resposta.json().catch(() => ({}));
    const slugNovo = typeof dados.slug === "string" ? dados.slug : "";
    if (slugNovo && !r.slug) setR((atualR) => ({ ...atualR, slug: slugNovo }));

    // Só status e slug sobem para a lista. Mandar o artigo inteiro daqui
    // descartaria as edições ainda não salvas deste painel.
    aoTrocarStatus(artigo.id, novo, slugNovo);
  }

  async function excluir() {
    setSalvando(true);
    await fetch(`/api/artigos/${artigo.id}`, { method: "DELETE" });
    aoExcluir(artigo.id);
  }

  const abas: { id: Aba; rotulo: React.ReactNode }[] = [
    { id: "conteudo", rotulo: "Conteúdo" },
    {
      id: "seo",
      rotulo: (
        <span className="flex items-center gap-1.5">
          SEO <SeloSeo nota={nota} />
        </span>
      ),
    },
    { id: "previa", rotulo: "Prévia" },
  ];

  return (
    <Sobreposicao rotulo={artigo.titulo} aoFechar={aoFechar}>
      {/* ── Cabeçalho ───────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-zinc-200 px-5 pt-4 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <TagStatus status={status} />
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {palavras} palavras · {minutos} min
          </span>
          <button
            type="button"
            onClick={aoFechar}
            className="ml-auto rounded-full px-2 py-1 text-[12px] text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            Fechar
          </button>
        </div>

        <nav className="mt-3 flex gap-1">
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              className={`rounded-t-lg border-b-2 px-3 py-2 text-[12px] transition ${
                aba === a.id
                  ? "border-zinc-900 font-medium text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
            >
              {a.rotulo}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* ── Conteúdo ──────────────────────────────────────────────────── */}
        {/* Duas colunas a partir de lg: o editor fica com a largura toda que
            a sobreposição ganhou, e o que é referência (índice, matéria de
            origem) sai de baixo do texto para o lado. Em telas estreitas
            volta a empilhar, na mesma ordem de antes. */}
        {aba === "conteudo" && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Campo
                rotulo="Título (H1)"
                valor={r.titulo}
                aoMudar={muda("titulo")}
                min={45}
                max={70}
              />

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    Corpo (markdown — &quot;## &quot; vira seção do índice)
                  </span>
                  <button
                    type="button"
                    onClick={() => copiar("md", r.conteudo)}
                    className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                  >
                    <Copy className="size-3" aria-hidden="true" />
                    {copiado === "md" ? "Copiado!" : "Copiar markdown"}
                  </button>
                </div>
                <textarea
                  value={r.conteudo}
                  onChange={(e) => muda("conteudo")(e.target.value)}
                  rows={24}
                  className="min-h-[24rem] w-full resize-y rounded-xl border border-zinc-200 bg-transparent px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
                />
              </div>
            </div>

            <aside className="flex min-w-0 flex-col gap-4">
              <section>
                <h3 className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Índice do artigo
                </h3>
                {sumario.length === 0 ? (
                  <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                    Sem &quot;## &quot; no corpo, não há índice.
                  </p>
                ) : (
                  <ol className="mt-1.5 flex flex-col gap-1">
                    {sumario.map((h, i) => (
                      <li
                        key={`${h.id}-${i}`}
                        className={`flex items-baseline gap-2 text-[12px] ${
                          h.nivel === 3 ? "pl-4" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
                          {h.texto}
                        </span>
                        <code className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                          #{h.id}
                        </code>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              {artigo.fonte_url && (
                <a
                  href={artigo.fonte_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[11px] text-zinc-500 underline underline-offset-2 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  <ExternalLink
                    className="size-3 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {artigo.fonte_titulo || artigo.fonte_url}
                  </span>
                </a>
              )}
            </aside>
          </div>
        )}

        {/* ── SEO ───────────────────────────────────────────────────────── */}
        {aba === "seo" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {nota}
              </span>
              <span className="text-[12px] text-zinc-500 dark:text-zinc-400">
                {noVerde} de {checks.length} itens no verde
              </span>
            </div>

            <Campo
              rotulo="Palavra-chave principal"
              valor={r.palavra_chave}
              aoMudar={muda("palavra_chave")}
            />
            <Campo
              rotulo="Título SEO"
              valor={r.meta_title}
              aoMudar={muda("meta_title")}
              min={30}
              max={60}
            />
            <Campo
              rotulo="Meta descrição"
              valor={r.meta_description}
              aoMudar={muda("meta_description")}
              min={110}
              max={160}
              linhas={3}
            />

            <div className="flex flex-col gap-1">
              <Campo rotulo="Slug" valor={r.slug} aoMudar={muda("slug")} />
              {r.slug && r.slug !== slugify(r.slug) && (
                <button
                  type="button"
                  onClick={() => muda("slug")(slugify(r.slug))}
                  className="self-start text-[11px] text-amber-600 underline underline-offset-2 dark:text-amber-400"
                >
                  Corrigir para &quot;{slugify(r.slug)}&quot;
                </button>
              )}
            </div>

            <Campo
              rotulo="Palavras-chave secundárias"
              valor={r.keywords}
              aoMudar={muda("keywords")}
              dica="Separadas por vírgula."
            />
            <Campo
              rotulo="Resumo/chamada"
              valor={r.resumo}
              aoMudar={muda("resumo")}
              linhas={2}
            />
            <Campo
              rotulo="Texto alternativo da capa"
              valor={r.imagem_alt}
              aoMudar={muda("imagem_alt")}
            />

            <ul className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  {c.nivel === "ok" ? (
                    <CheckCircle2
                      className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangle
                      className={`mt-0.5 size-3.5 shrink-0 ${
                        c.nivel === "erro"
                          ? "text-red-600 dark:text-red-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block text-[12px] text-zinc-800 dark:text-zinc-200">
                      {c.label}
                    </span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      {c.detalhe}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Prévia ────────────────────────────────────────────────────── */}
        {aba === "previa" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["html", "Copiar HTML", () => artigoParaHtml(atual, blog)],
                  ["meta", "Copiar meta tags", () => metaTags(atual, blog)],
                  [
                    "ld",
                    "Copiar JSON-LD",
                    () => {
                      const b = jsonLd(atual, blog);
                      return JSON.stringify(b.length === 1 ? b[0] : b, null, 2);
                    },
                  ],
                ] as const
              ).map(([chave, rotulo, gerar]) => (
                <button
                  key={chave}
                  type="button"
                  onClick={() => copiar(chave, gerar())}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  {copiado === chave ? "Copiado!" : rotulo}
                </button>
              ))}
            </div>

            {sumario.length > 0 && (
              <nav className="rounded-2xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Neste artigo
                </p>
                <ol className="mt-1.5 flex flex-col gap-1">
                  {sumario.map((h, i) => (
                    <li
                      key={`${h.id}-${i}`}
                      className={h.nivel === 3 ? "pl-4" : ""}
                    >
                      <a
                        href={`#previa-${h.id}`}
                        onClick={(e) => {
                          // preventDefault: mudar o hash rolaria a janela
                          // inteira; quem precisa rolar é o painel.
                          e.preventDefault();
                          document
                            .getElementById(`previa-${h.id}`)
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                        }}
                        className="text-[12px] text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
                      >
                        {h.texto}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}

            <article className="artigo-preview">
              <h1 className="text-[18px] font-semibold text-zinc-900 dark:text-zinc-50">
                {r.titulo}
              </h1>
              {r.resumo && (
                <p className="italic text-zinc-500 dark:text-zinc-400">
                  {r.resumo}
                </p>
              )}
              {/* O HTML vem de renderArtigo, que escapa tudo e só deixa passar
                  href http(s)/mailto/relativo/âncora — ver HREF_PERMITIDO. */}
              <div dangerouslySetInnerHTML={{ __html: prefixarIds(html) }} />
            </article>
          </div>
        )}
      </div>

      {erro && (
        <p className="shrink-0 px-5 pb-1 text-[12px] text-red-600 dark:text-red-400">
          {erro}
        </p>
      )}

      {/* ── Rodapé ──────────────────────────────────────────────────────── */}
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <BotaoExcluir
          rotulo="Excluir"
          confirmacao="Excluir artigo"
          aoConfirmar={excluir}
          ocupado={salvando}
        />
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => mudarStatus(e.target.value as ArtigoStatus)}
            className="rounded-full border border-zinc-200 bg-transparent px-3 py-1.5 text-[12px] text-zinc-700 outline-none dark:border-zinc-800 dark:text-zinc-300"
          >
            {ARTIGO_STATUS.map((s) => (
              <option key={s} value={s}>
                {ARTIGO_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <BotaoSalvar aoSalvar={salvar} salvando={salvando} salvo={salvo} />
        </div>
      </footer>
    </Sobreposicao>
  );
}
