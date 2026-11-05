"use client";

// A aba Automação: o robô que lê as fontes e escreve os artigos, e as fontes.
//
// DUAS CHAVES, e a tela mostra as duas porque uma sem a outra não gera nada:
//   · a automação no n8n (uma só para o CRM inteiro: ligar, pausar, quando roda,
//     como foram as últimas rodadas) — lib/blog-automacao.ts;
//   · este blog dentro dela (blog.rss_ativo), que só liga com fonte cadastrada.
//
// As fontes salvam a cada gesto (adicionar, tirar): é uma lista de cinco
// endereços, e um "Salvar" separado deixaria a automação das 7h lendo uma
// lista que a tela já não mostra. Cada fonte mostra a própria saúde — feed que
// parou não dá erro em lugar nenhum, só some da pauta.
import { useCallback, useEffect, useState } from "react";
import {
  AGENDA_AUTOMACAO,
  FONTES_SUGERIDAS,
  MAX_FEEDS,
  type EstadoAutomacao,
} from "@/lib/blog-automacao-tipos";
import { dataHora } from "@/lib/formato";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  PencilLine,
  Plus,
  RefreshCw,
  Rss,
  Sparkles,
  X,
} from "@/app/components/icones";
import { Interruptor, dominioDe, mensagemDeErro, tempoAtras } from "../pecas";

export type FonteDoBlog = { url: string; itens?: number; ultima?: string | null };

/** O que a tela do blog precisa saber depois de mexer nas fontes. */
export type MudancaDeFontes = { rss_ativo: boolean; feeds: number };

export default function Automacao({
  blogId,
  rssAtivo,
  temDescricao,
  automacao,
  podeEditar,
  demo,
  fontesDemo,
  aoMudarFontes,
  aoMudarAutomacao,
  aoRecarregar,
  aoEscreverDescricao,
}: {
  blogId: number;
  rssAtivo: boolean;
  temDescricao: boolean;
  automacao: EstadoAutomacao | null;
  podeEditar: boolean;
  demo?: boolean;
  fontesDemo?: FonteDoBlog[];
  aoMudarFontes: (m: MudancaDeFontes) => void;
  aoMudarAutomacao: (e: EstadoAutomacao) => void;
  aoRecarregar: () => void;
  aoEscreverDescricao: () => void;
}) {
  const [fontes, setFontes] = useState<FonteDoBlog[] | null>(fontesDemo ?? null);
  // Quando a saúde foi lida: é o "agora" da conta de feed parado.
  const [saudeEm, setSaudeEm] = useState<number | null>(() => (fontesDemo ? Date.now() : null));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (demo) return;
    let vivo = true;
    // Primeiro a lista (rápida), depois a saúde (lê cada feed, segundos).
    fetch(`/api/blogs/${blogId}/rss`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: { feeds: { url: string }[] }) => {
        if (!vivo) return;
        setFontes((atuais) => atuais ?? d.feeds.map((f) => ({ url: f.url })));
        return fetch(`/api/blogs/${blogId}/rss?saude=1`).then((r) => (r.ok ? r.json() : null));
      })
      .then((d: { saude?: { url: string; itens: number; ultima: string | null }[] } | null | undefined) => {
        if (!vivo || !d?.saude) return;
        setFontes(d.saude.map((s) => ({ url: s.url, itens: s.itens, ultima: s.ultima })));
        setSaudeEm(Date.now());
      })
      .catch(() => vivo && setErro("Não foi possível ler as fontes agora."));
    return () => {
      vivo = false;
    };
  }, [blogId, demo, recarga]);

  const salvar = useCallback(
    async (urls: string[], ativo: boolean) => {
      setErro(null);
      if (demo) {
        setFontes(urls.map((url) => ({ url, itens: 10, ultima: new Date().toISOString() })));
        aoMudarFontes({ rss_ativo: ativo, feeds: urls.length });
        return true;
      }
      setSalvando(true);
      const r = await fetch(`/api/blogs/${blogId}/rss`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rss_ativo: ativo, feeds: urls }),
      }).catch(() => null);
      const dados = await r?.json().catch(() => null);
      setSalvando(false);
      if (!r?.ok) {
        setErro(mensagemDeErro(dados, "Não foi possível salvar as fontes."));
        return false;
      }
      const salvo = dados as { rss_ativo: boolean; feeds: { url: string }[] };
      setFontes((atuais) => salvo.feeds.map((f) => atuais?.find((a) => a.url === f.url) ?? { url: f.url }));
      aoMudarFontes({ rss_ativo: salvo.rss_ativo, feeds: salvo.feeds.length });
      // A saúde da fonte nova vem por trás.
      setSaudeEm(null);
      setRecarga((n) => n + 1);
      return true;
    },
    [aoMudarFontes, blogId, demo],
  );

  const urls = fontes?.map((f) => f.url) ?? [];
  // Tirar a última fonte com o blog ligado seria recusado pela rota ("ligar
  // sem feed"): sai desligado junto.
  const adicionar = (url: string) => salvar([...urls, url], rssAtivo);
  const remover = (url: string) => {
    const resto = urls.filter((u) => u !== url);
    return salvar(resto, rssAtivo && resto.length > 0);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-6xl items-start gap-4 px-4 pb-10 @md:px-6 @4xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Robo
            automacao={automacao}
            rssAtivo={rssAtivo}
            temFontes={urls.length > 0}
            temDescricao={temDescricao}
            podeEditar={podeEditar}
            demo={demo}
            ocupado={salvando}
            aoLigarBlog={(novo) => salvar(urls, novo)}
            aoMudarAutomacao={aoMudarAutomacao}
            aoRecarregar={aoRecarregar}
            aoEscreverDescricao={aoEscreverDescricao}
          />
          <ComoFunciona />
        </div>

        <Fontes
          fontes={fontes}
          saudeEm={saudeEm}
          podeEditar={podeEditar}
          ocupado={salvando}
          erro={erro}
          aoAdicionar={adicionar}
          aoRemover={remover}
        />
      </div>
    </div>
  );
}

// ── O robô ──────────────────────────────────────────────────────────────────

const proximaFmt = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function Robo({
  automacao,
  rssAtivo,
  temFontes,
  temDescricao,
  podeEditar,
  demo,
  ocupado,
  aoLigarBlog,
  aoMudarAutomacao,
  aoRecarregar,
  aoEscreverDescricao,
}: {
  automacao: EstadoAutomacao | null;
  rssAtivo: boolean;
  temFontes: boolean;
  temDescricao: boolean;
  podeEditar: boolean;
  demo?: boolean;
  ocupado: boolean;
  aoLigarBlog: (novo: boolean) => void;
  aoMudarAutomacao: (e: EstadoAutomacao) => void;
  aoRecarregar: () => void;
  aoEscreverDescricao: () => void;
}) {
  const [acionando, setAcionando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ligada = automacao?.estado === "ligada";
  const daqui = automacao && "podeLigarDaqui" in automacao ? automacao.podeLigarDaqui : false;

  async function acionar(acao: "ligar" | "pausar") {
    setErro(null);
    if (demo) {
      aoMudarAutomacao(
        acao === "ligar"
          ? { estado: "ligada", workflowId: "demo", desatualizada: false, proxima: new Date(Date.now() + 86_400_000).toISOString(), execucoes: [], podeLigarDaqui: true }
          : { estado: "pausada", workflowId: "demo", desatualizada: false, proxima: null, execucoes: [], podeLigarDaqui: true },
      );
      return;
    }
    setAcionando(true);
    const r = await fetch("/api/blogs/rss/workflow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acao }),
    }).catch(() => null);
    const dados = await r?.json().catch(() => null);
    setAcionando(false);
    if (!r?.ok) {
      setErro(mensagemDeErro(dados, "O n8n não respondeu. Tente de novo."));
      return;
    }
    aoMudarAutomacao(dados as EstadoAutomacao);
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-start gap-3 px-5 pb-4 pt-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900">
          <Bot className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Automação de artigos</h2>
          <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">
            {AGENDA_AUTOMACAO.texto} · {AGENDA_AUTOMACAO.porBlog} artigos por blog
          </p>
        </div>
        <Situacao automacao={automacao} />
      </header>

      <div className="flex flex-col gap-4 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
        {!automacao ? (
          <div className="h-10 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        ) : automacao.estado === "sem-motor" ? (
          <Nota tom="neutro">O n8n não está configurado neste servidor (N8N_BASE_URL e N8N_API_KEY).</Nota>
        ) : automacao.estado === "erro" ? (
          <div className="flex items-center gap-3">
            <Nota tom="alerta">{automacao.mensagem}</Nota>
            <button type="button" onClick={aoRecarregar} className="shrink-0 text-[12px] font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-300">
              Tentar de novo
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-[13px] text-zinc-600 dark:text-zinc-300">
                {automacao.estado === "ligada" && automacao.proxima ? (
                  <>
                    Próxima rodada:{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{proximaFmt.format(new Date(automacao.proxima))}</span>
                  </>
                ) : automacao.estado === "nao-criada" ? (
                  "A automação ainda não existe no n8n. Ligar cria e já deixa rodando."
                ) : (
                  "Pausada: nenhum artigo é gerado até ligar de novo."
                )}
              </p>
              {podeEditar && daqui && (
                ligada ? (
                  <button
                    type="button"
                    onClick={() => acionar("pausar")}
                    disabled={acionando}
                    className="rounded-full px-3.5 py-1.5 text-[12px] font-medium text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {acionando ? "Pausando…" : "Pausar"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => acionar("ligar")}
                    disabled={acionando}
                    className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    {acionando ? "Ligando…" : "Ligar automação"}
                  </button>
                )
              )}
            </div>

            {automacao.estado !== "nao-criada" && automacao.desatualizada && podeEditar && daqui && (
              <Nota tom="alerta">
                O workflow no n8n é de uma versão anterior (agenda ou endereço antigos).{" "}
                <button type="button" onClick={() => acionar("ligar")} disabled={acionando} className="font-medium underline underline-offset-2">
                  Atualizar agora
                </button>
              </Nota>
            )}
            {podeEditar && !daqui && (
              <Nota tom="neutro">
                Ligar e pausar só pela tela do CRM no ar (amaanoffice.amaan.com.br): a automação é uma só para o CRM
                inteiro, e um ambiente de teste não pode desviá-la.
              </Nota>
            )}
            {erro && <Nota tom="alerta">{erro}</Nota>}
          </>
        )}

        {/* Este blog dentro da automação. */}
        <div className="flex items-center gap-3 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">Este blog na automação</p>
            <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">
              {!temFontes
                ? "Cadastre ao menos uma fonte para poder ligar."
                : rssAtivo
                  ? ligada
                    ? `Recebe ${AGENDA_AUTOMACAO.porBlog} artigos por rodada, para revisar antes de postar.`
                    : "Pronto, mas a automação está desligada: nada é gerado ainda."
                  : "Fica de fora das rodadas. Dá para gerar à mão pelas pautas."}
            </p>
          </div>
          <Interruptor
            ligado={rssAtivo}
            aoMudar={aoLigarBlog}
            rotulo="Este blog na automação"
            desabilitado={!podeEditar || ocupado || (!temFontes && !rssAtivo)}
          />
        </div>

        {!temDescricao && (
          <Nota tom="alerta">
            O blog não tem descrição: sem ela a IA não sabe o tema e escolhe só as notícias mais novas.{" "}
            {podeEditar && (
              <button type="button" onClick={aoEscreverDescricao} className="font-medium underline underline-offset-2">
                Escrever a descrição
              </button>
            )}
          </Nota>
        )}

        {automacao && "execucoes" in automacao && <Rodadas execucoes={automacao.execucoes} />}
      </div>
    </section>
  );
}

function Situacao({ automacao }: { automacao: EstadoAutomacao | null }) {
  if (!automacao) return null;
  const [rotulo, classe, pulsa] =
    automacao.estado === "ligada"
      ? ["Ligada", "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900", true]
      : automacao.estado === "pausada"
        ? ["Pausada", "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900", false]
        : automacao.estado === "erro"
          ? ["Sem resposta", "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900", false]
          : ["Desligada", "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700", false];
  return (
    <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${classe}`}>
      <span className="relative flex size-1.5">
        {pulsa && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
        <span className={`relative inline-flex size-1.5 rounded-full ${pulsa ? "bg-emerald-500" : "bg-current opacity-60"}`} />
      </span>
      {rotulo}
    </span>
  );
}

function Rodadas({ execucoes }: { execucoes: { id: string; inicio: string; fim: string | null; situacao: string }[] }) {
  return (
    <div>
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Últimas rodadas</h3>
      {execucoes.length === 0 ? (
        <p className="mt-1.5 text-[12px] text-zinc-400 dark:text-zinc-500">Nenhuma rodada ainda.</p>
      ) : (
        <ul className="mt-1.5 divide-y divide-zinc-100 dark:divide-zinc-800">
          {execucoes.map((e) => {
            const minutos = e.fim ? Math.max(1, Math.round((Date.parse(e.fim) - Date.parse(e.inicio)) / 60_000)) : null;
            const [rotulo, cor] =
              e.situacao === "sucesso"
                ? ["Concluída", "bg-emerald-500"]
                : e.situacao === "erro"
                  ? ["Falhou", "bg-red-500"]
                  : e.situacao === "rodando"
                    ? ["Rodando agora", "bg-sky-500 animate-pulse"]
                    : ["Interrompida", "bg-zinc-400"];
            return (
              <li key={e.id} className="flex items-center gap-2.5 py-2 text-[12px]">
                <span className={`size-1.5 shrink-0 rounded-full ${cor}`} aria-hidden="true" />
                <span className="text-zinc-700 dark:text-zinc-200">{dataHora(e.inicio)}</span>
                <span className="text-zinc-400 dark:text-zinc-500">{rotulo}</span>
                {minutos && <span className="ml-auto tabular-nums text-zinc-400 dark:text-zinc-500">{minutos} min</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ComoFunciona() {
  const passos = [
    { Icone: Rss, titulo: "Lê as fontes", texto: "As notícias novas dos feeds do blog, das últimas 72 horas." },
    { Icone: Sparkles, titulo: "Escolhe a pauta", texto: "A IA fica com as mais ligadas ao tema do blog e descarta cotação do dia." },
    { Icone: PencilLine, titulo: "Escreve", texto: "De 1.200 a 1.500 palavras a partir da matéria, com SEO, FAQ e fonte citada." },
    { Icone: CheckCircle2, titulo: "Espera você", texto: "Cai em Em revisão. Só vai ao site quando alguém posta." },
  ];
  return (
    <section className="rounded-2xl border border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Como funciona</h3>
      <ol className="mt-3 grid gap-4 @2xl:grid-cols-4">
        {passos.map((p, i) => (
          <li key={p.titulo} className="flex gap-3 @2xl:flex-col @2xl:gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              <p.Icone className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">
                <span className="tabular-nums text-zinc-400 dark:text-zinc-500">{i + 1}.</span> {p.titulo}
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{p.texto}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── As fontes ───────────────────────────────────────────────────────────────

function Fontes({
  fontes,
  saudeEm,
  podeEditar,
  ocupado,
  erro,
  aoAdicionar,
  aoRemover,
}: {
  fontes: FonteDoBlog[] | null;
  saudeEm: number | null;
  podeEditar: boolean;
  ocupado: boolean;
  erro: string | null;
  aoAdicionar: (url: string) => Promise<boolean>;
  aoRemover: (url: string) => Promise<boolean>;
}) {
  const [nova, setNova] = useState("");
  const [invalida, setInvalida] = useState(false);
  const cheia = (fontes?.length ?? 0) >= MAX_FEEDS;
  const cadastradas = new Set(fontes?.map((f) => f.url));

  async function adicionarDigitada() {
    const url = nova.trim();
    if (!url) return;
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) {
      setInvalida(true);
      return;
    }
    if (await aoAdicionar(url)) setNova("");
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-baseline gap-2 px-5 pb-3 pt-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Fontes de notícia</h2>
        <span className="text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">
          {fontes?.length ?? 0} de {MAX_FEEDS}
        </span>
        {ocupado && <RefreshCw className="ml-auto size-3.5 animate-spin text-zinc-400" aria-label="Salvando" />}
      </header>

      <div className="border-t border-zinc-100 dark:border-zinc-800">
        {!fontes ? (
          <div className="m-4 h-24 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        ) : fontes.length === 0 ? (
          <p className="px-5 py-5 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Nenhuma fonte ainda. Escolha entre as sugestões abaixo ou cole o endereço de um feed RSS.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {fontes.map((f) => (
              <li key={f.url} className="group flex items-center gap-3 px-5 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-[12px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {dominioDe(f.url).charAt(0) || "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{nomeDaFonte(f.url)}</p>
                  <Saude fonte={f} lidaEm={saudeEm} />
                </div>
                {podeEditar && (
                  <button
                    type="button"
                    onClick={() => aoRemover(f.url)}
                    disabled={ocupado}
                    aria-label={`Tirar ${nomeDaFonte(f.url)}`}
                    title="Tirar esta fonte"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30 [@media(hover:none)]:opacity-100 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {erro && <p className="px-5 pb-2 text-[12px] text-red-600 dark:text-red-400">{erro}</p>}

        {podeEditar && (
          <div className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <div className="flex gap-2">
              <input
                value={nova}
                onChange={(e) => {
                  setNova(e.target.value);
                  setInvalida(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && adicionarDigitada()}
                disabled={cheia || ocupado}
                placeholder={cheia ? "Limite de 5 fontes: tire uma para trocar" : "Cole o endereço de um feed RSS"}
                aria-invalid={invalida}
                className={`min-w-0 flex-1 rounded-full border bg-transparent px-3.5 py-1.5 font-mono text-[12px] text-zinc-900 outline-none transition placeholder:font-sans placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-50 ${
                  invalida ? "border-red-400" : "border-zinc-200 focus:border-zinc-400 dark:border-zinc-700 dark:focus:border-zinc-500"
                }`}
              />
              <button
                type="button"
                onClick={adicionarDigitada}
                disabled={cheia || ocupado || !nova.trim()}
                className="rounded-full bg-zinc-900 px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Adicionar
              </button>
            </div>
            {invalida && <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">Use um endereço que comece com https://</p>}

            {(["economia", "imoveis"] as const).map((tema) => {
              const livres = FONTES_SUGERIDAS.filter((s) => s.tema === tema && !cadastradas.has(s.url));
              if (livres.length === 0) return null;
              return (
                <div key={tema} className="mt-4">
                  <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {tema === "economia" ? "Mercado e economia" : "Mercado imobiliário"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {livres.map((s) => (
                      <button
                        key={s.url}
                        type="button"
                        onClick={() => aoAdicionar(s.url)}
                        disabled={cheia || ocupado}
                        title={cheia ? "Limite de 5 fontes: tire uma para adicionar" : s.url}
                        className="flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                      >
                        <Plus className="size-2.5" aria-hidden="true" />
                        {s.nome}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="mt-4 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              As sugestões foram conferidas: o feed traz notícia do dia e a matéria abre sem paywall.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** O nome que a sugestão dá à fonte; para as outras, o domínio. */
function nomeDaFonte(url: string): string {
  return FONTES_SUGERIDAS.find((s) => s.url === url)?.nome ?? dominioDe(url) ?? url;
}

const SEMANA_MS = 7 * 86_400_000;

function Saude({ fonte, lidaEm }: { fonte: FonteDoBlog; lidaEm: number | null }) {
  if (lidaEm === null || fonte.itens === undefined) {
    return <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">conferindo…</p>;
  }
  const parada = fonte.ultima && lidaEm - Date.parse(fonte.ultima) > SEMANA_MS;
  const [cor, texto] =
    fonte.itens === 0
      ? ["bg-red-500", "Não respondeu agora"]
      : parada
        ? ["bg-amber-500", `Parada: a mais nova é ${tempoAtras(fonte.ultima!, lidaEm)}`]
        : ["bg-emerald-500", `${fonte.itens} notícias${fonte.ultima ? ` · a mais nova ${tempoAtras(fonte.ultima, lidaEm)}` : ""}`];
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
      <span className={`size-1.5 shrink-0 rounded-full ${cor}`} aria-hidden="true" />
      <span className="truncate">{texto}</span>
    </p>
  );
}

function Nota({ tom, children }: { tom: "alerta" | "neutro"; children: React.ReactNode }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
        tom === "alerta"
          ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          : "bg-zinc-50 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300"
      }`}
    >
      {tom === "alerta" && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
      <span>{children}</span>
    </p>
  );
}
