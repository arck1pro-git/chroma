// A capa do vídeo (JPEG tirado no navegador ao subir): o pôster do player e a
// imagem da prévia do link no WhatsApp.
//
// Os bytes passam por aqui, em vez de redirecionar para uma URL assinada: quem
// busca a prévia é o robô do WhatsApp, que guarda a imagem — uma URL que expira
// viraria uma prévia quebrada depois.
import { baixar } from "@/lib/armazenamento";
import { BUCKET_VIDEOS, buscarVideoPorSlug } from "@/lib/videos";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const video = await buscarVideoPorSlug(slug);
  if (!video?.capa) return new Response("sem capa", { status: 404 });

  const bytes = await baixar(BUCKET_VIDEOS, video.capa);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
}
