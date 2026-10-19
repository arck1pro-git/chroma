"use client";

// O microfone dos campos de texto livre (anotações, nota da atividade,
// descrição da demanda): clicou, grava; clicou de novo, o áudio vira texto
// (/api/transcrever, Groq) e entra no campo, para revisar antes de salvar.
// Pedido dele, 2026-10-19: comentar falando em vez de digitar.
//
// Para sozinho em 3 minutos: é o que cabe no limite de corpo da Vercel.
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

const TETO_SEGUNDOS = 180;

type Estado = "parado" | "gravando" | "transcrevendo";

export default function BotaoDitado({
  aoTranscrever,
  desligado = false,
  className = "",
}: {
  /** O texto falado. Quem usa decide como juntar com o que já está no campo. */
  aoTranscrever: (texto: string) => void;
  desligado?: boolean;
  className?: string;
}) {
  const [estado, setEstado] = useState<Estado>("parado");
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const gravador = useRef<MediaRecorder | null>(null);
  const relogio = useRef<ReturnType<typeof setInterval> | null>(null);
  // Fechou o formulário no meio da gravação: o áudio é jogado fora, não vira
  // texto num campo que já sumiu.
  const descartar = useRef(false);

  // Saiu da tela gravando (fechou a gaveta): solta o microfone e descarta.
  useEffect(
    () => () => {
      descartar.current = true;
      if (relogio.current) clearInterval(relogio.current);
      const g = gravador.current;
      if (g && g.state !== "inactive") g.stop();
      g?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // O teto de 3 minutos: para sozinho e transcreve o que gravou.
  useEffect(() => {
    if (estado === "gravando" && segundos >= TETO_SEGUNDOS) parar();
  }, [estado, segundos]);

  async function comecar() {
    setErro(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErro("Libere o microfone no navegador para ditar.");
      return;
    }
    const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    );
    const g = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
    const partes: Blob[] = [];
    g.ondataavailable = (e) => {
      if (e.data.size) partes.push(e.data);
    };
    g.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (descartar.current) return;
      void transcrever(new Blob(partes, { type: g.mimeType || tipo || "audio/webm" }));
    };
    gravador.current = g;
    descartar.current = false;
    g.start();
    setSegundos(0);
    setEstado("gravando");
    relogio.current = setInterval(() => setSegundos((s) => s + 1), 1000);
  }

  function parar() {
    if (relogio.current) clearInterval(relogio.current);
    relogio.current = null;
    const g = gravador.current;
    if (g && g.state !== "inactive") {
      setEstado("transcrevendo");
      g.stop();
    }
  }

  async function transcrever(audio: Blob) {
    if (!audio.size) {
      setEstado("parado");
      return;
    }
    try {
      const form = new FormData();
      const extensao = audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "m4a" : "webm";
      form.append("audio", audio, `ditado.${extensao}`);
      const res = await fetch("/api/transcrever", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { texto?: string; erro?: string };
      if (!res.ok) throw new Error(json.erro ?? "Não consegui transcrever o áudio.");
      if (json.texto?.trim()) aoTranscrever(json.texto.trim());
      else setErro("Não entendi nada no áudio. Tente falar mais perto do microfone.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui transcrever o áudio.");
    } finally {
      setEstado("parado");
    }
  }

  const tempo = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => (estado === "gravando" ? parar() : estado === "parado" ? void comecar() : undefined)}
        disabled={desligado || estado === "transcrevendo"}
        aria-pressed={estado === "gravando"}
        aria-label={estado === "gravando" ? "Parar e transcrever" : "Ditar por áudio"}
        title={
          erro ??
          (estado === "gravando"
            ? "Clique para parar: o que você falou vira texto no campo"
            : estado === "transcrevendo"
              ? "Transcrevendo…"
              : "Ditar por áudio: clique, fale e clique de novo")
        }
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-50 ${
          estado === "gravando"
            ? "bg-red-500 text-white hover:bg-red-600"
            : erro
              ? "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        }`}
      >
        {estado === "transcrevendo" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : estado === "gravando" ? (
          <Square className="size-3 fill-current" aria-hidden="true" />
        ) : (
          <Mic className="size-3.5" aria-hidden="true" />
        )}
      </button>
      {estado === "gravando" && (
        <span className="flex items-center gap-1 text-[11px] font-medium tabular-nums text-red-600 dark:text-red-400" aria-live="polite">
          <span className="size-1.5 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
          {tempo}
        </span>
      )}
      {estado === "transcrevendo" && <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Transcrevendo…</span>}
      {erro && estado === "parado" && (
        <span role="alert" className="max-w-[16rem] truncate text-[11px] text-amber-700 dark:text-amber-400" title={erro}>
          {erro}
        </span>
      )}
    </span>
  );
}

/** Junta o texto ditado ao que já está no campo, com um espaço entre os dois. */
export function juntarDitado(atual: string, ditado: string): string {
  return atual.trim() ? `${atual.trimEnd()} ${ditado}` : ditado;
}
