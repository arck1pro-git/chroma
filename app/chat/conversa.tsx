"use client";

// A conversa aberta: cabeçalho, mensagens e compositor.
//
// OS BALÕES DIZEM QUEM FALOU, não só de que lado. Do nosso lado há três vozes,
// e a diferença importa para quem vai responder:
//   · alguém da equipe pelo CRM  → escuro, com o nome de quem mandou;
//   · alguém pelo celular        → escuro, marcado "pelo celular";
//   · a automação (campanha/IA)  → violeta, marcado "automação".
// Ver "automação" na conversa é o que avisa que a pessoa pode estar
// respondendo a uma mensagem que ninguém da equipe escreveu.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  Bot,
  CircleCheck,
  Download,
  FileText,
  Hand,
  Loader2,
  MapPin,
  PanelRightOpen,
  RotateCcw,
  Smartphone,
  Sparkles,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { Usuario } from "../data";
import type { CanalChat, ConversaAberta, MensagemChat } from "./tipos";
import {
  Avatar,
  Entrega,
  PAPEL,
  TextoWhatsApp,
  diaDe,
  formatarTelefone,
  fotoDoContato,
  rotuloDoDia,
  tipoDaConversa,
} from "./ui";
import { horaCurta } from "../formato";

// ── Cabeçalho ───────────────────────────────────────────────────────────────

const botaoSecundario =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900";
const botaoPrimario =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

export function CabecalhoConversa({
  aberta,
  canal,
  usuarios,
  usuarioId,
  demo,
  detalhesAbertos,
  aoVoltar,
  aoAssumir,
  aoEncerrar,
  aoReabrir,
  aoOportunidade,
  aoDetalhes,
}: {
  aberta: ConversaAberta;
  canal: CanalChat | undefined;
  usuarios: Usuario[];
  usuarioId: string;
  demo: boolean;
  detalhesAbertos: boolean;
  aoVoltar: () => void;
  aoAssumir: () => void;
  aoEncerrar: () => void;
  aoReabrir: () => void;
  aoOportunidade: () => void;
  aoDetalhes: () => void;
}) {
  const { resumo, contato } = aberta;
  const papel = PAPEL[tipoDaConversa(resumo)];
  const dono = resumo.responsavel_id ? usuarios.find((u) => u.id === resumo.responsavel_id) : null;
  const semDono = resumo.status !== "encerrado" && !resumo.responsavel_id;
  const nome = /^[\d\s+()-]+$/.test(contato.nome) ? formatarTelefone(contato.nome) : contato.nome;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-2 sm:gap-3 sm:px-4 dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        onClick={aoVoltar}
        aria-label="Voltar para a lista"
        className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-900"
      >
        <ArrowLeft className="size-4" />
      </button>

      <button type="button" onClick={aoDetalhes} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left">
        <Avatar nome={contato.nome} src={fotoDoContato(contato.id, resumo.numero_instancia, demo)} tamanho={38} />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">{nome}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
            <span className="hidden truncate tabular-nums sm:inline">{formatarTelefone(contato.whatsapp)}</span>
            <span className="hidden sm:inline" aria-hidden="true">·</span>
            <span className={`inline-flex min-w-0 items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-medium ring-1 ${papel.chip}`}>
              <papel.Icone className="size-2.5 shrink-0" />
              <span className="truncate">{canal?.nome ?? papel.meio}</span>
            </span>
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Quem cuida desta conversa — a pergunta que se faz antes de responder. */}
        <span className="hidden items-center gap-1.5 text-[11.5px] text-zinc-500 xl:inline-flex dark:text-zinc-400">
          {resumo.status === "encerrado" ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium dark:bg-zinc-900">Encerrada</span>
          ) : resumo.status === "na_fila" ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              Na fila
            </span>
          ) : dono ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-900">
              com <strong className="font-medium text-zinc-800 dark:text-zinc-200">{dono.id === usuarioId ? "você" : dono.nome}</strong>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
              <Bot className="size-3" /> em automação
            </span>
          )}
        </span>

        {semDono && (
          <button type="button" onClick={aoAssumir} disabled={demo} className={botaoPrimario}>
            <Hand className="size-3.5" />
            Assumir
          </button>
        )}
        {resumo.status === "aberto" && !semDono && (
          <button type="button" onClick={aoEncerrar} disabled={demo} className={botaoSecundario} title="Encerrar conversa">
            <CircleCheck className="size-3.5" />
            <span className="hidden sm:inline">Encerrar</span>
          </button>
        )}
        {resumo.status === "encerrado" && (
          <button type="button" onClick={aoReabrir} disabled={demo} className={botaoSecundario}>
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">Reabrir</span>
          </button>
        )}
        <button
          type="button"
          onClick={aoOportunidade}
          disabled={demo}
          title="Criar oportunidade para este contato"
          aria-label="Criar oportunidade"
          className="hidden shrink-0 rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 sm:inline-flex dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          <Wallet className="size-4" />
        </button>
        <button
          type="button"
          onClick={aoDetalhes}
          aria-pressed={detalhesAbertos}
          title="Dados do contato"
          aria-label="Dados do contato"
          className={`shrink-0 rounded-lg p-2 transition ${
            detalhesAbertos
              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          }`}
        >
          <PanelRightOpen className="size-4" />
        </button>
      </div>
    </header>
  );
}

// ── Mensagens ───────────────────────────────────────────────────────────────

// Mensagens do mesmo lado, da mesma voz e a menos de 5 min uma da outra formam
// um bloco: só a primeira leva o nome e o canto "puxado".
const MESMO_BLOCO_MS = 5 * 60_000;

function voz(m: MensagemChat) {
  return m.origem === "contato" ? "contato" : `${m.enviada_por ?? "crm"}:${m.autor_id ?? ""}`;
}

export function Mensagens({
  mensagens,
  usuarios,
  conversaId,
  carregando,
}: {
  mensagens: MensagemChat[];
  usuarios: Usuario[];
  conversaId: string;
  carregando: boolean;
}) {
  const rolagem = useRef<HTMLDivElement>(null);
  const [agora] = useState(() => Date.now());
  const [novasAbaixo, setNovasAbaixo] = useState(false);
  const noFim = useRef(true);
  const ultimaConversa = useRef<string | null>(null);
  const usuarioPorId = useMemo(() => new Map(usuarios.map((u) => [u.id, u])), [usuarios]);

  // Rola até o fim ao abrir a conversa. Mensagem nova com a pessoa lendo lá em
  // cima NÃO arrasta a tela: aparece o botão "novas mensagens".
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    if (ultimaConversa.current !== conversaId || noFim.current) {
      el.scrollTop = el.scrollHeight;
      ultimaConversa.current = conversaId;
      setNovasAbaixo(false);
    } else {
      setNovasAbaixo(true);
    }
  }, [conversaId, mensagens.length]);

  function aoRolar() {
    const el = rolagem.current;
    if (!el) return;
    noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (noFim.current) setNovasAbaixo(false);
  }

  const itens: ReactNode[] = [];
  let diaAnterior = "";
  mensagens.forEach((m, i) => {
    const dia = diaDe(m.data_criacao);
    if (dia !== diaAnterior) {
      diaAnterior = dia;
      itens.push(
        <div key={`dia-${dia}`} className="sticky top-2 z-10 my-3 flex justify-center first:mt-0">
          <span
            suppressHydrationWarning
            className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-zinc-500 shadow-sm ring-1 ring-zinc-200 backdrop-blur dark:bg-zinc-900/90 dark:text-zinc-400 dark:ring-zinc-800"
          >
            {rotuloDoDia(m.data_criacao, agora)}
          </span>
        </div>,
      );
    }
    const anterior = mensagens[i - 1];
    const inicioDeBloco =
      !anterior ||
      diaDe(anterior.data_criacao) !== dia ||
      voz(anterior) !== voz(m) ||
      Date.parse(m.data_criacao) - Date.parse(anterior.data_criacao) > MESMO_BLOCO_MS;
    itens.push(
      <Balao
        key={m.id}
        mensagem={m}
        inicioDeBloco={inicioDeBloco}
        autor={m.autor_id ? (usuarioPorId.get(m.autor_id)?.nome ?? null) : null}
      />,
    );
  });

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={rolagem}
        onScroll={aoRolar}
        className="absolute inset-0 overflow-y-auto bg-zinc-50 dark:bg-zinc-900/30"
      >
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end px-3 py-4 sm:px-6">
          {mensagens.length === 0 ? (
            <div className="m-auto flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Nenhuma mensagem ainda</p>
              <p className="max-w-xs text-[12px] text-zinc-500 dark:text-zinc-400">
                A conversa começa com a primeira mensagem — sua ou do contato.
              </p>
            </div>
          ) : (
            itens
          )}
        </div>
      </div>

      {carregando && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-50/70 backdrop-blur-[1px] dark:bg-zinc-950/60">
          <Loader2 className="size-5 animate-spin text-zinc-400" />
        </div>
      )}

      {novasAbaixo && (
        <button
          type="button"
          onClick={() => {
            const el = rolagem.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            setNovasAbaixo(false);
          }}
          className="veu-surge absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
        >
          <ArrowDown className="size-3.5" />
          Novas mensagens
        </button>
      )}
    </div>
  );
}

function Balao({
  mensagem: m,
  inicioDeBloco,
  autor,
}: {
  mensagem: MensagemChat;
  inicioDeBloco: boolean;
  autor: string | null;
}) {
  const nosso = m.origem === "agente";
  // IA e automação dividem o violeta — as duas são "não foi gente" —, e o
  // rótulo acima do balão diz qual das duas.
  const ia = nosso && m.enviada_por === "ia";
  const automacao = nosso && (m.enviada_por === "automacao" || ia);
  const celular = nosso && m.enviada_por === "aparelho";
  const falhou = m.status === "erro";

  const cor = !nosso
    ? "bg-white text-zinc-800 ring-1 ring-zinc-200/80 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800"
    : automacao
      ? "bg-violet-50 text-violet-950 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-50 dark:ring-violet-400/25"
      : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  const canto = inicioDeBloco ? (nosso ? "rounded-tr-md" : "rounded-tl-md") : "";
  const apagado = nosso && !automacao ? "text-white/55 dark:text-zinc-900/50" : "text-zinc-400 dark:text-zinc-500";
  const link = nosso && !automacao ? "text-white dark:text-zinc-900" : "text-sky-600 dark:text-sky-400";

  return (
    <div className={`flex flex-col ${nosso ? "items-end" : "items-start"} ${inicioDeBloco ? "mt-3" : "mt-0.5"}`}>
      {nosso && inicioDeBloco && (automacao || celular || autor) && (
        <span
          className={`mb-1 inline-flex items-center gap-1 px-1 text-[10.5px] font-medium ${
            automacao ? "text-violet-600 dark:text-violet-300" : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {ia ? (
            <>
              <Sparkles className="size-3" /> Assistente IA
            </>
          ) : automacao ? (
            <>
              <Bot className="size-3" /> Automação
            </>
          ) : celular ? (
            <>
              <Smartphone className="size-3" /> {autor ? `${autor} · ` : ""}pelo celular
            </>
          ) : (
            autor
          )}
        </span>
      )}
      <div
        className={`relative max-w-[85%] rounded-2xl px-3 py-1.5 text-[13.5px] leading-relaxed shadow-[0_1px_0.5px_rgba(0,0,0,0.04)] sm:max-w-[72%] ${cor} ${canto} ${
          falhou ? "ring-2 ring-red-400/70" : ""
        }`}
      >
        {m.tipo !== "texto" && <Anexo mensagem={m} nosso={nosso && !automacao} />}
        {m.texto ? (
          <p className="whitespace-pre-wrap break-words">
            <TextoWhatsApp texto={m.texto} link={link} />
            {/* Reserva o canto da última linha para a hora, como no WhatsApp. */}
            <span className={`inline-block ${nosso ? "w-[58px]" : "w-10"}`} aria-hidden="true" />
          </p>
        ) : (
          <span className="block h-3" aria-hidden="true" />
        )}
        <span className={`absolute bottom-1 right-2.5 flex items-center gap-1 text-[10.5px] leading-none tabular-nums ${apagado}`}>
          {horaCurta(m.data_criacao)}
          {nosso && <Entrega status={m.status} className="size-3.5" />}
        </span>
      </div>
      {falhou && (
        <span className="mt-1 flex max-w-[85%] items-start gap-1 px-1 text-[11px] leading-snug text-red-600 sm:max-w-[72%] dark:text-red-400">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          <span>Não enviada{m.erro ? ` — ${m.erro}` : ""}</span>
        </span>
      )}
    </div>
  );
}

// ── Anexo ───────────────────────────────────────────────────────────────────
//
// O arquivo nunca é apontado pelo caminho no storage — vem sempre de
// /api/midia/<id da mensagem>, que confere a sessão antes de entregar.
// Os estados que não são 'salva' aparecem de propósito: "chegou um áudio que
// não conseguimos baixar" é informação, e escondê-lo faria buraco na conversa.

function tamanhoCurto(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function duracaoAudio(seg: number | null): string | null {
  if (!seg) return null;
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
}

function Anexo({ mensagem: m, nosso }: { mensagem: MensagemChat; nosso: boolean }) {
  const src = `/api/midia/${m.id}`;
  const apagado = nosso ? "text-white/60 dark:text-zinc-900/60" : "text-zinc-500 dark:text-zinc-400";

  if (m.tipo === "localizacao" || m.tipo === "contato") {
    return (
      <div className={`flex items-center gap-1.5 py-0.5 text-[12px] ${apagado}`}>
        <MapPin className="size-3.5 shrink-0" />
        <span>{m.tipo === "localizacao" ? "Localização" : "Contato"}</span>
      </div>
    );
  }
  if (m.midia_estado === "pendente") {
    return (
      <div className={`flex items-center gap-1.5 py-1 text-[12px] ${apagado}`}>
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        <span>Baixando anexo…</span>
      </div>
    );
  }
  if (m.midia_estado === "erro") {
    return (
      <div className="flex items-start gap-1.5 py-1 text-[12px] text-amber-600 dark:text-amber-400">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>Anexo não salvo{m.midia_erro ? ` — ${m.midia_erro}` : ""}</span>
      </div>
    );
  }
  if (m.tipo === "imagem" || m.tipo === "sticker") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="-mx-1.5 -mt-0.5 mb-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={m.texto || "Imagem"}
          loading="lazy"
          className={`w-auto rounded-xl ${m.tipo === "sticker" ? "max-h-32" : "max-h-80"}`}
        />
      </a>
    );
  }
  if (m.tipo === "audio") {
    return (
      <div className="mb-1 flex items-center gap-2 pt-1">
        <audio controls preload="none" src={src} className="h-9 w-60 max-w-full">
          <a href={src}>Baixar áudio</a>
        </audio>
        {duracaoAudio(m.midia_duracao) && <span className={`text-[10px] tabular-nums ${apagado}`}>{duracaoAudio(m.midia_duracao)}</span>}
      </div>
    );
  }
  if (m.tipo === "video") {
    return (
      <video controls preload="metadata" src={src} className="-mx-1.5 -mt-0.5 mb-1 max-h-80 w-auto rounded-xl">
        <a href={src}>Baixar vídeo</a>
      </video>
    );
  }
  const detalhe = [m.midia_mime?.split("/")[1]?.toUpperCase(), tamanhoCurto(m.midia_tamanho)].filter(Boolean).join(" · ");
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className={`mb-1 mt-0.5 flex min-w-52 items-center gap-2.5 rounded-xl px-2.5 py-2 ${
        nosso ? "bg-white/10 dark:bg-zinc-900/10" : "bg-zinc-100 dark:bg-zinc-800"
      }`}
    >
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${nosso ? "bg-white/15 dark:bg-zinc-900/10" : "bg-white dark:bg-zinc-900"}`}>
        <FileText className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">{m.midia_nome ?? "Documento"}</span>
        {detalhe && <span className={`block truncate text-[10.5px] ${apagado}`}>{detalhe}</span>}
      </span>
      <Download className="size-4 shrink-0 opacity-70" />
    </a>
  );
}

// ── Estado vazio da coluna da conversa ──────────────────────────────────────

export function SemConversa({ canal }: { canal: CanalChat | undefined }) {
  const papel = canal ? PAPEL[canal.tipo] : null;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 px-6 text-center dark:bg-zinc-900/30">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        {papel ? <papel.Icone className="size-6 text-zinc-400" /> : <FileText className="size-6 text-zinc-300" />}
      </span>
      <div>
        <p className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
          {canal ? `Conversas de ${canal.nome}` : "Escolha uma conversa"}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {canal?.tipo === "api"
            ? "Número da API oficial: aqui ficam as conversas das automações e da IA. Fora da janela de 24h, a conversa só começa com template."
            : canal
              ? "Número do comercial, pelo WhatsApp Web. O que você mandar daqui sai por este número."
              : "Selecione uma conversa à esquerda ou comece uma nova. Os números ficam na coluna de canais."}
        </p>
      </div>
    </div>
  );
}
