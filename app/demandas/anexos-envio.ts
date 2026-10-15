// O envio de um anexo de demanda, do lado do navegador: comprime a foto e sobe
// direto para o Supabase (o servidor só assina — ver lib/demandas-anexos.ts).
// Usado pelo formulário (app/components/modal-demanda.tsx) e pela gaveta
// (app/demandas/anexos.tsx).
//
// FOTO VIRA WEBP antes de subir (pedido dele, 2026-10-15): no máximo 1920 px no
// lado maior, qualidade 0,8. Uma foto de celular de 4 MB costuma cair para
// algumas centenas de KB. O que não dá para comprimir sobe como veio: GIF (a
// animação se perderia), SVG, HEIC que o navegador não abre, e o navegador que
// não sabe gerar WebP.
import { prepararAnexoDemanda } from "./acoes";
import type { AnexoDemanda } from "@/lib/demandas-tipos";

const LADO_MAX = 1920;
const QUALIDADE = 0.8;
const COMPRIMIVEL = /^image\/(jpeg|png|webp|bmp|heic|heif|avif)$/i;

export async function comprimirFoto(arquivo: File): Promise<File> {
  if (!COMPRIMIVEL.test(arquivo.type)) return arquivo;
  try {
    // from-image: a foto de celular deitada pelo EXIF sai em pé.
    const imagem = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, LADO_MAX / Math.max(imagem.width, imagem.height));
    const tela = document.createElement("canvas");
    tela.width = Math.max(1, Math.round(imagem.width * escala));
    tela.height = Math.max(1, Math.round(imagem.height * escala));
    tela.getContext("2d")?.drawImage(imagem, 0, 0, tela.width, tela.height);
    imagem.close();
    const webp = await new Promise<Blob | null>((pronto) => tela.toBlob(pronto, "image/webp", QUALIDADE));
    // Navegador sem codificador de WebP devolve PNG: aí sobe a original.
    if (!webp || webp.type !== "image/webp") return arquivo;
    // Uma WebP pequena que já veio otimizada pode crescer ao recomprimir.
    if (arquivo.type === "image/webp" && webp.size >= arquivo.size) return arquivo;
    const base = arquivo.name.replace(/\.[^.]+$/, "") || "foto";
    return new File([webp], `${base}.webp`, { type: "image/webp" });
  } catch {
    return arquivo;
  }
}

/** Comprime (se for foto), assina e sobe. Devolve o anexo para a ação gravar. */
export async function subirAnexo(original: File): Promise<AnexoDemanda> {
  const arquivo = await comprimirFoto(original);
  const preparo = await prepararAnexoDemanda(arquivo.size);
  if (!preparo.ok) throw new Error(preparo.mensagem);

  // O mesmo formato do supabase-js (e do upload dos vídeos): PUT multipart,
  // campo sem nome, sem Authorization — o token está na própria URL.
  const corpo = new FormData();
  corpo.append("cacheControl", "3600");
  corpo.append("", arquivo, arquivo.name);
  const res = await fetch(preparo.url, { method: "PUT", headers: { "x-upsert": "false" }, body: corpo });
  if (!res.ok) {
    const motivo = await res.json().then((j: { message?: string }) => j.message).catch(() => null);
    throw new Error(`O arquivo "${arquivo.name}" não subiu${motivo ? `: ${motivo}` : ""}.`);
  }
  return { id: preparo.id, nome: arquivo.name };
}

export function tamanhoEmTexto(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
}
