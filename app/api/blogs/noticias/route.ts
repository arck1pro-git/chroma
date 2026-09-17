// As notícias dos feeds, para a TELA.
//
// A DIFERENÇA PARA /api/blogs/rss/pauta: aquela é a porta de serviço do n8n —
// exige o token, só enxerga blog com a geração automática LIGADA e devolve
// apenas o que vai virar artigo na segunda. Esta é a lista que a pessoa vê:
// todo blog com feed entra, inclusive o desligado e o que está sem auditoria
// (esse aparece com o motivo, em vez de sumir sem explicação), e as matérias
// que já viraram artigo vêm junto, marcadas — "essa eu já usei" é resposta.
//
// `?blogId=` restringe a um blog, e é assim que a tela chama: a lista de
// notícias mora dentro de /blog/[id]. Sem o parâmetro vem a de todos os blogs —
// nenhuma tela pede isso hoje; fica porque o recorte é do banco, não daqui.
import { NextRequest } from "next/server";
import { POR_BLOG_TELA, pautaDosBlogs } from "@/lib/blog-pauta";
import { exigirModuloApi } from "@/lib/auth/dal";

// Buscar até 5 feeds de cada blog é espera de rede, não de CPU — mas com
// vários blogs o padrão do runtime corta antes de o último responder.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
  const bruto = req.nextUrl.searchParams.get("blogId");
  if (bruto && !/^\d+$/.test(bruto)) {
    return Response.json({ error: "blogId inválido." }, { status: 400 });
  }

  const blogs = await pautaDosBlogs({
    blogId: bruto ? Number(bruto) : undefined,
    limite: POR_BLOG_TELA,
    incluirUsados: true,
  });

  return Response.json({ blogs });
}
