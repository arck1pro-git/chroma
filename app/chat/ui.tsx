"use client";

// Peças visuais do /chat, compartilhadas pelas colunas (canais, lista,
// conversa). Nada aqui fala com o servidor.
import { Fragment, useState, type ComponentType, type ReactNode } from "react";
import { Bot, Check, CheckCheck, Clock, Smartphone, TriangleAlert } from "lucide-react";
import { horaCurta, iniciais } from "../formato";
import type { CanalChat, ConversaResumo, EstadoCanal, TipoCanal } from "./tipos";
import type { StatusMensagem } from "../data";

// ── Identidade dos canais ───────────────────────────────────────────────────
//
// Cada tipo de canal é um "papel" na empresa, e a cor diz qual sem precisar
// ler: verde é o comercial (gente, WhatsApp Web), violeta é automação e IA
// (a API oficial). As duas cores seguem o canal pela tela inteira — trilho,
// lista, cabeçalho da conversa e os balões que a automação mandou.

export const PAPEL: Record<
  TipoCanal,
  {
    rotulo: string;
    meio: string;
    Icone: ComponentType<{ className?: string }>;
    chip: string;
    selo: string;
  }
> = {
  web: {
    rotulo: "Comercial",
    meio: "WhatsApp Web",
    Icone: Smartphone,
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
    selo: "bg-emerald-500 text-white",
  },
  api: {
    rotulo: "Automações e IA",
    meio: "API oficial",
    Icone: Bot,
    chip: "bg-violet-50 text-violet-700 ring-violet-600/15 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20",
    selo: "bg-violet-500 text-white",
  },
};

export const ESTADO: Record<EstadoCanal, { rotulo: string; ponto: string }> = {
  conectado: { rotulo: "Conectado", ponto: "bg-emerald-500" },
  conectando: { rotulo: "Reconectando", ponto: "bg-amber-500" },
  desconectado: { rotulo: "Desconectado", ponto: "bg-red-500" },
  desconhecido: { rotulo: "Sem resposta da uazapi", ponto: "bg-zinc-400" },
};

/** O tipo do canal de uma conversa, pelo que o atendimento guarda. */
export const tipoDaConversa = (c: Pick<ConversaResumo, "canal">): TipoCanal =>
  c.canal === "whatsapp_oficial" ? "api" : "web";

export const fim8 = (n: string | null | undefined) => (n ?? "").replace(/\D/g, "").slice(-8);

export function canalDaConversa(canais: CanalChat[], c: Pick<ConversaResumo, "numero_instancia">) {
  const alvo = fim8(c.numero_instancia);
  return alvo ? canais.find((k) => fim8(k.chave) === alvo) : undefined;
}

// ── Formatação ──────────────────────────────────────────────────────────────

/** "5547992399626" → "+55 47 99239-9626". Fora do padrão BR, só "+dígitos". */
export function formatarTelefone(numero: string | null | undefined): string {
  const d = (numero ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const resto = d.slice(4);
    const corte = resto.length - 4;
    return `+55 ${d.slice(2, 4)} ${resto.slice(0, corte)}-${resto.slice(corte)}`;
  }
  return d ? `+${d}` : "";
}

// Fuso fixo nos dois lados pelo mesmo motivo de app/formato.ts: com o fuso do
// runtime, o SSR sai em UTC e o navegador em local, e a hidratação reclama.
const FUSO = "America/Sao_Paulo";
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtSemana = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "short" });
const fmtCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "2-digit" });
const fmtLongo = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "numeric", month: "long" });
const fmtLongoAno = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "numeric", month: "long", year: "numeric" });

/** "2026-09-28" no fuso de Brasília — a chave para agrupar por dia. */
export const diaDe = (iso: string) => fmtDia.format(new Date(iso));

const DIA_MS = 86_400_000;
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Na lista: hora (hoje), "Ontem", dia da semana (até 6 dias) ou data. */
export function quandoNaLista(iso: string, agora: number): string {
  const dia = diaDe(iso);
  if (dia === diaDe(new Date(agora).toISOString())) return horaCurta(iso);
  if (dia === diaDe(new Date(agora - DIA_MS).toISOString())) return "Ontem";
  if (agora - Date.parse(iso) < 6 * DIA_MS) return maiuscula(fmtSemana.format(new Date(iso)).replace(".", ""));
  return fmtCurta.format(new Date(iso));
}

/** O separador de dia dentro da conversa. */
export function rotuloDoDia(iso: string, agora: number): string {
  const dia = diaDe(iso);
  if (dia === diaDe(new Date(agora).toISOString())) return "Hoje";
  if (dia === diaDe(new Date(agora - DIA_MS).toISOString())) return "Ontem";
  if (dia.slice(0, 4) !== diaDe(new Date(agora).toISOString()).slice(0, 4)) return fmtLongoAno.format(new Date(iso));
  return maiuscula(fmtLongo.format(new Date(iso)));
}

/** "5h 12min", "38 min", "menos de 1 min". */
export function duracao(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h}h ${resto}min` : `${h}h`;
}

/** Quanto ainda falta na janela de 24h da API oficial (0 = fechada). */
export function restanteDaJanela(c: Pick<ConversaResumo, "janela_ate">, agora: number): number {
  return c.janela_ate ? Math.max(0, Date.parse(c.janela_ate) - agora) : 0;
}

// ── Avatar ──────────────────────────────────────────────────────────────────

// Classes escritas por extenso (e não montadas) para o Tailwind enxergá-las.
const CORES = [
  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
];

/** A mesma pessoa tem sempre a mesma cor — ajuda a achar na lista de relance. */
function corDoNome(nome: string) {
  let h = 0;
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length];
}

/** Iniciais de um nome; se o "nome" é um telefone, um ícone de pessoa vale mais que "55". */
function rotuloDoAvatar(nome: string) {
  return /^[\d\s+()-]+$/.test(nome.trim()) ? "#" : iniciais(nome);
}

/**
 * Foto com as iniciais por baixo. A foto aparece por cima quando carrega (sem
 * piscar vazio) e some se falhar — URL expirada, contato sem foto (404) ou
 * privacidade fechada. As iniciais são sempre a resposta de reserva.
 */
export function Avatar({
  nome,
  src,
  tamanho = 40,
  children,
}: {
  nome: string;
  src?: string | null;
  tamanho?: number;
  /** Selos no canto (canal, estado). Ficam FORA do recorte redondo. */
  children?: ReactNode;
}) {
  const [estado, setEstado] = useState<"carregando" | "ok" | "falhou">("carregando");
  // Mudou a foto (outra pessoa na mesma posição da lista): recomeça.
  const [srcVisto, setSrcVisto] = useState(src);
  if (srcVisto !== src) {
    setSrcVisto(src);
    setEstado("carregando");
  }

  return (
    <span className="relative inline-flex shrink-0" style={{ width: tamanho, height: tamanho }}>
      <span
        className={`relative flex size-full select-none items-center justify-center overflow-hidden rounded-full font-semibold ${corDoNome(nome)}`}
        style={{ fontSize: Math.max(10, Math.round(tamanho * 0.36)) }}
        aria-hidden="true"
      >
        {rotuloDoAvatar(nome)}
        {src && estado !== "falhou" && (
          // <img> e não next/image: a origem é a nossa rota de foto (ou a CDN
          // do WhatsApp), com tamanho e validade que o build não conhece.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setEstado("ok")}
            onError={() => setEstado("falhou")}
            className={`absolute inset-0 size-full rounded-full object-cover transition-opacity duration-300 ${
              estado === "ok" ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
      </span>
      {children}
    </span>
  );
}

/** A foto do contato vem da nossa rota (app/api/chat/foto) — ver lá o porquê. */
export function fotoDoContato(contatoId: string, via: string | null, demo: boolean) {
  if (demo) return null;
  return `/api/chat/foto/${contatoId}${via ? `?via=${via.replace(/\D/g, "")}` : ""}`;
}

/** Seloszinho do canal no canto do avatar (aparece na visão "todos"). */
export function SeloCanal({ tipo, tamanho = 18 }: { tipo: TipoCanal; tamanho?: number }) {
  const { Icone, selo, rotulo } = PAPEL[tipo];
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full ring-2 ring-white dark:ring-zinc-950 ${selo}`}
      style={{ width: tamanho, height: tamanho }}
      title={rotulo}
    >
      <Icone className="size-[60%]" />
    </span>
  );
}

// ── Entrega ─────────────────────────────────────────────────────────────────

/** Relógio, um visto, dois vistos (azuis quando lida), ou o alerta de falha. */
export function Entrega({ status, className = "size-3.5" }: { status: StatusMensagem; className?: string }) {
  if (status === "pendente") return <Clock className={`${className} shrink-0 opacity-70`} aria-label="Enviando" />;
  if (status === "erro") return <TriangleAlert className={`${className} shrink-0 text-red-500`} aria-label="Falhou" />;
  if (status === "lido") return <CheckCheck className={`${className} shrink-0 text-sky-500`} aria-label="Lida" />;
  if (status === "entregue") return <CheckCheck className={`${className} shrink-0 opacity-70`} aria-label="Entregue" />;
  return <Check className={`${className} shrink-0 opacity-70`} aria-label="Enviada" />;
}

// ── Texto com a formatação do WhatsApp ──────────────────────────────────────
//
// *negrito*, _itálico_, ~riscado~ e links clicáveis — o que o contato vê do
// lado de lá. Montado como elementos React, nunca como HTML: o texto é do
// cliente, e innerHTML aqui seria injeção esperando para acontecer.

const TOKEN = /(https?:\/\/[^\s]+)|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;

export function TextoWhatsApp({ texto, link }: { texto: string; link: string }) {
  const partes: ReactNode[] = [];
  let ultimo = 0;
  let i = 0;
  for (const m of texto.matchAll(TOKEN)) {
    const inicio = m.index ?? 0;
    if (inicio > ultimo) partes.push(texto.slice(ultimo, inicio));
    const k = i++;
    if (m[1]) {
      partes.push(
        <a key={k} href={m[1]} target="_blank" rel="noreferrer noopener" className={`break-all underline underline-offset-2 ${link}`}>
          {m[1]}
        </a>,
      );
    } else if (m[2]) partes.push(<strong key={k} className="font-semibold">{m[2]}</strong>);
    else if (m[3]) partes.push(<em key={k}>{m[3]}</em>);
    else if (m[4]) partes.push(<s key={k}>{m[4]}</s>);
    ultimo = inicio + m[0].length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return (
    <>
      {partes.map((p, idx) => (
        <Fragment key={idx}>{p}</Fragment>
      ))}
    </>
  );
}

// Prévia da conversa na lista. Mensagem de mídia costuma vir SEM legenda: sem
// o rótulo, a linha aparecia em branco e a conversa parecia vazia.
const ROTULO_ANEXO: Record<string, string> = {
  imagem: "📷 Foto",
  sticker: "Figurinha",
  audio: "🎤 Áudio",
  video: "🎬 Vídeo",
  documento: "📄 Documento",
  localizacao: "📍 Localização",
  contato: "👤 Contato",
  desconhecido: "Anexo",
};

export function previa(tipo: string, texto: string): string {
  const limpo = texto.replace(/[*_~]/g, "").replace(/\s+/g, " ").trim();
  if (tipo !== "texto") return limpo ? `${ROTULO_ANEXO[tipo] ?? "Anexo"} · ${limpo}` : (ROTULO_ANEXO[tipo] ?? "Anexo");
  return limpo || "Mensagem";
}
