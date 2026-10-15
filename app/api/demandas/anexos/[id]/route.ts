// Abre um anexo de demanda: GET /api/demandas/anexos/<id> (com ?baixar=1, o
// navegador salva com o nome do anexo).
//
// Confere quem pede com a MESMA regra de quem vê a demanda (anexoVisivel, em
// lib/demandas-anexos.ts) e redireciona para um link assinado de 10 minutos do
// bucket privado — o arquivo não passa pela Vercel, como o vídeo de
// app/v/[slug]/arquivo. Basta estar logado: quem abriu um chamado pelo
// Dashboard acompanha o dele sem ter o módulo.
import { exigirLoginApi } from "@/lib/auth/dal";
import { administraDemandas } from "@/lib/demandas";
import { anexoVisivel, linkDoAnexo } from "@/lib/demandas-anexos";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/demandas/anexos/[id]">) {
  const usuario = await exigirLoginApi();
  if (usuario instanceof Response) return usuario;

  const { id } = await ctx.params;
  const anexo = await anexoVisivel(id, usuario, administraDemandas(usuario));
  // 404 também para quem não pode ver: não confirma que o anexo existe.
  if (!anexo) return new Response("Not Found", { status: 404 });

  const baixar = new URL(req.url).searchParams.has("baixar");
  return new Response(null, {
    status: 302,
    headers: {
      Location: await linkDoAnexo(id, anexo.nome, baixar),
      // Menos que a validade do link: o cache nunca devolve um link vencido.
      "Cache-Control": "private, max-age=300",
    },
  });
}
