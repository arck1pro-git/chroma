// Lista e cria blogs.
//
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { exigirModuloApi } from "@/lib/auth/dal";
import {
  blogDepoisDeGravar,
  campo,
  lerCorpo,
  listarBlogs,
  urlBase,
} from "@/lib/blog";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
  return Response.json(await listarBlogs());
}

export async function POST(req: NextRequest) {
  const sessao = await exigirModuloApi("blog", "criar");
  if (sessao instanceof Response) return sessao;
  const corpo = await lerCorpo(req);
  if (!corpo) return Response.json({ error: "Corpo inválido." }, { status: 400 });

  const nome = campo(corpo.nome, 200);
  if (!nome) return Response.json({ error: "Dê um nome ao blog." }, { status: 400 });

  const [novo] = await sql`
    INSERT INTO blog (nome, descricao, url_base, autor)
    VALUES (
      ${nome},
      ${campo(corpo.descricao, 4000)},
      ${urlBase(corpo.url_base)},
      ${campo(corpo.autor, 200)}
    )
    RETURNING id`;

  // Relê no formato do GET (com a contagem de artigos) para a tela poder
  // inserir o item na lista sem inventar campo nem recarregar tudo.
  return Response.json(await blogDepoisDeGravar(novo.id as number), {
    status: 201,
  });
}
