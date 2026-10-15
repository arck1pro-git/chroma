// A mídia dos posts: copiada para o nosso storage na hora de agendar.
//
// POR QUE COPIAR: o link que o Claude manda costuma ser de um arquivo gerado
// por IA (Kairogen, Magnific…), com validade curta. Um post agendado para
// amanhã às 11h chegaria à hora com o link morto. A cópia fica no bucket
// PRIVADO `crm-posts-sociais`; na publicação sai uma URL assinada, que é o que
// a Meta busca, e depois de publicado em todas as redes a cópia é apagada.
//
// O TETO É O DO PROJETO SUPABASE (50 MB por arquivo, ver lib/armazenamento.ts).
// Arquivo maior não é copiado: o post guarda o link de origem e publica com
// ele, e o aviso diz que esse link precisa durar até a hora.
//
// IMAGEM VIRA JPEG: a API do Instagram só aceita JPEG, e PNG/WebP é o que as
// IAs de imagem mais devolvem. A conversão usa o sharp que vem com o Next; sem
// ele, a imagem segue como veio e o aviso diz que o Instagram pode recusar.
//
// O LINK VEM DE FORA, então passa por uma peneira antes de o servidor buscar:
// só https, e nunca endereço interno (nem pelo nome, nem depois do DNS, nem num
// redirecionamento). Sem isso o conector viraria um jeito de o servidor ler a
// rede onde ele roda.
import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { garantirBucket, limiteDoBucket, remover, subir, urlDeLeitura } from "@/lib/armazenamento";

export const BUCKET_POSTS = "crm-posts-sociais";
const TETO_PROJETO = 50 * 1024 * 1024;

export type Midia = {
  /** O link que veio na chamada. */
  origem: string;
  /** O objeto no bucket; null quando o arquivo passou do teto e não foi copiado. */
  caminho: string | null;
  mime: string;
  tipo: "imagem" | "video";
  tamanho: number;
};

/** Erro com texto para o modelo ler e corrigir a chamada. */
export class ErroPost extends Error {}

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
async function buscar(bruto: string): Promise<Response> {
  let atual = bruto;
  for (let salto = 0; salto < 4; salto++) {
    const url = await conferirLink(atual);
    const res = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(90_000) });
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

async function paraJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { default: sharp } = await import("sharp");
    return new Uint8Array(await sharp(bytes).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer());
  } catch (e) {
    console.error("[social] conversão para JPEG falhou:", e);
    return null;
  }
}

// ── Cópia, leitura e limpeza ────────────────────────────────────────────────

let bucketPronto = false;

/**
 * Baixa o link e guarda no bucket como `<base>.<ext>`. Devolve a mídia e os
 * avisos para quem pediu (não copiou, não converteu).
 */
export async function copiarMidia(link: string, base: string): Promise<{ midia: Midia; avisos: string[] }> {
  const avisos: string[] = [];
  if (!bucketPronto) {
    await garantirBucket(BUCKET_POSTS);
    bucketPronto = true;
  }
  const teto = (await limiteDoBucket(BUCKET_POSTS).catch(() => null)) ?? TETO_PROJETO;

  const res = await buscar(link);
  const declarado = Number(res.headers.get("content-length") ?? 0);
  const mimeDeclarado = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

  // Grande demais para o bucket: nem baixa. Publica do link de origem.
  if (declarado > teto) {
    await res.body?.cancel();
    const tipo = tipoDoMime(mimeDeclarado);
    if (!tipo) throw new ErroPost(`Não reconheci o arquivo (${mimeDeclarado || "sem tipo"}): ${link.slice(0, 120)}`);
    avisos.push(
      `Arquivo de ${Math.round(declarado / 1048576)} MB passa do teto de ${Math.round(teto / 1048576)} MB do nosso storage: não foi copiado, e a publicação usa o link de origem — ele precisa continuar no ar até a hora do post.`,
    );
    return { midia: { origem: link, caminho: null, mime: mimeDeclarado, tipo, tamanho: declarado }, avisos };
  }

  // Lê com teto: Content-Length pode faltar ou mentir.
  const partes: Uint8Array[] = [];
  let lidos = 0;
  const leitor = res.body!.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    lidos += value.byteLength;
    if (lidos > teto) {
      await leitor.cancel();
      throw new ErroPost(
        `O arquivo passa de ${Math.round(teto / 1048576)} MB e o servidor não informou o tamanho antes: ${link.slice(0, 120)}`,
      );
    }
    partes.push(value);
  }
  let bytes: Uint8Array = Buffer.concat(partes);

  const farejado = farejar(bytes);
  let mime = farejado?.mime ?? mimeDeclarado;
  const tipo = farejado?.tipo ?? tipoDoMime(mime);
  if (!tipo) throw new ErroPost(`Não reconheci o arquivo como imagem ou vídeo: ${link.slice(0, 120)}`);

  if (tipo === "imagem" && mime !== "image/jpeg") {
    const jpeg = await paraJpeg(bytes);
    if (jpeg) {
      bytes = jpeg;
      mime = "image/jpeg";
    } else {
      avisos.push(`Imagem em ${mime} não pôde ser convertida para JPEG; o Instagram só aceita JPEG e pode recusar.`);
    }
  }

  const extensao = mime === "image/jpeg" ? "jpg" : mime === "video/quicktime" ? "mov" : (mime.split("/")[1] ?? "bin");
  const caminho = await subir(BUCKET_POSTS, `${base}.${extensao}`, bytes, mime);
  return { midia: { origem: link, caminho, mime, tipo, tamanho: bytes.byteLength }, avisos };
}

/** O link que a Meta busca: assinado por 6 h (o Instagram processa vídeo com calma). */
export async function linkParaPublicar(m: Midia): Promise<string> {
  return m.caminho ? urlDeLeitura(BUCKET_POSTS, m.caminho, 6 * 3600) : m.origem;
}

export async function apagarCopias(midias: Midia[]): Promise<void> {
  await Promise.all(midias.filter((m) => m.caminho).map((m) => remover(BUCKET_POSTS, m.caminho!)));
}
