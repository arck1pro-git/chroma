// Lista e cria artigos.
//
// Quem GRAVA o artigo é esta rota — não a de geração. /api/artigos/generate
// devolve o rascunho e para por aí; a linha só nasce quando alguém aprova a
// prévia e clica em salvar. Gravar antes encheria o blog de rascunho
// descartado, um por tentativa de geração.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { slugify } from "@/lib/artigo";
import { slugLivre } from "@/lib/artigo-server";
import { artigosDoBlog, campo, camposArtigo, lerCorpo } from "@/lib/blog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const blogId = req.nextUrl.searchParams.get("blogId");

  if (blogId && /^\d+$/.test(blogId)) {
    return Response.json(await artigosDoBlog(Number(blogId)));
  }

  // Sem filtro: todos os artigos, com o nome do blog junto. É a busca global —
  // por isso ordena por data pura, e não pela ordem de trabalho de um blog só.
  const linhas = await sql`
    SELECT ${sql.unsafe(camposArtigo("a"))}, b.nome AS blog_nome
    FROM artigo a JOIN blog b ON b.id = a.blog_id
    ORDER BY a.created_at DESC`;

  return Response.json(linhas);
}

export async function POST(req: NextRequest) {
  const corpo = await lerCorpo(req);
  if (!corpo) return Response.json({ error: "Corpo inválido." }, { status: 400 });

  const blogId = Number(corpo.blogId);
  if (!Number.isInteger(blogId) || blogId <= 0) {
    return Response.json({ error: "Selecione o blog." }, { status: 400 });
  }

  const titulo = campo(corpo.titulo, 500);
  if (!titulo) {
    return Response.json(
      { error: "O artigo precisa de um título." },
      { status: 400 },
    );
  }

  const [blog] = await sql`SELECT id FROM blog WHERE id = ${blogId}`;
  if (!blog) {
    return Response.json({ error: "Blog não encontrado." }, { status: 404 });
  }

  // Slug desambiguado DENTRO do blog: dois artigos com o mesmo título viram
  // "titulo" e "titulo-2" em vez de estourar o índice único.
  const slug = await slugLivre(blogId, campo(corpo.slug, 200) || slugify(titulo));

  const [novo] = await sql`
    INSERT INTO artigo (
      blog_id, titulo, slug, meta_title, meta_description, palavra_chave,
      keywords, resumo, conteudo, imagem_alt, fonte_titulo, fonte_url
    ) VALUES (
      ${blogId},
      ${titulo},
      ${slug},
      ${campo(corpo.meta_title, 300)},
      ${campo(corpo.meta_description, 500)},
      ${campo(corpo.palavra_chave, 200)},
      ${campo(corpo.keywords, 1000)},
      ${campo(corpo.resumo, 2000)},
      ${campo(corpo.conteudo, 200_000)},
      ${campo(corpo.imagem_alt, 500)},
      ${campo(corpo.fonte_titulo, 500)},
      ${campo(corpo.fonte_url, 2000)}
    )
    RETURNING ${sql.unsafe(camposArtigo())}`;

  return Response.json(novo, { status: 201 });
}
