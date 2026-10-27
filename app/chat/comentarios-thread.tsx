"use client";

// Os comentários de UMA postagem do Instagram, em thread, e a resposta
// (2026-10-26).
//
// A thread é montada aqui pelo pai_id: cada comentário na postagem é uma raiz,
// e tudo o que responde a ele — de outras pessoas ou nosso — fica embaixo,
// recuado, como no Instagram (que só tem um nível). A IA só responde comentário
// raiz, então a resposta dela aparece sempre embaixo da raiz.
//
// As nossas respostas dizem QUEM falou pela marca, como os balões da conversa:
// a IA (violeta), alguém da equipe pelo CRM ou pelo app do celular.
//
// Responder: "Chamar no direct" (private reply: uma por comentário, até 7 dias)
// é de quem atende; "Responder em público" fala pela marca na postagem e só
// aparece para Admin e TI (podeAdministrar). A ação recebe o id da LINHA do
// comentário no CRM — nunca o id da Meta (revisão de segurança, item 6).
//
// Abrir a postagem marca os comentários dela como lidos, inclusive quando chega
// comentário novo com ela aberta — o mesmo "abriu = leu" da conversa.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { dataDoInstante, dataHora, horaCurta } from "@/lib/formato";
import type { IaResumo } from "@/lib/ia/catalogo";
import type { ComentarioInstagram, ContaInstagram, PostagemInstagram, RegraIaInstagram } from "@/lib/instagram-tipos";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  MessageCircle,
  MessagesSquare,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  X,
} from "@/app/components/icones";
import { comentariosAnteriores, marcarComentariosLidos, responderComentario, sincronizarComentarios } from "./acoes-instagram";
import { RegraIaComentarios } from "./regras-ia-instagram";
import { Avatar, MiniaturaPostagem, diaDe } from "./ui";

type Modo = "publico" | "direct";
type Aviso = { tipo: "ok" | "erro"; texto: string };

const botaoSecundario =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900";
const botaoPrimario =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

/** Hoje, só a hora; antes, dia e hora — comentário velho sem data confunde. */
function quando(iso: string, agora: number) {
  return diaDe(iso) === diaDe(new Date(agora).toISOString()) ? horaCurta(iso) : dataHora(iso);
}

/** Raízes na ordem em que chegaram, e as respostas de cada uma (pelo id da Meta da raiz). */
function montarThread(comentarios: ComentarioInstagram[]) {
  const porId = new Map(comentarios.map((c) => [c.comentarioId, c]));
  const raizDe = (c: ComentarioInstagram) => {
    let atual = c;
    // Teto de passos: pai_id em ciclo (dado torto) não trava a tela.
    for (let i = 0; i < 10; i++) {
      const pai = atual.paiId ? porId.get(atual.paiId) : undefined;
      if (!pai) break;
      atual = pai;
    }
    return atual;
  };
  const raizes: ComentarioInstagram[] = [];
  const respostas = new Map<string, ComentarioInstagram[]>();
  for (const c of comentarios) {
    const raiz = raizDe(c);
    if (raiz === c) raizes.push(c);
    else respostas.set(raiz.comentarioId, [...(respostas.get(raiz.comentarioId) ?? []), c]);
  }
  return { raizes, respostas };
}

function juntarComentarios(anteriores: ComentarioInstagram[], novos: ComentarioInstagram[]) {
  return [...new Map([...anteriores, ...novos].map((c) => [c.id, c])).values()]
    .sort((a, b) => a.quando.localeCompare(b.quando) || a.id.localeCompare(b.id));
}

export function ThreadComentarios({
  conta,
  postagemId,
  postagem,
  comentarios,
  regras,
  ias,
  podeAdministrar,
  podeResponderPublico,
  podeResponderDirect,
  antesComentarios,
  temMaisComentarios,
  demo,
  aoVoltar,
  aoAbrirConversa,
}: {
  conta: ContaInstagram;
  postagemId: string;
  /** null quando a postagem aberta não está entre as recentes lidas da Meta. */
  postagem: PostagemInstagram | null;
  comentarios: ComentarioInstagram[];
  regras: RegraIaInstagram[];
  ias: IaResumo[];
  podeAdministrar: boolean;
  podeResponderPublico: boolean;
  podeResponderDirect: boolean;
  antesComentarios: string | null;
  temMaisComentarios: boolean;
  demo: boolean;
  aoVoltar: () => void;
  aoAbrirConversa: (atendimentoId: string) => void;
}) {
  const [agora, setAgora] = useState(() => Date.now());
  const [alvo, setAlvo] = useState<ComentarioInstagram | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [buscando, iniciarBusca] = useTransition();
  const [, iniciarLeitura] = useTransition();
  const rolagem = useRef<HTMLDivElement>(null);
  const [carga, setCarga] = useState({ fonte: comentarios, lista: comentarios });
  const [pagina, setPagina] = useState({ antes: antesComentarios, temMais: temMaisComentarios });
  const [carregouAnteriores, setCarregouAnteriores] = useState(false);
  const paginaAtual = carregouAnteriores ? pagina : { antes: antesComentarios, temMais: temMaisComentarios };
  const [carregandoAntigos, carregarAntigos] = useTransition();
  const [enviandoResposta, setEnviandoResposta] = useState(false);
  const [lidos, setLidos] = useState<Set<string>>(new Set());
  const lendo = useRef(false);
  const alturaAnterior = useRef<number | null>(null);
  const seguirFim = useRef(true);
  if (carga.fonte !== comentarios) setCarga({ fonte: comentarios, lista: juntarComentarios(carga.lista, comentarios) });
  const lista = useMemo(() => carga.lista.map((c) => lidos.has(c.id) ? { ...c, lido: true } : c), [carga.lista, lidos]);

  const { raizes, respostas } = useMemo(() => montarThread(lista), [lista]);
  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // A thread nasce por postagem (key no pai): abre no fim, onde está o mais novo.
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    if (alturaAnterior.current !== null) {
      el.scrollTop += el.scrollHeight - alturaAnterior.current;
      alturaAnterior.current = null;
    } else if (seguirFim.current) el.scrollTop = el.scrollHeight;
  }, [lista]);

  // Abriu = leu. A contagem da Meta entra junto: comentário não lido fora da
  // lista carregada também conta.
  const pendentes = lista.filter((c) => !c.daConta && !c.lido).map((c) => c.id).slice(0, 1000).join(",");
  useEffect(() => {
    if (demo || !pendentes || lendo.current) return;
    lendo.current = true;
    iniciarLeitura(async () => {
      try {
        const ids = pendentes.split(",");
        const r = await marcarComentariosLidos(conta.id, postagemId, ids);
        if (!r.ok) setAviso({ tipo: "erro", texto: r.erro });
        else setLidos((atuais) => new Set([...atuais, ...ids]));
      } catch {
        setAviso({ tipo: "erro", texto: "Não consegui marcar estes comentários como lidos." });
      } finally { lendo.current = false; }
    });
  }, [conta.id, postagemId, pendentes, demo]);

  function anteriores() {
    if (demo || carregandoAntigos || !paginaAtual.antes) return;
    const antes = paginaAtual.antes;
    carregarAntigos(async () => {
      try {
        const r = await comentariosAnteriores(conta.id, postagemId, antes);
        if (!r.ok) { setAviso({ tipo: "erro", texto: r.erro }); return; }
        alturaAnterior.current = rolagem.current?.scrollHeight ?? null;
        setCarga((atual) => ({ ...atual, lista: juntarComentarios(r.comentarios, atual.lista) }));
        setPagina({ antes: r.antes, temMais: r.temMais });
        setCarregouAnteriores(true);
      } catch { setAviso({ tipo: "erro", texto: "Não consegui carregar os comentários anteriores." }); }
    });
  }

  function buscar() {
    if (demo || buscando) return;
    setAviso(null);
    iniciarBusca(async () => {
      try {
        const r = await sincronizarComentarios(conta.id, postagemId);
        if (r.ok) setCarregouAnteriores(false);
        if (!r.ok) setAviso({ tipo: "erro", texto: r.erro });
        else
          setAviso({
            tipo: "ok",
            texto:
              r.novos === 0 ? "Nenhum comentário novo." : r.novos === 1 ? "1 comentário novo." : `${r.novos} comentários novos.`,
          });
      } catch { setAviso({ tipo: "erro", texto: "Não consegui buscar os comentários. Tente novamente." }); }
    });
  }

  const legenda = (postagem?.legenda ?? "").replace(/\s+/g, " ").trim();
  // O link vem da Meta; mesmo assim, só https vira href.
  const link = postagem?.link?.startsWith("https://") ? postagem.link : null;
  const total = postagem?.comentarios ?? comentarios.filter((c) => !c.daConta).length;

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-2 sm:gap-3 sm:px-4 dark:border-zinc-800 dark:bg-zinc-950">
        <button
          type="button"
          onClick={aoVoltar}
          aria-label="Voltar para as postagens"
          className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-900"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <MiniaturaPostagem src={postagem?.miniatura ?? null} tipo={postagem?.tipo ?? "IMAGE"} tamanho={38} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-50">
            {legenda || "Postagem sem legenda"}
          </span>
          <span className="block truncate text-[11.5px] text-zinc-500 dark:text-zinc-400" suppressHydrationWarning>
            {postagem ? `${dataDoInstante(postagem.quando)} · ` : ""}
            {total} {total === 1 ? "comentário" : "comentários"}
          </span>
        </span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            title="Ver no Instagram"
            aria-label="Ver no Instagram"
            className="shrink-0 rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        )}
        <button
          type="button"
          onClick={buscar}
          disabled={demo || buscando}
          title="Buscar no Instagram os comentários que ainda não chegaram ao CRM"
          className={botaoSecundario}
        >
          {buscando ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
          <span className="hidden sm:inline">Buscar comentários</span>
          <span className="sr-only sm:hidden">Buscar comentários</span>
        </button>
      </header>

      <div className="shrink-0 border-b border-zinc-200 bg-white px-3 py-2 tela-baixa:py-1.5 sm:px-4 dark:border-zinc-800 dark:bg-zinc-950">
        <RegraIaComentarios
          contaId={conta.id}
          usuario={conta.usuario}
          midiaId={postagemId}
          regras={regras}
          ias={ias}
          podeAdministrar={podeAdministrar}
          demo={demo}
        />
      </div>

      {aviso && (
        <div
          role={aviso.tipo === "erro" ? "alert" : "status"}
          className={`flex shrink-0 items-start gap-2 border-b px-4 py-2 text-[12px] ${
            aviso.tipo === "erro"
              ? "border-red-100 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
              : "border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200"
          }`}
        >
          <span className="min-w-0 flex-1">{aviso.texto}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" className="shrink-0 rounded opacity-70 hover:opacity-100">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <div ref={rolagem} onScroll={() => {
        const el = rolagem.current;
        if (el) seguirFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }} className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 dark:bg-zinc-900/30">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-6">
          {paginaAtual.temMais && (
            <button type="button" onClick={anteriores} disabled={carregandoAntigos || demo} className={`${botaoSecundario} mx-auto`}>
              {carregandoAntigos ? "Carregando…" : "Carregar comentários anteriores"}
            </button>
          )}
          {raizes.length === 0 ? (
            <div className="m-auto flex flex-col items-center gap-2 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                <MessagesSquare className="size-5 text-zinc-400" aria-hidden="true" />
              </span>
              <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Nenhum comentário registrado</p>
              <p className="max-w-xs text-[12px] text-zinc-500 dark:text-zinc-400">
                Os comentários novos chegam sozinhos. Os de antes entram com “Buscar comentários”.
              </p>
            </div>
          ) : (
            raizes.map((r) => (
              <div key={r.id} className="flex flex-col gap-2">
                <ItemComentario
                  c={r}
                  conta={conta}
                  agora={agora}
                  selecionado={alvo?.id === r.id}
                  demo={demo || enviandoResposta || (!podeResponderPublico && !podeResponderDirect)}
                  aoResponder={setAlvo}
                  aoAbrirConversa={aoAbrirConversa}
                />
                {(respostas.get(r.comentarioId) ?? []).map((f) => (
                  <ItemComentario
                    key={f.id}
                    c={f}
                    conta={conta}
                    agora={agora}
                    resposta
                    selecionado={alvo?.id === f.id}
                    demo={demo || enviandoResposta || (!podeResponderPublico && !podeResponderDirect)}
                    aoResponder={setAlvo}
                    aoAbrirConversa={aoAbrirConversa}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <RespostaComentario
        agora={agora}
        alvo={lista.find((c) => c.id === alvo?.id) ?? alvo}
        podeResponderPublico={podeResponderPublico}
        podeResponderDirect={podeResponderDirect}
        aoOcupar={setEnviandoResposta}
        demo={demo}
        aoCancelar={() => setAlvo(null)}
        aoEnviado={(modo) => {
          setAlvo(null);
          setAviso({ tipo: "ok", texto: modo === "publico" ? "Resposta publicada na postagem." : "Mensagem enviada no direct." });
        }}
      />
    </>
  );
}

// ── Um comentário ───────────────────────────────────────────────────────────

function ItemComentario({
  c,
  conta,
  agora,
  resposta = false,
  selecionado,
  demo,
  aoResponder,
  aoAbrirConversa,
}: {
  c: ComentarioInstagram;
  conta: ContaInstagram;
  agora: number;
  /** Recuado embaixo da raiz. */
  resposta?: boolean;
  selecionado: boolean;
  demo: boolean;
  aoResponder: (c: ComentarioInstagram) => void;
  aoAbrirConversa: (atendimentoId: string) => void;
}) {
  const nosso = c.daConta;
  const ia = nosso && c.enviadaPor === "ia";
  const autor = nosso ? conta.usuario : (c.autorUsuario ?? "sem nome");
  // As mesmas vozes dos balões da conversa: IA em violeta, gente da casa escuro.
  const cor = !nosso
    ? "bg-white text-zinc-800 ring-1 ring-zinc-200/80 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800"
    : ia
      ? "bg-violet-50 text-violet-950 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-50 dark:ring-violet-400/25"
      : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  const apagado = nosso && !ia ? "text-white/60 dark:text-zinc-900/55" : "text-zinc-400 dark:text-zinc-500";
  const atendimentoId = c.atendimentoId;

  return (
    <div className={`flex gap-2.5 ${resposta ? "ml-10" : ""}`}>
      <Avatar nome={nosso ? conta.nome : autor} tamanho={resposta ? 26 : 32} />
      <div className="min-w-0 flex-1">
        <div
          className={`inline-block max-w-full rounded-2xl rounded-tl-md px-3 py-2 ${cor} ${
            selecionado ? "outline outline-2 outline-offset-2 outline-pink-400" : ""
          }`}
        >
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px]">
            <span className="font-semibold">@{autor}</span>
            {nosso && <QuemRespondeu enviadaPor={c.enviadaPor} apagado={apagado} />}
            <time dateTime={c.quando} suppressHydrationWarning className={`tabular-nums ${apagado}`}>
              {quando(c.quando, agora)}
            </time>
            {!nosso && !c.lido && <span className="size-1.5 shrink-0 rounded-full bg-pink-500" role="img" aria-label="Não lido" />}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{c.texto}</p>
        </div>
        {!nosso && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11.5px] font-medium">
            <button
              type="button"
              onClick={() => aoResponder(c)}
              disabled={demo}
              aria-pressed={selecionado}
              className="rounded text-zinc-500 transition hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Responder
            </button>
            {atendimentoId && (
              <button
                type="button"
                onClick={() => aoAbrirConversa(atendimentoId)}
                className="inline-flex items-center gap-1 rounded text-pink-600 transition hover:text-pink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400 dark:text-pink-300 dark:hover:text-pink-100"
              >
                <MessageCircle className="size-3" aria-hidden="true" />
                Conversa no direct
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function QuemRespondeu({ enviadaPor, apagado }: { enviadaPor: ComentarioInstagram["enviadaPor"]; apagado: string }) {
  if (enviadaPor === "ia")
    return (
      <span className="inline-flex items-center gap-1 font-medium text-violet-600 dark:text-violet-300">
        <Sparkles className="size-3" aria-hidden="true" /> Assistente IA
      </span>
    );
  if (enviadaPor === "aparelho")
    return (
      <span className={`inline-flex items-center gap-1 ${apagado}`}>
        <Smartphone className="size-3" aria-hidden="true" /> pelo celular
      </span>
    );
  if (enviadaPor === "crm") return <span className={apagado}>pela equipe</span>;
  return null;
}

// ── A resposta ──────────────────────────────────────────────────────────────

function RespostaComentario({
  alvo,
  agora,
  podeResponderPublico,
  podeResponderDirect,
  aoOcupar,
  demo,
  aoCancelar,
  aoEnviado,
}: {
  alvo: ComentarioInstagram | null;
  agora: number;
  podeResponderPublico: boolean;
  podeResponderDirect: boolean;
  aoOcupar: (ocupado: boolean) => void;
  demo: boolean;
  aoCancelar: () => void;
  aoEnviado: (modo: Modo) => void;
}) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo | null>(null);
  const [enviando, iniciar] = useTransition();
  const campo = useRef<HTMLTextAreaElement>(null);
  const motivoDirect = alvo ? (alvo.motivoDirect ??
    (agora - Date.parse(alvo.quando) > 7 * 24 * 60 * 60_000 ? "O prazo de 7 dias para chamar no direct terminou." : null)) : null;

  // Trocou o comentário respondido: o erro era do outro. O texto fica — a
  // pessoa pode ter escrito e só depois escolhido a quem.
  const [alvoVisto, setAlvoVisto] = useState(alvo?.id ?? null);
  if (alvoVisto !== (alvo?.id ?? null)) {
    setAlvoVisto(alvo?.id ?? null);
    setErro(null);
  }

  // Escolheu a quem responder: o cursor vai para o campo.
  useEffect(() => {
    if (alvo) campo.current?.focus();
  }, [alvo]);

  function enviar(m: Modo) {
    if (!alvo || enviando || demo || (m === "publico" ? !podeResponderPublico : !podeResponderDirect || Boolean(motivoDirect))) return;
    const corpo = texto.trim();
    if (!corpo) return;
    setErro(null);
    setModo(m);
    aoOcupar(true);
    iniciar(async () => {
      try {
        const r = await responderComentario(alvo.id, corpo, m);
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        setTexto("");
        aoEnviado(m);
      } catch { setErro("Não consegui confirmar o envio. Confira os comentários antes de tentar novamente."); }
      finally { aoOcupar(false); }
    });
  }

  if (!alvo) {
    return (
      <div className="shrink-0 border-t border-zinc-200 bg-white px-4 py-3 text-center text-[12px] text-zinc-500 tela-baixa:py-2.5 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        {podeResponderDirect || podeResponderPublico ? "Clique em “Responder” num comentário para escrever." : "Seu acesso permite visualizar os comentários."}
      </div>
    );
  }

  const vazio = !texto.trim();
  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white px-3 pb-3 pt-2 sm:px-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="flex items-center gap-2 px-1 text-[11.5px] text-zinc-500 dark:text-zinc-400">
          <span className="shrink-0">
            Respondendo a <strong className="font-semibold text-zinc-800 dark:text-zinc-100">@{alvo.autorUsuario ?? "sem nome"}</strong>
          </span>
          <span className="min-w-0 flex-1 truncate italic">“{alvo.texto}”</span>
          <button
            type="button"
            onClick={aoCancelar}
            disabled={enviando}
            aria-label="Cancelar resposta"
            className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:text-zinc-200"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>

        {erro && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {erro}
          </p>
        )}

        <textarea
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          maxLength={podeResponderPublico ? 2200 : 1000}
          disabled={demo || enviando || (!podeResponderPublico && (!podeResponderDirect || Boolean(motivoDirect)))}
          aria-label="Resposta ao comentário"
          placeholder={demo ? "Demonstração — nada é enviado" : "Escreva a resposta"}
          className="max-h-32 min-h-10 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-[13.5px] leading-5 text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/5 disabled:opacity-60 tela-baixa:py-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-600"
        />

        {motivoDirect && <p role="status" className="text-[11px] text-amber-700 dark:text-amber-300">{motivoDirect}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto min-w-0 flex-1 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
            {podeResponderPublico
              ? "Em público, todos veem na postagem. No direct, uma mensagem por comentário, até 7 dias depois."
              : "No direct, uma mensagem por pessoa por postagem, até 7 dias depois."}
          </p>
          <button type="button" onClick={() => enviar("direct")} disabled={demo || enviando || vazio || !podeResponderDirect || Boolean(motivoDirect) || texto.trim().length > 1000} title={motivoDirect ?? undefined} className={botaoSecundario}>
            {enviando && modo === "direct" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            Chamar no direct
          </button>
          {podeResponderPublico && (
            <button type="button" onClick={() => enviar("publico")} disabled={demo || enviando || vazio || texto.trim().length > 2200} className={botaoPrimario}>
              {enviando && modo === "publico" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <MessageCircle className="size-3.5" aria-hidden="true" />
              )}
              Responder em público
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
