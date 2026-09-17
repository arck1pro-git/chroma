// Lista e cria blogs.
//
// REGRA DE NEGÓCIO QUE ESTA ROTA SUSTENTA: todo blog é orientado por uma
// auditoria. Sem `auditoriaId` não se cria blog — e a checagem está AQUI, não
// só na tela, porque é a API que garante a regra para quem chamar de fora.
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

export async function GET(req: NextRequest) {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
  const auditoriaId = req.nextUrl.searchParams.get("auditoriaId");
  return Response.json(await listarBlogs(auditoriaId));
}

export async function POST(req: NextRequest) {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
  const corpo = await lerCorpo(req);
  if (!corpo) return Response.json({ error: "Corpo inválido." }, { status: 400 });

  const nome = campo(corpo.nome, 200);
  if (!nome) return Response.json({ error: "Dê um nome ao blog." }, { status: 400 });

  const auditoriaId = campo(corpo.auditoriaId, 64);
  if (!auditoriaId) {
    return Response.json(
      { error: "Selecione a auditoria do blog." },
      { status: 400 },
    );
  }

  const [novo] = await sql`
    INSERT INTO blog (nome, auditoria_id, descricao, url_base, autor)
    VALUES (
      ${nome},
      ${auditoriaId},
      ${campo(corpo.descricao, 4000)},
      ${urlBase(corpo.url_base)},
      ${campo(corpo.autor, 200)}
    )
    RETURNING id`;

  // Relê no formato do GET (com auditoria_nome e a contagem) para a tela poder
  // inserir o item na lista sem inventar campo nem recarregar tudo.
  return Response.json(await blogDepoisDeGravar(novo.id as number), {
    status: 201,
  });
}
