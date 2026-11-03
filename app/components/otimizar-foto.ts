// Foto otimizada no navegador, antes de subir (pedido dele em 2026-10-15 para os
// anexos de demandas, e em 2026-11-03 para toda foto que o CRM guarda): no
// máximo LADO_MAX no lado maior e qualidade 0,8. Uma foto de celular de 4 MB
// costuma cair para algumas centenas de KB.
//
// O FORMATO é de quem chama:
//   · "webp", o menor, para o que fica só no CRM (anexos de demandas);
//   · "jpeg" para o que vai ao lead pelo WhatsApp (a biblioteca de Documentos):
//     a API oficial só aceita imagem JPEG ou PNG, e WebP iria como documento.
//
// O que não dá para otimizar sobe como veio: GIF (a animação se perderia), SVG,
// HEIC que o navegador não abre, navegador que não gera o formato pedido, e a
// foto que já vinha menor do que a versão otimizada.
const LADO_MAX = 1920;
const QUALIDADE = 0.8;
const OTIMIZAVEL = /^image\/(jpeg|png|webp|bmp|heic|heif|avif)$/i;

export async function otimizarFoto(arquivo: File, formato: "webp" | "jpeg"): Promise<File> {
  if (!OTIMIZAVEL.test(arquivo.type)) return arquivo;
  const mime = `image/${formato}`;
  try {
    // from-image: a foto de celular deitada pelo EXIF sai em pé.
    const imagem = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, LADO_MAX / Math.max(imagem.width, imagem.height));
    const tela = document.createElement("canvas");
    tela.width = Math.max(1, Math.round(imagem.width * escala));
    tela.height = Math.max(1, Math.round(imagem.height * escala));
    const contexto = tela.getContext("2d");
    // JPEG não tem transparência: o PNG com fundo transparente ganha fundo branco, e não preto.
    if (contexto && formato === "jpeg") {
      contexto.fillStyle = "#ffffff";
      contexto.fillRect(0, 0, tela.width, tela.height);
    }
    contexto?.drawImage(imagem, 0, 0, tela.width, tela.height);
    imagem.close();
    const otimizada = await new Promise<Blob | null>((pronto) => tela.toBlob(pronto, mime, QUALIDADE));
    // Navegador sem o codificador pedido devolve PNG: aí sobe a original.
    if (!otimizada || otimizada.type !== mime) return arquivo;
    if (otimizada.size >= arquivo.size) return arquivo;
    const base = arquivo.name.replace(/\.[^.]+$/, "") || "foto";
    return new File([otimizada], `${base}.${formato === "jpeg" ? "jpg" : "webp"}`, { type: mime });
  } catch {
    return arquivo;
  }
}
