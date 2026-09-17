// Um blog: abrir (com os artigos), editar e excluir.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { exigirModuloApi } from "@/lib/auth/dal";
import {
  artigosDoBlog,
  blogDepoisDeGravar,
  blogPorId,
  campo,
  lerCorpo,
  urlBase,
} from "@/lib/blog";

export const dynamic = "force-dynamic";

/** Id inteiro antes do banco: sem isto "abc" vira erro de sintaxe do Postgres. */
function idValido(bruto: string): number | null {
  return /^\d+$/.test(bruto) ? Number(bruto) : null;
}

const NAO_ENCONTRADO = { error: "Blog não encontrado." };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
  const id = idValido((await params).id);
  if (id === null) return Response.json(NAO_ENCONTRADO, { status: 404 });

  const blog = await blogPorId(id);
  if (!blog) return Response.json(NAO_ENCONTRADO, { status: 404 });

  return Response.json({ blog, artigos: await artigosDoBlog(id) });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
  const id = idValido((await params).id);
  if (id === null) return Response.json(NAO_ENCONTRADO, { status: 404 });

  const corpo = await lerCorpo(req);
  if (!corpo) return Response.json({ error: "Corpo inválido." }, { status: 400 });

  const nome = campo(corpo.nome, 200);
  if (!nome) return Response.json({ error: "Dê um nome ao blog." }, { status: 400 });

  // Mesma exigência do POST: não existe blog sem auditoria, nem por edição.
  const auditoriaId = campo(corpo.auditoriaId, 64);
  if (!auditoriaId) {
    return Response.json(
      { error: "Selecione a auditoria do blog." },
      { status: 400 },
    );
  }

  const [alterado] = await sql`
    UPDATE blog SET
      nome         = ${nome},
      auditoria_id = ${auditoriaId},
      descricao    = ${campo(corpo.descricao, 4000)},
      url_base     = ${urlBase(corpo.url_base)},
      autor        = ${campo(corpo.autor, 200)}
    WHERE id = ${id}
    RETURNING id`;

  if (!alterado) return Response.json(NAO_ENCONTRADO, { status: 404 });

  return Response.json(await blogDepoisDeGravar(id));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
  const id = idValido((await params).id);
  if (id === null) return Response.json(NAO_ENCONTRADO, { status: 404 });

  // Os artigos vão junto por ON DELETE CASCADE (migration-blog.sql). A tela
  // avisa quantos são antes de confirmar — aqui não há volta.
  await sql`DELETE FROM blog WHERE id = ${id}`;
  return Response.json({ ok: true });
}
