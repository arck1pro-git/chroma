"use client";

// O visor de uma gravação do Meet: o vídeo à esquerda, as anotações do Gemini
// (e a transcrição e o chat, quando houver) à direita. Abre por cima de tudo —
// da ficha da oportunidade e da gaveta de Gravações da Agenda.
//
// O VÍDEO TOCA NO PLAYER DO GOOGLE (/preview do Drive), não passa pelo CRM: um
// vídeo de reunião tem 400 MB a 2 GB, e servir isso pela Vercel seria pagar a
// banda de cada play (custo-vercel-leve). O preço é que quem assiste precisa
// estar logado no navegador numa conta Google com acesso à pasta. O TEXTO vem
// pelo CRM (conta de serviço), então as anotações abrem para qualquer um.
import { useEffect, useState } from "react";
import { ExternalLink, FileText, Video, X } from "lucide-react";
import type { Gravacao } from "@/lib/gravacoes";
import { conteudoDeGravacao, type ConteudoPedido } from "../gravacoes/acoes";
import CamadaTopo from "./camada-topo";
import TextoIa from "./texto-ia";
import { BOTAO_SECUNDARIO, BotaoIcone, Carregando, Vazio } from "./gaveta";

const FUSO = "America/Sao_Paulo";
const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

const limpa = (s: string) => s.replace(/\./g, "").replace(/ de /g, " ");

/** "sáb, 23 mai 2026 · 10:00 · 51 min" */
export function quandoDaGravacao(g: Gravacao, comAno = true) {
  const d = new Date(g.inicio);
  const dia = limpa(fmtData.format(d));
  return [comAno ? dia : dia.replace(/ \d{4}$/, ""), fmtHora.format(d), g.duracaoMin ? duracao(g.duracaoMin) : null]
    .filter(Boolean)
    .join(" · ");
}

function duracao(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const tituloDaGravacao = (g: Gravacao) => g.titulo || "Reunião sem nome";

type Aba = "notas" | "transcricao" | "chat";
const ROTULO: Record<Aba, string> = { notas: "Resumo do Gemini", transcricao: "Transcrição", chat: "Chat" };

export default function VisorGravacao({ gravacao: g, aoFechar }: { gravacao: Gravacao; aoFechar: () => void }) {
  const abas = (["notas", "transcricao", "chat"] as const).filter(
    (a) => (a === "notas" && g.notasId) || (a === "transcricao" && g.transcricaoId) || (a === "chat" && g.chatId),
  );
  const [aba, setAba] = useState<Aba>(abas[0] ?? "notas");
  // O conteúdo guarda de QUAL gravação é: trocar de gravação descarta o
  // anterior por comparação, sem setState de limpeza no efeito.
  const [conteudo, setConteudo] = useState<{ id: string; dado: ConteudoPedido } | null>(null);
  const atual = conteudo?.id === g.id ? conteudo.dado : null;

  useEffect(() => {
    if (!g.notasId && !g.transcricaoId && !g.chatId) return;
    let vivo = true;
    conteudoDeGravacao(g.id)
      .then((dado) => vivo && setConteudo({ id: g.id, dado }))
      .catch(() => vivo && setConteudo({ id: g.id, dado: { ok: false, mensagem: "Não foi possível abrir as anotações agora." } }));
    return () => {
      vivo = false;
    };
  }, [g.id, g.notasId, g.transcricaoId, g.chatId]);

  // Esc fecha SÓ o visor: o ouvinte é na captura da janela e para a tecla
  // ali, antes de ela chegar ao da ficha/gaveta que está embaixo.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      aoFechar();
    }
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [aoFechar]);

  const texto = atual?.ok ? (aba === "notas" ? atual.notas : aba === "transcricao" ? atual.transcricao : atual.chat) : null;
  const linkDrive = g.videoId
    ? `https://drive.google.com/file/d/${g.videoId}/view`
    : g.notasId
      ? `https://docs.google.com/document/d/${g.notasId}/edit`
      : null;

  const painelTexto = abas.length > 0 && (
    <div className={`flex min-h-0 flex-col ${g.videoId ? "lg:w-[27rem] lg:shrink-0 lg:border-l lg:border-zinc-100 lg:dark:border-zinc-900" : "mx-auto w-full max-w-3xl"} flex-1 lg:flex-none`}>
      <div role="tablist" aria-label="Conteúdo da reunião" className="flex shrink-0 gap-5 border-b border-zinc-100 px-5 pt-3 dark:border-zinc-900">
        {abas.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={aba === a}
            onClick={() => setAba(a)}
            className={`-mb-px border-b-2 pb-2.5 text-[13px] font-medium transition ${
              aba === a
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }`}
          >
            {ROTULO[a]}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {!atual ? (
          <Carregando />
        ) : !atual.ok ? (
          <Vazio>{atual.mensagem}</Vazio>
        ) : texto ? (
          aba === "chat" ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">{texto}</pre>
          ) : (
            <TextoIa texto={texto} />
          )
        ) : (
          <Vazio>Nada escrito nesta parte.</Vazio>
        )}
      </div>
    </div>
  );

  return (
    <CamadaTopo>
      <div className="veu-surge fixed inset-0 z-[400] bg-zinc-950/60 backdrop-blur-sm" onClick={aoFechar} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Gravação: ${tituloDaGravacao(g)}`}
        className="surge fixed inset-2 z-[410] mx-auto flex max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_32px_80px_-16px_rgba(0,0,0,0.5)] ring-1 ring-zinc-900/10 sm:inset-6 dark:bg-zinc-950 dark:ring-white/10"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-900">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
            {g.videoId ? <Video className="size-4" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{tituloDaGravacao(g)}</h2>
            <p className="truncate text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">{quandoDaGravacao(g)}</p>
          </div>
          {linkDrive && (
            <a href={linkDrive} target="_blank" rel="noreferrer" className={`${BOTAO_SECUNDARIO} hidden sm:inline-flex`}>
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Abrir no Drive
            </a>
          )}
          <BotaoIcone Icone={X} rotulo="Fechar" onClick={aoFechar} className="-mr-2" />
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {g.videoId && (
            <div className="flex shrink-0 flex-col bg-black lg:min-w-0 lg:flex-1">
              <div className="flex flex-1 items-center justify-center">
                <iframe
                  src={`https://drive.google.com/file/d/${g.videoId}/preview`}
                  title={`Vídeo: ${tituloDaGravacao(g)}`}
                  allow="autoplay; fullscreen"
                  allowFullScreen
                  className="aspect-video w-full border-0"
                />
              </div>
              <p className="shrink-0 px-4 py-2 text-[11px] leading-snug text-zinc-500">
                O vídeo toca pelo player do Google: se aparecer &quot;Fazer login&quot; ou &quot;Você precisa de acesso&quot;, entre
                no navegador com uma conta Google que tenha acesso à pasta Meet Recordings do meet@arck1pro.com.
              </p>
            </div>
          )}
          {painelTexto}
          {!g.videoId && abas.length === 0 && (
            <div className="flex flex-1 items-center justify-center">
              <Vazio>Esta reunião não tem vídeo nem anotações.</Vazio>
            </div>
          )}
        </div>
      </div>
    </CamadaTopo>
  );
}
