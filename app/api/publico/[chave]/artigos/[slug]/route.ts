// Um artigo do blog, pelo slug — a outra metade da URL de conexão.
//
//     GET /api/publico/<chave>/artigos/<slug>
//
// É ESTA ROTA QUE PÕE O SLUG NA URL: o site espelha o próprio endereço
// (/blog/como-escolher-piso) neste, e recebe o artigo com o HTML pronto, as
// meta tags e o JSON-LD. Nada de id no caminho — o slug é o que o leitor vê na
// barra de endereços, e é o que o artigo carrega.
import type { NextRequest } from "next/server";
import {
  artigoPublico,
  artigoPublicoPorSlug,
  blogPorChave,
  blogPublico,
  naoEncontrado,
  preflight,
  respostaPublica,
  type RespostaArtigo,
} from "@/lib/blog-publico";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/publico/[chave]/artigos/[slug]">,
) {
  const { chave, slug } = await ctx.params;

  const blog = await blogPorChave(chave);
  if (!blog) return naoEncontrado();

  // Sem decodificar: o Next já entrega o segmento decodificado, e o slug da
  // coluna é sempre [a-z0-9-] (lib/artigo.ts, slugify). Um decode a mais só
  // acrescentaria um jeito de a rota estourar — "%ZZ" no caminho derruba o
  // decodeURIComponent com URIError, que aqui viraria 500 em vez de 404.
  const artigo = await artigoPublicoPorSlug(blog.id, slug);
  if (!artigo) return naoEncontrado();

  const corpo: RespostaArtigo = {
    blog: blogPublico(blog),
    artigo: artigoPublico(artigo, blog),
  };
  return respostaPublica(corpo);
}

export function OPTIONS() {
  return preflight();
}
