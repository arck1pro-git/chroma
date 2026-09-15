// Trocar a chave de conexão do blog.
//
// QUANDO SE USA: a chave vazou, ou o site que a usava saiu do ar e não se quer
// mais responder a ele. O efeito é imediato e é o ponto: a URL antiga passa a
// devolver 404 na hora, então QUEM ESTIVER USANDO PARA DE FUNCIONAR até colar a
// nova. A tela avisa isso antes de chamar.
//
// POST e não PUT: não há corpo, e o resultado é diferente a cada chamada.
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { blogDepoisDeGravar } from "@/lib/blog";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/blogs/[id]/chave">,
) {
  const bruto = (await ctx.params).id;
  if (!/^\d+$/.test(bruto)) {
    return Response.json({ error: "Blog não encontrado." }, { status: 404 });
  }
  const id = Number(bruto);

  // A chave nova sai da MESMA expressão do default da coluna
  // (migration-blog-publicacao.sql): um gerador só, no banco, para a chave que
  // nasce com o blog e a que o substitui.
  const [alterado] = await sql`
    UPDATE blog
    SET chave = 'bk_' || replace(gen_random_uuid()::text, '-', '')
    WHERE id = ${id}
    RETURNING id`;

  if (!alterado) {
    return Response.json({ error: "Blog não encontrado." }, { status: 404 });
  }

  return Response.json(await blogDepoisDeGravar(id));
}
