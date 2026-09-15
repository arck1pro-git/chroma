// O índice do blog para o site do cliente.
//
//     GET /api/publico/<chave>/artigos
//
// É metade da "URL de conexão": o site pede esta lista para montar a página do
// blog, e depois pede /artigos/<slug> para montar cada post. O slug que ele usa
// na própria rota é o `slug` que sai daqui — os dois lados falam do mesmo
// endereço.
//
// SEM TOKEN DE SERVIÇO, ao contrário de /api/blogs/rss/pauta: quem chama é o
// site publicado, muitas vezes do navegador do visitante. A chave na URL é a
// credencial, e o que ela abre é conteúdo aprovado para ficar público.
import type { NextRequest } from "next/server";
import {
  artigosPublicos,
  blogPorChave,
  blogPublico,
  naoEncontrado,
  preflight,
  respostaPublica,
  resumoPublico,
  type RespostaIndice,
} from "@/lib/blog-publico";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/publico/[chave]/artigos">,
) {
  const { chave } = await ctx.params;

  const blog = await blogPorChave(chave);
  if (!blog) return naoEncontrado();

  const artigos = await artigosPublicos(blog.id);

  const corpo: RespostaIndice = {
    blog: blogPublico(blog),
    artigos: artigos.map((a) => resumoPublico(a, blog)),
  };
  return respostaPublica(corpo);
}

export function OPTIONS() {
  return preflight();
}
