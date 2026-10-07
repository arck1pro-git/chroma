// O arquivo do vídeo: redireciona para uma URL de leitura assinada do Storage.
//
// Endereço FIXO (/v/<slug>/arquivo) em vez da URL assinada direto no <video>:
// a assinada expira, e uma página aberta há horas — ou a tela do CRM, que se
// atualiza sozinha — ficaria apontando para um link morto. Aqui cada pedido
// ganha uma assinada nova. O Storage aceita Range, então o player pula para o
// meio do vídeo sem baixar o começo.
import { urlDeLeitura } from "@/lib/armazenamento";
import { BUCKET_VIDEOS, buscarVideoPorSlug } from "@/lib/videos";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const video = await buscarVideoPorSlug(slug);
  if (!video) return new Response("vídeo não encontrado", { status: 404 });

  const url = await urlDeLeitura(BUCKET_VIDEOS, video.caminho, 6 * 3600);
  return new Response(null, {
    status: 302,
    // 10 min de cache do redirecionamento: o player faz vários pedidos com
    // Range, e cada um não precisa voltar ao CRM para assinar de novo.
    headers: { Location: url, "Cache-Control": "private, max-age=600" },
  });
}
