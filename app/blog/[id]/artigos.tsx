"use client";

// Tela /blog/[id]: o trabalho do blog, em duas faixas.
//
//   · CONTEÚDO — Conexão e RSS (dois botões que abrem a sua folha ancorada
//     neles), a busca, e os artigos em lista com o seu status. O clique no
//     artigo o abre POR CIMA da tela, para editar.
//   · NOTÍCIAS — a caixa flutuante da direita, na MESMA medida da gaveta de
//     contatos do dashboard (app/inicio/gaveta-contatos.tsx): encostada nas
//     bordas com 1rem de folga, 25rem de largura, cantos e sombra iguais. É
//     outra coisa dentro da mesma caixa, de propósito — quem usa os dois não
//     aprende dois formatos.
//
// A faixa de conteúdo reserva `lg:pr-[27rem]` (as 25rem da caixa + as duas
// folgas): a caixa é `fixed`, não empurra nada, e sem a reserva os artigos
// passariam por baixo dela. Empilhado, a caixa volta para o fluxo no fim da
// página e a reserva some.
//
// ARTIGO SÓ NASCE DE NOTÍCIA. Não há botão de "gerar artigo" no cabeçalho: o
// que existe é a lista de notícias, e cada linha dela tem o seu. Gerar a partir
// de um link avulso pedia blog, palavra-chave e tamanho numa tela à parte — e
// era outra porta para a mesma coisa, com mais perguntas.
//
// A ordem da lista vem do servidor (pendente antes de aprovado, cada grupo do
// mais novo para o mais antigo) e é a ordem do TRABALHO: o que ainda espera
// leitura fica em cima, porque é ele que segura a publicação. Busca e filtro só
// peneiram; não reordenam.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, Link2, Rss, Search } from "lucide-react";
import {
  ARTIGO_STATUS,
  ARTIGO_STATUS_LABEL,
  analiseSeo,
  contarPalavras,
  tempoLeitura,
  textoPuro,
  type Artigo,
  type ArtigoStatus,
  type Blog,
} from "@/lib/artigo";
import { dataCurta } from "../../formato";
import { SeloSeo, Tag, TagStatus } from "../pecas";
import PainelArtigo from "../painel-artigo";
import PainelConexao from "../painel-conexao";
import PainelRss from "../painel-rss";
import Noticias from "../noticias";

type Filtro = "todos" | ArtigoStatus;

/** Qual folha de configuração está aberta por cima da tela. */
type Folha = "conexao" | "rss" | null;

export default function BlogArtigos({
  blogId,
  base,
  basePublica,
}: {
  blogId: number;
  /** Endereço deste CRM, resolvido no servidor — monta a URL de conexão. */
  base: string;
  basePublica: boolean;
}) {
  const [blog, setBlog] = useState<Blog | null>(null);
  const [artigos, setArtigos] = useState<Artigo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [semBlog, setSemBlog] = useState(false);

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aberto, setAberto] = useState<Artigo | null>(null);
  const [folha, setFolha] = useState<Folha>(null);

  // Contador de recarga: salvar um artigo novo incrementa, o efeito roda de
  // novo e a lista volta do servidor. Refazer a ordenação canônica no cliente
  // seria duplicar, em outra linguagem, a regra que já está no SQL.
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/blogs/${blogId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("sem blog"))))
      .then((dados) => {
        if (!vivo) return;
        setBlog(dados.blog as Blog);
        setArtigos((dados.artigos ?? []) as Artigo[]);
      })
      .catch(() => vivo && setSemBlog(true))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [blogId, recarga]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return artigos.filter((a) => {
      if (filtro !== "todos" && a.status !== filtro) return false;
      if (!termo) return true;
      return (
        a.titulo.toLowerCase().includes(termo) ||
        a.palavra_chave.toLowerCase().includes(termo)
      );
    });
  }, [artigos, busca, filtro]);

  const pendentes = artigos.filter((a) => a.status === "pendente").length;
  const aprovados = artigos.length - pendentes;

  // Abrir o artigo a partir do id — é o que a lista de notícias tem em mãos
  // depois de gerar. Se ele ainda não chegou ao estado local (a recarga pode
  // estar em voo), pede a recarga em vez de piscar um painel vazio: no clique
  // seguinte ele está lá.
  const abrirPorId = useCallback(
    (id: number) => {
      const artigo = artigos.find((a) => a.id === id);
      if (artigo) setAberto(artigo);
      else setRecarga((n) => n + 1);
    },
    [artigos],
  );

  if (semBlog) {
    return (
      <div className="pagina-surge min-h-screen bg-conteudo px-6 py-8">
        <p className="text-[13px] text-zinc-600 dark:text-zinc-300">
          Blog não encontrado.
        </p>
        <Link
          href="/blog"
          className="mt-2 inline-block text-[12px] text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
        >
          ← Voltar para os blogs
        </Link>
      </div>
    );
  }

  return (
    <div className="pagina-surge min-h-screen bg-conteudo">
      <div className="w-full px-6 py-8 lg:pr-[27rem]">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1 text-[12px] text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Blogs
        </Link>

        <header className="mt-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {blog?.nome ?? "…"}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {blog?.auditoria_nome ? (
                <Tag>{blog.auditoria_nome}</Tag>
              ) : (
                blog && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">
                    Sem auditoria — não dá para gerar artigo
                  </span>
                )
              )}
              {blog?.url_base && (
                <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                  {blog.url_base}
                </span>
              )}
              {!carregando && (
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {pendentes} pendente{pendentes === 1 ? "" : "s"} ·{" "}
                  {aprovados} aprovado{aprovados === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
        </header>

        <main className="mt-5 min-w-0">
          {/* Cada botão é o pai posicionado da sua folha: ela cai logo abaixo
              dele e cresce para a direita, por cima da lista. */}
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <BotaoFolha
                icone={Link2}
                rotulo="Conexão"
                aberto={folha === "conexao"}
                aoAbrir={() => setFolha((f) => (f === "conexao" ? null : "conexao"))}
              />
              {folha === "conexao" && blog && (
                <PainelConexao
                  blog={blog}
                  base={base}
                  basePublica={basePublica}
                  aoFechar={() => setFolha(null)}
                  aoTrocarChave={setBlog}
                />
              )}
            </div>

            <div className="relative">
              <BotaoFolha
                icone={Rss}
                rotulo="RSS"
                aberto={folha === "rss"}
                aoAbrir={() => setFolha((f) => (f === "rss" ? null : "rss"))}
              />
              {folha === "rss" && (
                <PainelRss blogId={blogId} aoFechar={() => setFolha(null)} />
              )}
            </div>
          </div>

          {artigos.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
                    aria-hidden="true"
                  />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por título ou palavra-chave"
                    className="w-full rounded-full border border-zinc-200 bg-transparent py-2 pl-9 pr-4 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
                  />
                </div>
                <div className="flex gap-1">
                  {(["todos", ...ARTIGO_STATUS] as Filtro[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFiltro(f)}
                      className={`rounded-full px-3 py-1.5 text-[12px] transition ${
                        filtro === f
                          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                          : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {f === "todos" ? "Todos" : ARTIGO_STATUS_LABEL[f]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {carregando ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse border-t border-zinc-200 first:border-t-0 dark:border-zinc-800"
                  />
                ))}
              </div>
            ) : (
              visiveis.length > 0 && (
                <ul className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                  {visiveis.map((a) => (
                    <Linha key={a.id} artigo={a} aoAbrir={setAberto} />
                  ))}
                </ul>
              )
            )}

            {!carregando && artigos.length === 0 && (
              <p className="mt-4 rounded-2xl border border-dashed border-zinc-300 px-4 py-3 text-[12px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                Nenhum artigo ainda. Escolha uma notícia ao lado e mande
                gerar.
              </p>
            )}
            {!carregando && artigos.length > 0 && visiveis.length === 0 && (
              <p className="mt-4 text-[12px] text-zinc-400 dark:text-zinc-500">
                Nenhum artigo com esse filtro.
              </p>
            )}
        </main>
      </div>

      {/* ── A caixa das notícias ───────────────────────────────────────────
          Mesma medida e mesmo acabamento da gaveta de contatos do dashboard.
          `fixed` só a partir de lg: empilhado ela vira um cartão no fim da
          página, com as margens que o `px-6` da faixa de cima dá. */}
      <aside className="mx-6 mb-8 flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl lg:fixed lg:inset-y-4 lg:right-4 lg:z-30 lg:m-0 lg:w-[25rem] lg:max-w-[92vw] dark:border-zinc-800 dark:bg-zinc-950">
        {/* O que os feeds publicaram, com o botão que vira artigo. */}
        <Noticias
          blogId={blogId}
          // Recarrega do servidor em vez de empilhar o artigo novo no topo:
          // a ordem da lista é regra do SQL, e refazê-la aqui seria escrevê-la
          // duas vezes.
          aoGerar={() => setRecarga((n) => n + 1)}
          aoVerArtigo={abrirPorId}
        />
      </aside>

      {aberto && blog && (
        <PainelArtigo
          key={aberto.id}
          artigo={aberto}
          blog={blog}
          aoFechar={() => setAberto(null)}
          aoSalvar={(a) => {
            setArtigos((atuais) => atuais.map((x) => (x.id === a.id ? a : x)));
            setAberto(a);
          }}
          aoExcluir={(id) => {
            setArtigos((atuais) => atuais.filter((x) => x.id !== id));
            setAberto(null);
          }}
          // O slug vem junto porque aprovar pode tê-lo criado: sem isso a lista
          // continuaria mostrando "sem endereço" num artigo que já tem um.
          aoTrocarStatus={(id, status, slug) =>
            setArtigos((atuais) =>
              atuais.map((x) =>
                x.id === id ? { ...x, status, slug: slug || x.slug } : x,
              ),
            )
          }
        />
      )}

    </div>
  );
}

// ── Os dois botões de configuração ──────────────────────────────────────────

function BotaoFolha({
  icone: Icone,
  rotulo,
  aberto,
  aoAbrir,
}: {
  icone: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  rotulo: string;
  aberto: boolean;
  aoAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-expanded={aberto}
      // Aberto, o botão fica marcado: a folha sai dele, e sem isso não se sabe
      // de qual dos dois. Quem chama passa um aoAbrir que ALTERNA: o balão não
      // tem mais véu cobrindo o botão (ver Balao em ../pecas.tsx), então clicar
      // nele de novo é o que fecha.
      className={`flex items-center gap-1.5 rounded-2xl border px-4 py-2.5 text-[12px] font-medium transition ${
        aberto
          ? "border-zinc-300 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-50"
          : "border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-50"
      }`}
    >
      <Icone className="size-4 shrink-0" aria-hidden={true} />
      {rotulo}
    </button>
  );
}

// ── Uma linha da lista ──────────────────────────────────────────────────────
//
// Lista e não cartão: o que se faz aqui é varrer de cima para baixo procurando
// o que está pendente. Numa grade de três colunas o status salta menos, e o
// título — que é o que identifica o artigo — fica cortado em duas linhas.

function Linha({
  artigo,
  aoAbrir,
}: {
  artigo: Artigo;
  aoAbrir: (a: Artigo) => void;
}) {
  const { nota } = analiseSeo(artigo);
  const chamada =
    artigo.resumo ||
    artigo.meta_description ||
    textoPuro(artigo.conteudo).slice(0, 180);

  return (
    <li className="border-t border-zinc-200 first:border-t-0 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => aoAbrir(artigo)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TagStatus status={artigo.status} />
            <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
              {artigo.titulo}
            </h2>
          </div>

          <p className="mt-1 line-clamp-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {chamada}
          </p>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            <span>{dataCurta(artigo.created_at)}</span>
            <span aria-hidden="true">·</span>
            <span>{contarPalavras(artigo.conteudo)} palavras</span>
            <span aria-hidden="true">·</span>
            <span>{tempoLeitura(artigo.conteudo)} min</span>

            {artigo.palavra_chave && (
              <span className="flex min-w-0 items-center gap-1">
                <KeyRound className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{artigo.palavra_chave}</span>
              </span>
            )}

            {/* O endereço só importa depois de aprovado: é a URL que o site vai
                servir. Pendente sem slug ainda vai ganhar um ao ser aprovado. */}
            {artigo.status === "aprovado" && artigo.slug && (
              <span className="flex min-w-0 items-center gap-1">
                <Link2 className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate font-mono">/{artigo.slug}</span>
              </span>
            )}
          </p>
        </div>

        <SeloSeo nota={nota} />
      </button>
    </li>
  );
}
