"use client";

// A tela de vídeos: a lista à esquerda (com o envio), o vídeo aberto à direita
// (app/videos/detalhe.tsx) — o mesmo desenho de /webhooks.
//
// O ENVIO, do lado do navegador (o servidor está em ./acoes.ts):
//   · antes de subir, o próprio navegador abre o vídeo para ler duração e
//     formato e tirar a capa (um quadro em JPEG) — o servidor não tem como ver
//     dentro do arquivo sem baixá-lo inteiro;
//   · o arquivo sobe por XMLHttpRequest, e não fetch, porque só ele dá o
//     progresso do envio: 40 MB no 4G levam minutos, e uma tela parada nesse
//     tempo parece travada.
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Film, Loader2, Search, Upload } from "lucide-react";
import type { EnderecoCrm } from "@/lib/endereco";
import type { PessoaDoVideo, Video } from "@/lib/videos";
import { prepararEnvio, registrarVideo } from "./acoes";
import Detalhe, { duracaoEmTexto } from "./detalhe";

const campoTexto =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

type Envio = { nome: string; etapa: "lendo" | "enviando" | "registrando"; progresso: number };

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * Duração, formato e capa, lidos no navegador. Tudo opcional: um codec que o
 * navegador não toca (HEVC num Chrome sem suporte, por exemplo) não impede o
 * envio — só sai sem capa, e a duração vem do primeiro player que tocar.
 */
async function lerVideo(arquivo: File) {
  const vazio = { duracao: null as number | null, largura: null as number | null, altura: null as number | null, capa: null as Blob | null };
  const url = URL.createObjectURL(arquivo);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;

  const esperar = (evento: string) =>
    new Promise<boolean>((pronto) => {
      const t = setTimeout(() => pronto(false), 15_000);
      v.addEventListener(evento, () => (clearTimeout(t), pronto(true)), { once: true });
      v.addEventListener("error", () => (clearTimeout(t), pronto(false)), { once: true });
    });

  try {
    if (!(await esperar("loadedmetadata"))) return vazio;
    const duracao = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    const largura = v.videoWidth || null;
    const altura = v.videoHeight || null;
    let capa: Blob | null = null;
    if (largura && altura) {
      // Um pouco depois do começo: o primeiro quadro costuma ser preto (fade).
      v.currentTime = Math.min(2, (duracao ?? 10) * 0.2);
      if (await esperar("seeked")) {
        const escala = Math.min(1, 1280 / Math.max(largura, altura));
        const tela = document.createElement("canvas");
        tela.width = Math.round(largura * escala);
        tela.height = Math.round(altura * escala);
        tela.getContext("2d")?.drawImage(v, 0, 0, tela.width, tela.height);
        capa = await new Promise<Blob | null>((pronto) => tela.toBlob(pronto, "image/jpeg", 0.82));
      }
    }
    return { duracao, largura, altura, capa };
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute("src");
    v.load();
  }
}

/** PUT multipart na URL assinada — o mesmo formato que o supabase-js usa. */
function subirArquivo(url: string, arquivo: Blob, nome: string, aoProgredir?: (fracao: number) => void) {
  return new Promise<void>((pronto, falhou) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status < 300) return pronto();
      let motivo = `erro ${xhr.status}`;
      try {
        motivo = (JSON.parse(xhr.responseText) as { message?: string }).message ?? motivo;
      } catch {}
      falhou(new Error(motivo));
    };
    xhr.onerror = () => falhou(new Error("a conexão caiu no meio do envio"));
    const corpo = new FormData();
    corpo.append("cacheControl", "3600");
    corpo.append("", arquivo, nome);
    xhr.send(corpo);
  });
}

export default function PainelVideos({
  videos,
  selecionado,
  pessoas,
  base,
  limite,
  problema,
}: {
  videos: Video[];
  selecionado: Video | null;
  pessoas: PessoaDoVideo[];
  base: EnderecoCrm | null;
  limite: number | null;
  problema: "migration" | "bucket" | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busca, setBusca] = useState("");
  const [envio, setEnvio] = useState<Envio | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return termo ? videos.filter((v) => v.nome.toLowerCase().includes(termo)) : videos;
  }, [videos, busca]);

  async function subir(arquivo: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!arquivo) return;
    setErro(null);
    // Alguns sistemas não dizem o tipo de .mkv/.mov: sem tipo, o bucket (que só
    // aceita video/*) recusaria.
    const mime = arquivo.type || "video/mp4";
    if (!mime.startsWith("video/")) return setErro("Escolha um arquivo de vídeo.");
    if (limite && arquivo.size > limite) {
      return setErro(`O vídeo tem ${mb(arquivo.size)} e o limite por arquivo é ${mb(limite)}. Exporte em resolução menor (720p costuma bastar no celular) e suba de novo.`);
    }

    const nome = arquivo.name.replace(/\.[^.]+$/, "").trim() || "Vídeo sem nome";
    try {
      setEnvio({ nome, etapa: "lendo", progresso: 0 });
      const meta = await lerVideo(arquivo);

      const preparo = await prepararEnvio({ nomeArquivo: arquivo.name, mime, tamanho: arquivo.size });
      if (!preparo.ok) throw new Error(preparo.mensagem);

      setEnvio({ nome, etapa: "enviando", progresso: 0 });
      await subirArquivo(preparo.url, arquivo.slice(0, arquivo.size, mime), arquivo.name, (p) =>
        setEnvio({ nome, etapa: "enviando", progresso: p }),
      );
      // A capa é bônus: se ela falhar, o vídeo entra do mesmo jeito.
      const temCapa = meta.capa
        ? await subirArquivo(preparo.urlCapa, meta.capa, "capa.jpg").then(() => true, () => false)
        : false;

      setEnvio({ nome, etapa: "registrando", progresso: 1 });
      const registro = await registrarVideo({
        caminho: preparo.caminho,
        nome,
        mime,
        duracao: meta.duracao,
        largura: meta.largura,
        altura: meta.altura,
        temCapa,
      });
      if (!registro.ok) throw new Error(registro.mensagem);
      router.push(`/videos?video=${registro.id}`);
      router.refresh();
    } catch (e) {
      setErro(`Não subiu "${nome}": ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEnvio(null);
    }
  }

  const podeSubir = !problema && !envio;

  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <div className="shrink-0 space-y-2.5 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                <Clapperboard className="size-4" aria-hidden="true" />
                Vídeos
              </h1>
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {videos.length} {videos.length === 1 ? "vídeo" : "vídeos"}
                {limite ? ` · até ${mb(limite)} cada` : ""}
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => void subir(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={!podeSubir}
              onClick={() => inputRef.current?.click()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              <Upload className="size-3.5" aria-hidden="true" />
              Subir
            </button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar vídeo"
              className={`${campoTexto} pl-8`}
            />
          </div>
        </div>

        {(erro || problema) && (
          <p role="alert" className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {erro ??
              (problema === "migration"
                ? "As tabelas de vídeo ainda não existem no banco. Rode migration-videos.sql e recarregue."
                : "O bucket crm-videos não respondeu no Supabase — sem ele não dá para subir. Os vídeos que já existem continuam abrindo.")}
          </p>
        )}

        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {envio && (
            <li className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800" aria-live="polite">
              <p className="flex items-center gap-1.5 truncate text-[12px] font-medium text-zinc-900 dark:text-zinc-50">
                <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                <span className="truncate">{envio.nome}</span>
              </p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-[width] dark:bg-zinc-100"
                  style={{ width: `${Math.round(envio.progresso * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                {envio.etapa === "lendo"
                  ? "Lendo o vídeo e tirando a capa…"
                  : envio.etapa === "enviando"
                    ? `Enviando… ${Math.round(envio.progresso * 100)}%`
                    : "Quase lá…"}
              </p>
            </li>
          )}
          {visiveis.map((v) => (
            <li key={v.id}>
              <Link
                href={`/videos?video=${v.id}`}
                aria-current={v.id === selecionado?.id ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg border p-2 transition ${
                  v.id === selecionado?.id
                    ? "border-zinc-900 dark:border-zinc-300"
                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                }`}
              >
                {v.capa ? (
                  // eslint-disable-next-line @next/next/no-img-element -- capa servida pela rota do vídeo, não pelo otimizador
                  <img src={`/v/${v.slug}/capa`} alt="" className="size-10 shrink-0 rounded-md bg-zinc-100 object-cover dark:bg-zinc-800" />
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                    <Film className="size-4" aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{v.nome}</span>
                  <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                    {[v.duracao ? duracaoEmTexto(v.duracao) : null, `${v.pessoas} ${v.pessoas === 1 ? "pessoa" : "pessoas"}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {!envio && visiveis.length === 0 && (
            <li className="px-2 py-10 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
              {busca.trim() ? "Nenhum vídeo com esse nome." : "Nenhum vídeo ainda. Suba o primeiro no botão acima."}
            </li>
          )}
        </ul>
      </aside>

      {selecionado && base ? (
        <Detalhe key={selecionado.id} video={selecionado} pessoas={pessoas} base={base} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
          Suba um vídeo para ganhar o link e acompanhar quem assiste.
        </div>
      )}
    </div>
  );
}
