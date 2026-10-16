// A mídia dos posts: o CRM NÃO GUARDA o arquivo (pedido dele, 2026-10-16:
// "não salvar nada no nosso supabase, quero que vá direto para o insta").
//
// O post guarda só DE ONDE vem cada mídia:
//   · DRIVE — o arquivo nos Drives da empresa, lido pela conta de serviço do
//     CRM (lib/google-drive.ts). É o armazém: um post agendado para a semana
//     que vem busca o arquivo lá na hora de sair;
//   · LINK — um endereço https público (o vídeo ou a imagem gerada no Kairogen,
//     no Magnific…). Tem que continuar no ar até a hora do post;
//   · CHATGPT — o arquivo anexado na conversa do ChatGPT (`openai/fileParams`),
//     com um download_url que vence em pouco tempo: só para post "agora".
//
// Na hora de publicar, os bytes são buscados na fonte (baixarMidia) e entregues
// direto à Meta — o vídeo pelo envio direto, a foto pela página do Facebook do
// perfil (lib/social/meta-publicar.ts). Nada passa a existir no nosso storage.
//
// O LINK VEM DE FORA, então passa por uma peneira antes de o servidor buscar:
// só https, e nunca endereço interno (nem pelo nome, nem depois do DNS, nem num
// redirecionamento). Sem isso o conector viraria um jeito de o servidor ler a
// rede onde ele roda.
import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { arquivoDoDrive, baixarDoDrive, idDoDrive } from "@/lib/google-drive";

export type Midia = {
  fonte: "drive" | "link" | "chatgpt";
  /** O id do arquivo no Drive, ou o link. */
  ref: string;
  nome: string;
  mime: string;
  tipo: "imagem" | "video";
  tamanho: number;
};

/** O arquivo que o ChatGPT manda da conversa (`openai/fileParams`). */
export type ArquivoDoChatGpt = { download_url: string; file_id: string; mime_type?: string; file_name?: string };

/** Erro com texto para o modelo ler e corrigir a chamada. */
export class ErroPost extends Error {}

/**
 * Teto do que se baixa para entregar à Meta. O arquivo passa pela memória da
 * função (não pelo disco nem pelo storage), e 1 GB é o maior Reels que a Meta
 * aceita pela API.
 */
const TETO_BAIXAR = 1024 * 1024 * 1024;

// ── A peneira do link ───────────────────────────────────────────────────────

function ipInterno(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return ipInterno(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function conferirLink(bruto: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new ErroPost(`Link inválido: ${bruto.slice(0, 120)}`);
  }
  if (url.protocol !== "https:") throw new ErroPost(`O link precisa ser https: ${url.href.slice(0, 120)}`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new ErroPost(`Endereço interno não é aceito: ${host}`);
  const enderecos = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((e) => e.address);
  if (enderecos.length === 0) throw new ErroPost(`Não encontrei o endereço ${host}.`);
  if (enderecos.some(ipInterno)) throw new ErroPost(`Endereço interno não é aceito: ${host}`);
  return url;
}

/** Busca seguindo redirecionamento À MÃO, para conferir cada salto. */
async function buscar(bruto: string, cabecalhos: Record<string, string> = {}): Promise<Response> {
  let atual = bruto;
  for (let salto = 0; salto < 4; salto++) {
    const url = await conferirLink(atual);
    const res = await fetch(url, { headers: cabecalhos, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(180_000) });
    const destino = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && destino) {
      atual = new URL(destino, url).href;
      continue;
    }
    if (!res.ok) throw new ErroPost(`O link respondeu ${res.status}: ${url.href.slice(0, 120)}`);
    return res;
  }
  throw new ErroPost(`Redirecionamentos demais: ${bruto.slice(0, 120)}`);
}

// ── O que é o arquivo ───────────────────────────────────────────────────────

/** Pelos primeiros bytes, que mentem menos que o Content-Type. */
function farejar(b: Uint8Array): { mime: string; tipo: "imagem" | "video" } | null {
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", tipo: "imagem" };
  if (b[0] === 0x89 && ascii(1, 3) === "PNG") return { mime: "image/png", tipo: "imagem" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { mime: "image/webp", tipo: "imagem" };
  if (ascii(0, 3) === "GIF") return { mime: "image/gif", tipo: "imagem" };
  if (ascii(4, 4) === "ftyp") {
    const marca = ascii(8, 4);
    if (/^(heic|heix|mif1|avif)/.test(marca)) return { mime: "image/heic", tipo: "imagem" };
    return { mime: marca.startsWith("qt") ? "video/quicktime" : "video/mp4", tipo: "video" };
  }
  return null;
}

function tipoDoMime(mime: string): "imagem" | "video" | null {
  if (mime.startsWith("image/")) return "imagem";
  if (mime.startsWith("video/")) return "video";
  return null;
}

/** Os primeiros bytes e o tamanho de um link, sem baixar o arquivo inteiro. */
async function espiar(link: string): Promise<{ inicio: Uint8Array; mime: string; tamanho: number }> {
  const res = await buscar(link, { Range: "bytes=0-63" });
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  // 206 traz o total em Content-Range; servidor que ignora Range manda 200 e o
  // tamanho inteiro em Content-Length.
  const total = res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
  const tamanho = Number(total ?? (res.status === 200 ? res.headers.get("content-length") : 0) ?? 0);
  const leitor = res.body?.getReader();
  const primeiro = leitor ? await leitor.read() : { value: undefined };
  await leitor?.cancel().catch(() => {});
  return { inicio: primeiro.value ?? new Uint8Array(), mime, tamanho };
}

/**
 * Confere a fonte e descobre o que ela é — SEM baixar o arquivo. É o que o
 * criar_post grava no post.
 */
export async function inspecionar(entrada: string | ArquivoDoChatGpt): Promise<Midia> {
  if (typeof entrada !== "string") {
    const e = await espiar(entrada.download_url);
    const tipo = farejar(e.inicio)?.tipo ?? tipoDoMime(entrada.mime_type ?? e.mime);
    if (!tipo) throw new ErroPost(`O arquivo "${entrada.file_name ?? entrada.file_id}" não é foto nem vídeo.`);
    return {
      fonte: "chatgpt",
      ref: entrada.download_url,
      nome: entrada.file_name ?? entrada.file_id,
      mime: farejar(e.inicio)?.mime ?? entrada.mime_type ?? e.mime,
      tipo,
      tamanho: e.tamanho,
    };
  }

  const idDrive = idDoDrive(entrada);
  if (idDrive) {
    const a = await arquivoDoDrive(idDrive);
    const tipo = tipoDoMime(a.mime);
    if (!tipo) throw new ErroPost(`"${a.nome}" no Drive não é foto nem vídeo (${a.mime}).`);
    if (a.tamanho > TETO_BAIXAR) throw new ErroPost(`"${a.nome}" passa de 1 GB, o maior vídeo que a Meta aceita.`);
    return { fonte: "drive", ref: a.id, nome: a.nome, mime: a.mime, tipo, tamanho: a.tamanho };
  }

  const e = await espiar(entrada);
  const farejado = farejar(e.inicio);
  const tipo = farejado?.tipo ?? tipoDoMime(e.mime);
  if (!tipo) throw new ErroPost(`Não reconheci como foto ou vídeo: ${entrada.slice(0, 120)}`);
  if (e.tamanho > TETO_BAIXAR) throw new ErroPost(`O arquivo passa de 1 GB, o maior vídeo que a Meta aceita: ${entrada.slice(0, 120)}`);
  const nome = decodeURIComponent(new URL(entrada).pathname.split("/").pop() || "arquivo");
  return { fonte: "link", ref: entrada, nome, mime: farejado?.mime ?? e.mime, tipo, tamanho: e.tamanho };
}

/** Os bytes da mídia, buscados na fonte na hora de publicar — só na memória. */
export async function baixarMidia(m: Midia): Promise<Uint8Array> {
  const res = m.fonte === "drive" ? await baixarDoDrive(m.ref) : await buscar(m.ref);
  const partes: Uint8Array[] = [];
  let lidos = 0;
  const leitor = res.body!.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    lidos += value.byteLength;
    if (lidos > TETO_BAIXAR) {
      await leitor.cancel();
      throw new ErroPost(`"${m.nome}" passa de 1 GB.`);
    }
    partes.push(value);
  }
  if (lidos === 0) throw new ErroPost(`"${m.nome}" veio vazio da fonte.`);
  return Buffer.concat(partes);
}
