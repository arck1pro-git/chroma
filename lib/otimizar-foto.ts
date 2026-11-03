// Foto que o CRM guarda vira WebP menor (pedido dele em 2026-11-03: "sempre
// que for salvar uma mídia em foto o sistema deve otimizar ela, por em webp de
// preferência"). Para as fotos que chegam no chat (lib/midia.ts): ficam só
// para ver no CRM, e o navegador e a IA leem WebP.
//
// O que NÃO passa por aqui, de propósito:
//   · as fotos da biblioteca de Documentos: são enviadas aos leads, e a API
//     oficial do WhatsApp só aceita imagem JPEG ou PNG (WebP iria como
//     documento). O navegador as otimiza em JPEG antes de subir
//     (app/components/otimizar-foto.ts);
//   · GIF (pode ser animado), WebP que já veio pronto e HEIC, que o sharp da
//     distribuição padrão não lê.
//
// Nunca derruba quem chama: sem o sharp, imagem corrompida ou WebP maior que a
// original, guarda a original.
import "server-only";

const CONVERTIVEL = /^image\/(jpeg|jpg|png|bmp|tiff)$/i;
// Lado maior: suficiente para ler um print ou um documento fotografado na tela.
const LADO_MAX = 1600;
const QUALIDADE = 80;

export async function otimizarFoto(bytes: Uint8Array, mime: string | null): Promise<{ bytes: Uint8Array; mime: string | null; otimizada: boolean }> {
  const tipo = (mime ?? "").split(";")[0].trim();
  if (!CONVERTIVEL.test(tipo)) return { bytes, mime, otimizada: false };
  try {
    const { default: sharp } = await import("sharp");
    const webp = await sharp(bytes, { failOn: "none" })
      // A foto de celular deitada pelo EXIF sai em pé (e o EXIF, com GPS, fica de fora).
      .rotate()
      .resize({ width: LADO_MAX, height: LADO_MAX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: QUALIDADE })
      .toBuffer();
    if (webp.byteLength >= bytes.byteLength) return { bytes, mime, otimizada: false };
    return { bytes: new Uint8Array(webp), mime: "image/webp", otimizada: true };
  } catch (e) {
    console.error("[foto] não otimizei, guardo a original:", e instanceof Error ? e.message : e);
    return { bytes, mime, otimizada: false };
  }
}
