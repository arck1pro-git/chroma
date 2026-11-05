"use client";

// A tela de um blog (/blog/[id]): três abas sobre o mesmo blog.
//
//   · ARTIGOS — o quadro Pautas → Em revisão → Postado (./quadro.tsx);
//   · DESEMPENHO — o site e os artigos no Google (./desempenho.tsx);
//   · AUTOMAÇÃO — o robô das 7h e as fontes de notícia (./automacao.tsx).
//
// O QUE É DE MAIS DE UMA ABA MORA AQUI: os artigos (o quadro mostra, o
// Desempenho lista os postados), os números do Google (os cartões de Postado e
// a aba Desempenho leem a mesma leitura), o estado da automação (o selo do
// cabeçalho e a aba) e as pautas — uma geração em andamento sobrevive à troca
// de aba e avisa quando o artigo chega.
//
// Os artigos chegam do servidor (page.tsx), já na primeira pintura. Google,
// automação e pautas vêm do navegador, cada um no seu tempo: são leituras de
// fora (Search Console, n8n, cinco sites de notícia) e não podem segurar a tela.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { slugify, type Artigo, type ArtigoStatus, type Blog } from "@/lib/artigo";
import { urlComparavel, type GoogleDoArtigo, type GoogleDoBlog, type PeriodoGoogle } from "@/lib/blog-google-tipos";
import type { EstadoAutomacao } from "@/lib/blog-automacao-tipos";
import type { PautaDoBlog } from "@/lib/blog-pauta-tipos";
import { ArrowLeft, ExternalLink, Search, Settings2 } from "@/app/components/icones";
import { Aviso, mensagemDeErro, type AvisoTela } from "../pecas";
import PainelArtigo, { type AbaArtigo } from "../painel-artigo";
import Quadro, { filtrarArtigos, type Permissoes } from "./quadro";
import Desempenho from "./desempenho";
import Automacao, { type FonteDoBlog } from "./automacao";
import GavetaBlog, { type FocoDaGaveta } from "./gaveta-blog";
import { usePautas } from "./pautas";

export type Aba = "artigos" | "desempenho" | "automacao";

/** ?demo=1 (só em desenvolvimento): tudo pronto, e nada vai ao servidor. */
export type DadosDemo = {
  google: GoogleDoBlog;
  automacao: EstadoAutomacao;
  pautas: PautaDoBlog;
  fontes: FonteDoBlog[];
  /** Por id do artigo postado. Objeto e não função: vem do servidor, e função não atravessa. */
  googleDosArtigos: Record<string, GoogleDoArtigo>;
};

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "artigos", rotulo: "Artigos" },
  { id: "desempenho", rotulo: "Desempenho" },
  { id: "automacao", rotulo: "Automação" },
];

const agoraIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export default function TelaBlog({
  blogInicial,
  artigosIniciais,
  base,
  basePublica,
  pode,
  abaInicial,
  demo,
}: {
  blogInicial: Blog;
  artigosIniciais: Artigo[];
  base: string;
  basePublica: boolean;
  pode: Permissoes;
  abaInicial: Aba;
  demo?: DadosDemo;
}) {
  const [blog, setBlog] = useState(blogInicial);
  const [artigos, setArtigos] = useState(artigosIniciais);
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<{ artigo: Artigo; aba?: AbaArtigo } | null>(null);
  const [gaveta, setGaveta] = useState<{ foco: FocoDaGaveta } | null>(null);
  const [aviso, setAviso] = useState<AvisoTela>(null);
  const [destaque, setDestaque] = useState<number | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const router = useRouter();

  // ── Google ────────────────────────────────────────────────────────────────
  const [periodo, setPeriodo] = useState<PeriodoGoogle>(28);
  const [pedidoGoogle, setPedidoGoogle] = useState({ n: 0, forcar: false });
  const [google, setGoogle] = useState<GoogleDoBlog | null>(demo?.google ?? null);
  const [atualizandoGoogle, setAtualizandoGoogle] = useState(false);

  useEffect(() => {
    if (demo) return;
    let vivo = true;
    fetch(`/api/blogs/${blog.id}/google?dias=${periodo}${pedidoGoogle.forcar ? "&atualizar=1" : ""}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(mensagemDeErro(d, "Não foi possível falar com o Google agora."));
        return d as GoogleDoBlog;
      })
      .then((d) => vivo && setGoogle(d))
      .catch((e: Error) => vivo && setGoogle({ estado: "erro", mensagem: e.message }))
      .finally(() => vivo && setAtualizandoGoogle(false));
    return () => {
      vivo = false;
    };
    // O endereço do blog entra na dependência: trocá-lo na gaveta muda o site procurado.
  }, [blog.id, blog.url_base, periodo, pedidoGoogle, demo]);

  const atualizarGoogle = useCallback(() => {
    setAtualizandoGoogle(true);
    setPedidoGoogle((p) => ({ n: p.n + 1, forcar: true }));
  }, []);
  const mudarPeriodo = useCallback((p: PeriodoGoogle) => {
    setAtualizandoGoogle(true);
    setPeriodo(p);
    setPedidoGoogle((x) => ({ n: x.n + 1, forcar: false }));
  }, []);

  // ── Automação ─────────────────────────────────────────────────────────────
  const [automacao, setAutomacao] = useState<EstadoAutomacao | null>(demo?.automacao ?? null);
  const [recargaAutomacao, setRecargaAutomacao] = useState(0);
  useEffect(() => {
    if (demo) return;
    let vivo = true;
    fetch("/api/blogs/rss/workflow")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: EstadoAutomacao) => vivo && setAutomacao(d))
      .catch(() => vivo && setAutomacao({ estado: "erro", mensagem: "Não foi possível ler a automação agora." }));
    return () => {
      vivo = false;
    };
  }, [demo, recargaAutomacao]);

  // ── Pautas ────────────────────────────────────────────────────────────────
  const aoGerar = useCallback((artigo: Artigo) => {
    setArtigos((xs) => [artigo, ...xs]);
    setDestaque(artigo.id);
    setTimeout(() => setDestaque((d) => (d === artigo.id ? null : d)), 4000);
    setAviso({ ok: true, texto: `Artigo pronto para revisão: “${artigo.titulo}”` });
  }, []);
  const pautas = usePautas({ blogId: blog.id, demo: demo?.pautas, aoGerar });

  // ── Artigos ───────────────────────────────────────────────────────────────
  const visiveis = useMemo(() => filtrarArtigos(artigos, busca), [artigos, busca]);
  const emRevisao = artigos.filter((a) => a.status === "pendente").length;

  const trocar = useCallback((id: number, mudanca: Partial<Artigo>) => {
    setArtigos((xs) => xs.map((x) => (x.id === id ? { ...x, ...mudanca } : x)));
  }, []);

  const mover = useCallback(
    async (artigo: Artigo, status: ArtigoStatus) => {
      if (artigo.status === status) return;
      const textoOk = status === "aprovado" ? "Postado. O site mostra em até 5 minutos." : "Voltou para revisão e saiu do site.";
      // Otimista: o cartão já está na coluna nova quando a resposta chega.
      trocar(artigo.id, { status, updated_at: agoraIso() });
      if (demo) {
        // Postar dá endereço ao artigo (o servidor cria o slug); a demonstração imita.
        if (status === "aprovado" && !artigo.slug) trocar(artigo.id, { slug: slugify(artigo.titulo) });
        return setAviso({ ok: true, texto: textoOk });
      }

      const r = await fetch(`/api/artigos/${artigo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => null);
      const d = await r?.json().catch(() => null);
      if (!r?.ok) {
        trocar(artigo.id, { status: artigo.status, updated_at: artigo.updated_at });
        return setAviso({ ok: false, texto: mensagemDeErro(d, "Não foi possível mover o artigo.") });
      }
      const salvo = d as { status: ArtigoStatus; slug: string; updated_at: string };
      trocar(artigo.id, { status: salvo.status, slug: salvo.slug || artigo.slug, updated_at: salvo.updated_at });
      setAviso({ ok: true, texto: textoOk });
    },
    [demo, trocar],
  );

  function irPara(nova: Aba) {
    setAba(nova);
    // Na URL, para o link e o F5 voltarem na mesma aba — sem navegar.
    const url = new URL(window.location.href);
    if (nova === "artigos") url.searchParams.delete("aba");
    else url.searchParams.set("aba", nova);
    window.history.replaceState(null, "", url);
  }

  const abrirConfiguracao = (foco: FocoDaGaveta = null) => setGaveta({ foco });

  return (
    <div className="@container flex h-screen flex-col overflow-hidden bg-conteudo">
      {demo && (
        <p className="shrink-0 bg-amber-50 px-6 py-1.5 text-center text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          Demonstração com dados fictícios: nada é gravado nem enviado.
        </p>
      )}

      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <header className="shrink-0 px-4 pt-4 @md:px-6 tela-baixa:pt-3">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <Link
              href="/blog"
              className="inline-flex items-center gap-1 text-[11px] text-zinc-400 transition hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-50"
            >
              <ArrowLeft className="size-3" aria-hidden="true" />
              Blogs
            </Link>
            <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{blog.nome}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {blog.url_base ? (
                <a
                  href={blog.url_base}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 text-[12px] text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  <span className="truncate">{urlComparavel(blog.url_base)}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                pode.editar && (
                  <button
                    type="button"
                    onClick={() => abrirConfiguracao("url_base")}
                    className="text-[12px] font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
                  >
                    Definir o endereço do blog
                  </button>
                )
              )}
              <SeloGoogle google={google} aoClicar={() => irPara("desempenho")} />
              <SeloAutomacao automacao={automacao} blogLigado={Boolean(blog.rss_ativo)} aoClicar={() => irPara("automacao")} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => abrirConfiguracao()}
            className="mt-4 flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 px-3.5 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <Settings2 className="size-3.5" aria-hidden="true" />
            Configurar
          </button>
        </div>

        <div className="mt-3 flex items-end gap-3 border-b border-zinc-200 dark:border-zinc-800">
          <nav role="tablist" aria-label="Seções do blog" className="flex gap-1">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={aba === a.id}
                onClick={() => irPara(a.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-[13px] transition ${
                  aba === a.id
                    ? "border-zinc-900 font-medium text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                    : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                {a.rotulo}
                {a.id === "artigos" && emRevisao > 0 && (
                  <span
                    title={`${emRevisao} em revisão`}
                    className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold leading-4 tabular-nums text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  >
                    {emRevisao}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {aba === "artigos" && artigos.length > 0 && (
            <label className="relative mb-1.5 ml-auto hidden w-full max-w-64 @2xl:block">
              <span className="sr-only">Buscar artigo</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por título ou palavra-chave"
                className="w-full rounded-full border border-zinc-200 bg-transparent py-1.5 pl-8 pr-3 text-[12px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
              />
            </label>
          )}
        </div>
      </header>

      {/* ── A aba ─────────────────────────────────────────────────────────── */}
      <main className="min-h-0 flex-1 pt-4">
        {aba === "artigos" && (
          <Quadro
            blog={blog}
            artigos={visiveis}
            pautas={pautas}
            google={google}
            pode={pode}
            destaque={destaque}
            aoAbrir={(artigo) => setAberto({ artigo })}
            aoMover={mover}
            aoIrParaFontes={() => irPara("automacao")}
          />
        )}
        {aba === "desempenho" && (
          <Desempenho
            google={google}
            artigos={artigos}
            blog={blog}
            periodo={periodo}
            atualizando={atualizandoGoogle}
            podeEditar={pode.editar}
            aoMudarPeriodo={mudarPeriodo}
            aoAtualizar={atualizarGoogle}
            aoAbrirArtigo={(artigo) => setAberto({ artigo, aba: "google" })}
            aoConfigurar={() => abrirConfiguracao("url_base")}
          />
        )}
        {aba === "automacao" && (
          <Automacao
            blogId={blog.id}
            rssAtivo={Boolean(blog.rss_ativo)}
            temDescricao={Boolean(blog.descricao?.trim())}
            automacao={automacao}
            podeEditar={pode.editar}
            demo={Boolean(demo)}
            fontesDemo={demo?.fontes}
            aoMudarFontes={({ rss_ativo, feeds }) => {
              setBlog((b) => ({ ...b, rss_ativo, feeds }));
              pautas.reler();
            }}
            aoMudarAutomacao={setAutomacao}
            aoRecarregar={() => {
              setAutomacao(null);
              setRecargaAutomacao((n) => n + 1);
            }}
            aoEscreverDescricao={() => abrirConfiguracao("descricao")}
          />
        )}
      </main>

      {aberto && (
        <PainelArtigo
          key={aberto.artigo.id}
          artigo={aberto.artigo}
          blog={blog}
          abaInicial={aberto.aba}
          pode={pode}
          demo={Boolean(demo)}
          googleDemo={demo?.googleDosArtigos[String(aberto.artigo.id)]}
          aoFechar={() => setAberto(null)}
          aoSalvar={(a) => {
            trocar(a.id, a);
            setAberto((x) => (x ? { ...x, artigo: a } : x));
          }}
          aoExcluir={(id) => {
            setArtigos((xs) => xs.filter((x) => x.id !== id));
            setAberto(null);
            setAviso({ ok: true, texto: "Artigo excluído." });
          }}
          // O slug vem junto porque postar pode tê-lo criado.
          aoTrocarStatus={(id, status, slug) => trocar(id, { status, ...(slug ? { slug } : {}), updated_at: agoraIso() })}
        />
      )}

      {gaveta && (
        <GavetaBlog
          blog={blog}
          base={base}
          basePublica={basePublica}
          pode={pode}
          foco={gaveta.foco}
          demo={Boolean(demo)}
          aoFechar={() => setGaveta(null)}
          aoSalvar={(b) => setBlog((atual) => ({ ...atual, ...b }))}
          aoExcluir={() => router.push("/blog")}
        />
      )}

      <Aviso aviso={aviso} aoFechar={fecharAviso} />
    </div>
  );
}

// ── Os dois selos do cabeçalho ──────────────────────────────────────────────
//
// Dizem, sem abrir a aba, se o Google e a automação estão de pé. O clique leva
// à aba que resolve.

function Selo({ cor, texto, aoClicar, carregando }: { cor: string; texto: string; aoClicar: () => void; carregando?: boolean }) {
  if (carregando) return <span className="h-5 w-32 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />;
  return (
    <button
      type="button"
      onClick={aoClicar}
      className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100/80 px-2 py-0.5 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
    >
      <span className={`size-1.5 rounded-full ${cor}`} aria-hidden="true" />
      {texto}
    </button>
  );
}

function SeloGoogle({ google, aoClicar }: { google: GoogleDoBlog | null; aoClicar: () => void }) {
  if (!google) return <Selo carregando cor="" texto="" aoClicar={aoClicar} />;
  return google.estado === "ok" ? (
    <Selo cor="bg-emerald-500" texto="Search Console conectado" aoClicar={aoClicar} />
  ) : google.estado === "erro" ? (
    <Selo cor="bg-red-500" texto="Google sem resposta" aoClicar={aoClicar} />
  ) : (
    <Selo cor="bg-amber-500" texto="Conectar o Search Console" aoClicar={aoClicar} />
  );
}

const proximaCurta = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function SeloAutomacao({
  automacao,
  blogLigado,
  aoClicar,
}: {
  automacao: EstadoAutomacao | null;
  blogLigado: boolean;
  aoClicar: () => void;
}) {
  if (!automacao) return <Selo carregando cor="" texto="" aoClicar={aoClicar} />;
  if (automacao.estado === "ligada" && blogLigado) {
    const quando = automacao.proxima ? proximaCurta.format(new Date(automacao.proxima)).replace(".", "") : "";
    return <Selo cor="bg-emerald-500" texto={`Automação ligada${quando ? ` · próxima ${quando}` : ""}`} aoClicar={aoClicar} />;
  }
  if (automacao.estado === "ligada") return <Selo cor="bg-zinc-400" texto="Este blog fora da automação" aoClicar={aoClicar} />;
  if (automacao.estado === "erro") return <Selo cor="bg-red-500" texto="Automação sem resposta" aoClicar={aoClicar} />;
  return <Selo cor="bg-zinc-400" texto="Automação desligada" aoClicar={aoClicar} />;
}
