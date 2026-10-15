"use client";

// O miolo da página de envio: lê o link assinado do fragmento (#), deixa
// escolher o arquivo e sobe com PUT direto para o Storage, com progresso
// (vídeo demora). Ver ./page.tsx.
import { useEffect, useRef, useState } from "react";
import { CircleCheck, FileUp, TriangleAlert } from "lucide-react";

type Pedido = { u: string; n: string; t: string };

function lerFragmento(): Pedido | null {
  try {
    const bruto = window.location.hash.slice(1);
    if (!bruto) return null;
    const base64 = bruto.replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))) as Pedido;
    return typeof p?.u === "string" && /^https:\/\/[^/]+\/storage\/v1\/object\/upload\/sign\//.test(p.u) ? p : null;
  } catch {
    return null;
  }
}

const tamanho = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1).replace(".", ",")} MB`);

export default function Envio() {
  // undefined = ainda lendo o fragmento (só existe no navegador).
  const [pedido, setPedido] = useState<Pedido | null | undefined>(undefined);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [estado, setEstado] = useState<"escolher" | "enviando" | "pronto" | "erro">("escolher");
  const [erro, setErro] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // O fragmento só existe no navegador: ler na montagem é o caminho — e de
    // novo se a pessoa colar outro link na mesma aba (só o # muda).
    const ler = () => setPedido(lerFragmento());
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);

  function enviar() {
    if (!pedido || !arquivo) return;
    setEstado("enviando");
    setErro(null);
    setProgresso(0);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", pedido.u);
    xhr.setRequestHeader("Content-Type", arquivo.type || pedido.t || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgresso(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status < 300) {
        setEstado("pronto");
        return;
      }
      let motivo = `o servidor respondeu ${xhr.status}`;
      try {
        motivo = (JSON.parse(xhr.responseText) as { message?: string }).message ?? motivo;
      } catch {}
      setErro(/expired|exp|signature/i.test(motivo) ? "O link venceu (vale 2 horas). Peça um novo na conversa." : `Não subiu: ${motivo}.`);
      setEstado("erro");
    };
    xhr.onerror = () => {
      setErro("A conexão caiu no meio do envio. Tente de novo.");
      setEstado("erro");
    };
    xhr.send(arquivo);
  }

  const cartao = "w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";

  if (pedido === undefined) return <div className={cartao} aria-busy="true" />;

  if (pedido === null) {
    return (
      <div className={cartao}>
        <TriangleAlert className="size-6 text-amber-500" aria-hidden="true" />
        <h1 className="mt-3 text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">Link incompleto</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Abra o link inteiro que o assistente passou na conversa, ou peça um novo.
        </p>
      </div>
    );
  }

  if (estado === "pronto") {
    return (
      <div className={cartao}>
        <CircleCheck className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <h1 className="mt-3 text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">Arquivo enviado</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Volte para a conversa e avise que enviou: o assistente segue com o post.
        </p>
      </div>
    );
  }

  return (
    <div className={cartao}>
      <FileUp className="size-6 text-zinc-400" aria-hidden="true" />
      <h1 className="mt-3 text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">Enviar arquivo para o post</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        Escolha a foto ou o vídeo{pedido.n ? ` (${pedido.n})` : ""}. Ele vai direto para o AmaanOffice, até 50 MB.
      </p>

      <button
        type="button"
        disabled={estado === "enviando"}
        onClick={() => entrada.current?.click()}
        className="mt-5 flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-left text-[13px] transition hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:hover:border-zinc-600"
      >
        <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-200">{arquivo ? arquivo.name : "Escolher arquivo"}</span>
        {arquivo && <span className="shrink-0 tabular-nums text-zinc-400">{tamanho(arquivo.size)}</span>}
      </button>
      <input
        ref={entrada}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          setArquivo(e.target.files?.[0] ?? null);
          setEstado("escolher");
          setErro(null);
        }}
      />

      {estado === "enviando" && progresso !== null && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-label={`Enviando ${progresso}%`}>
          <span className="block h-full rounded-full bg-zinc-900 transition-[width] dark:bg-zinc-100" style={{ width: `${progresso}%` }} />
        </div>
      )}
      {erro && <p className="mt-3 text-[12px] text-red-600 dark:text-red-400">{erro}</p>}

      <button
        type="button"
        disabled={!arquivo || estado === "enviando"}
        onClick={enviar}
        className="mt-5 w-full rounded-full bg-zinc-900 px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {estado === "enviando" ? `Enviando… ${progresso ?? 0}%` : "Enviar"}
      </button>
    </div>
  );
}
