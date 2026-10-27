"use client";

// Os anexos da demanda na tela, em dois lugares:
//   · EscolherAnexos — no formulário de criar (demanda e "Abrir chamado"): os
//     arquivos ainda no computador, que sobem quando a pessoa envia;
//   · AnexosDaDemanda — na gaveta: fotos em miniatura, documentos em linha, e,
//     para quem criou, anexar mais e tirar.
// O arquivo abre por /api/demandas/anexos/<id>, que confere quem pode ver.
import { useRef, useState, useTransition } from "react";
import { Download, FileText, ImageIcon, Paperclip, X } from "@/app/components/icones";
import { adicionarAnexoDemanda, removerAnexoDemanda } from "./acoes";
import { subirAnexo, tamanhoEmTexto } from "./anexos-envio";
import {
  anexoEhImagem,
  TETO_ANEXOS,
  TETO_TAMANHO_ANEXO,
  type AnexoDemanda,
} from "@/lib/demandas-tipos";

const ACEITA = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip";
const TETO_MB = TETO_TAMANHO_ANEXO / 1048576;

const botaoAnexar =
  "inline-flex items-center gap-1.5 self-start rounded-lg px-1.5 py-1 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50";

/**
 * Peneira o que a pessoa escolheu: até o teto de quantidade e de tamanho. Foto
 * grande passa, porque ainda vai ser comprimida; documento grande, não.
 */
function peneirar(escolhidos: File[], jaTem: number): { aceitos: File[]; recusa: string | null } {
  const aceitos: File[] = [];
  let recusa: string | null = null;
  for (const f of escolhidos) {
    if (jaTem + aceitos.length >= TETO_ANEXOS) {
      recusa = `Até ${TETO_ANEXOS} anexos por demanda.`;
      break;
    }
    if (!f.type.startsWith("image/") && f.size > TETO_TAMANHO_ANEXO) {
      recusa = `“${f.name}” passa de ${TETO_MB} MB.`;
      continue;
    }
    aceitos.push(f);
  }
  return { aceitos, recusa };
}

// ── No formulário ───────────────────────────────────────────────────────────

export function EscolherAnexos({
  arquivos,
  aoMudar,
  aoRecusar,
  desligado,
}: {
  arquivos: File[];
  aoMudar: (arquivos: File[]) => void;
  aoRecusar: (motivo: string | null) => void;
  desligado: boolean;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      {arquivos.length > 0 && (
        <>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            <Paperclip className="size-3.5" aria-hidden="true" />
            Anexos <span className="font-normal text-zinc-400">(fotos são comprimidas antes de subir)</span>
          </span>
          <ul className="flex flex-col gap-1">
            {arquivos.map((f, i) => (
              <li key={`${i}-${f.name}`} className="group flex items-center gap-2 rounded-lg px-1 py-0.5 text-[13px]">
                {f.type.startsWith("image/") ? (
                  <ImageIcon className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">{f.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{tamanhoEmTexto(f.size)}</span>
                <button
                  type="button"
                  disabled={desligado}
                  onClick={() => aoMudar(arquivos.filter((_, j) => j !== i))}
                  aria-label={`Tirar “${f.name}”`}
                  className="shrink-0 rounded p-0.5 text-zinc-300 transition hover:text-red-600 disabled:opacity-40 dark:text-zinc-600"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {arquivos.length < TETO_ANEXOS && (
        <button type="button" disabled={desligado} onClick={() => entrada.current?.click()} className={`-mt-1 ${botaoAnexar}`}>
          <Paperclip className="size-3.5" aria-hidden="true" />
          {arquivos.length ? "Mais um anexo" : "Anexar foto ou documento"}
        </button>
      )}
      <input
        ref={entrada}
        type="file"
        multiple
        accept={ACEITA}
        className="hidden"
        onChange={(e) => {
          const { aceitos, recusa } = peneirar([...(e.target.files ?? [])], arquivos.length);
          aoRecusar(recusa);
          if (aceitos.length) aoMudar([...arquivos, ...aceitos]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ── Na gaveta ───────────────────────────────────────────────────────────────

const urlDo = (a: AnexoDemanda, baixar = false) => `/api/demandas/anexos/${a.id}${baixar ? "?baixar=1" : ""}`;

export function AnexosDaDemanda({
  demandaId,
  anexos,
  podeMexer,
  aoAvisar,
}: {
  /** A demanda que recebe o anexo novo (as cópias "para todos" vêm junto, no servidor). */
  demandaId: string;
  anexos: AnexoDemanda[];
  /** Quem criou a demanda: anexa e tira. */
  podeMexer: boolean;
  aoAvisar: (texto: string) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [ocupado, iniciar] = useTransition();
  const [enviando, setEnviando] = useState<string | null>(null);
  // Segundo clique é que tira, como o excluir da gaveta.
  const [tirando, setTirando] = useState<string | null>(null);

  if (anexos.length === 0 && !podeMexer) return null;
  const fotos = anexos.filter((a) => anexoEhImagem(a.nome));
  const documentos = anexos.filter((a) => !anexoEhImagem(a.nome));

  function anexar(escolhidos: File[]) {
    const { aceitos, recusa } = peneirar(escolhidos, anexos.length);
    if (recusa) aoAvisar(recusa);
    if (!aceitos.length) return;
    iniciar(async () => {
      for (const f of aceitos) {
        setEnviando(f.name);
        try {
          const anexo = await subirAnexo(f);
          const r = await adicionarAnexoDemanda(demandaId, anexo);
          aoAvisar(r.mensagem);
          if (!r.ok) break;
        } catch (e) {
          aoAvisar(e instanceof Error ? e.message : "O arquivo não subiu.");
          break;
        }
      }
      setEnviando(null);
    });
  }

  function tirar(a: AnexoDemanda) {
    if (tirando !== a.id) {
      setTirando(a.id);
      return;
    }
    setTirando(null);
    iniciar(async () => aoAvisar((await removerAnexoDemanda(a.id)).mensagem));
  }

  const botaoTirar = (a: AnexoDemanda, sobreFoto: boolean) =>
    podeMexer && (
      <button
        type="button"
        disabled={ocupado}
        onClick={() => tirar(a)}
        onBlur={() => setTirando(null)}
        aria-label={tirando === a.id ? `Confirmar: tirar “${a.nome}”` : `Tirar “${a.nome}”`}
        title={tirando === a.id ? "Clique de novo para tirar" : "Tirar anexo"}
        className={
          sobreFoto
            ? `absolute right-1 top-1 rounded-full p-1 shadow transition ${
                tirando === a.id ? "bg-red-600 text-white" : "bg-white/90 text-zinc-600 hover:text-red-600 dark:bg-zinc-900/90 dark:text-zinc-300"
              }`
            : `shrink-0 rounded p-1 transition ${tirando === a.id ? "bg-red-600 text-white" : "text-zinc-400 hover:text-red-600"}`
        }
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    );

  return (
    <section aria-label="Anexos">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        Anexos{anexos.length > 0 && ` · ${anexos.length}`}
      </h3>

      {fotos.length > 0 && (
        <ul className="mb-2 grid grid-cols-3 gap-2">
          {fotos.map((a) => (
            <li key={a.id} className="relative">
              <a href={urlDo(a)} target="_blank" rel="noopener noreferrer" title={a.nome} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element -- servida pela rota do anexo (link assinado), não pelo otimizador */}
                <img
                  src={urlDo(a)}
                  alt={a.nome}
                  loading="lazy"
                  className="aspect-square w-full rounded-lg bg-zinc-100 object-cover ring-1 ring-zinc-200 transition hover:opacity-90 dark:bg-zinc-800 dark:ring-zinc-800"
                />
              </a>
              {botaoTirar(a, true)}
            </li>
          ))}
        </ul>
      )}

      {documentos.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {documentos.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] ring-1 ring-inset ring-zinc-200 dark:ring-zinc-800">
              <FileText className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
              <a
                href={urlDo(a)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-zinc-800 hover:underline dark:text-zinc-200"
              >
                {a.nome}
              </a>
              <a
                href={urlDo(a, true)}
                aria-label={`Baixar “${a.nome}”`}
                title="Baixar"
                className="shrink-0 rounded p-1 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                <Download className="size-3.5" aria-hidden="true" />
              </a>
              {botaoTirar(a, false)}
            </li>
          ))}
        </ul>
      )}

      {podeMexer && anexos.length < TETO_ANEXOS && (
        <>
          <button type="button" disabled={ocupado} onClick={() => entrada.current?.click()} className={botaoAnexar}>
            <Paperclip className="size-3.5" aria-hidden="true" />
            {enviando ? `Enviando “${enviando}”…` : anexos.length ? "Mais um anexo" : "Anexar foto ou documento"}
          </button>
          <input
            ref={entrada}
            type="file"
            multiple
            accept={ACEITA}
            className="hidden"
            onChange={(e) => {
              anexar([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </>
      )}
    </section>
  );
}
