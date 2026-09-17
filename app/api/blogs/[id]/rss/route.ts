// Os feeds RSS de um blog e o interruptor da geração automática.
//
// Rota separada do PUT do blog de propósito: o painel de RSS fica no TOPO da
// tela de artigos, não na gaveta de configuração, e salvar os feeds não pode
// exigir mandar nome, auditoria e endereço junto — nem sobrescrevê-los com o
// que estivesse na tela.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { campo, lerCorpo } from "@/lib/blog";
import { urlDeFeedValida } from "@/lib/blog-rss";
import { exigirModuloApi } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/** Teto de produto: 5 feeds por blog. */
export const MAX_FEEDS = 5;

function idValido(bruto: string): number | null {
  return /^\d+$/.test(bruto) ? Number(bruto) : null;
}

const NAO_ENCONTRADO = { error: "Blog não encontrado." };

async function estado(blogId: number) {
  const [blog] = await sql`SELECT rss_ativo FROM blog WHERE id = ${blogId}`;
  if (!blog) return null;
  const feeds = await sql`
    SELECT id, url FROM blog_rss WHERE blog_id = ${blogId} ORDER BY id`;
  return { rss_ativo: blog.rss_ativo as boolean, feeds };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
  const id = idValido((await params).id);
  if (id === null) return Response.json(NAO_ENCONTRADO, { status: 404 });

  const atual = await estado(id);
  if (!atual) return Response.json(NAO_ENCONTRADO, { status: 404 });
  return Response.json(atual);
}

/**
 * Substitui a lista inteira de feeds e o interruptor.
 *
 * Substituir em vez de aplicar diferença: a tela edita 5 campos de texto de uma
 * vez e manda o conjunto. Casar linha a linha exigiria id em cada campo para
 * ganhar nada — a tabela é minúscula e não guarda estado por feed.
 */
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

  const [blog] = await sql`SELECT id FROM blog WHERE id = ${id}`;
  if (!blog) return Response.json(NAO_ENCONTRADO, { status: 404 });

  const brutos = Array.isArray(corpo.feeds) ? corpo.feeds : [];
  const vistos = new Set<string>();
  const urls: string[] = [];

  for (const bruto of brutos) {
    const url = campo(bruto, 2000);
    if (!url) continue;
    if (!urlDeFeedValida(url)) {
      return Response.json(
        { error: `Endereço de feed inválido: ${url.slice(0, 80)}` },
        { status: 400 },
      );
    }
    // Repetido não é erro de digitação que valha travar o salvamento — só não
    // entra duas vezes (o UNIQUE (blog_id, url) recusaria de qualquer forma).
    if (vistos.has(url)) continue;
    vistos.add(url);
    urls.push(url);
  }

  if (urls.length > MAX_FEEDS) {
    return Response.json(
      { error: `São no máximo ${MAX_FEEDS} feeds por blog.` },
      { status: 400 },
    );
  }

  const ativo = corpo.rss_ativo === true;

  // Ligar sem nenhum feed é o pedido que não faz nada: a automação rodaria na
  // segunda, não acharia pauta e o blog pareceria quebrado.
  if (ativo && urls.length === 0) {
    return Response.json(
      { error: "Cadastre ao menos um feed antes de ligar a geração automática." },
      { status: 400 },
    );
  }

  await sql`DELETE FROM blog_rss WHERE blog_id = ${id}`;
  for (const url of urls) {
    await sql`INSERT INTO blog_rss (blog_id, url) VALUES (${id}, ${url})`;
  }
  await sql`UPDATE blog SET rss_ativo = ${ativo} WHERE id = ${id}`;

  return Response.json(await estado(id));
}
