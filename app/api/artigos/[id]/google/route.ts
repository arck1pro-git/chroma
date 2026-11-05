// Um artigo publicado no Google: cliques, impressões, posição, as consultas que
// trouxeram a página e o estado de indexação da URL. Só leitura.
//
// Sessão + módulo Blog. A inspeção de indexação gasta cota do Search Console
// (2.000 por dia por propriedade) e fica guardada 6 h em memória; quem chama
// esta rota é o painel do artigo, quando a aba Google abre — não a lista.
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { exigirModuloApi } from "@/lib/auth/dal";
import type { Artigo } from "@/lib/artigo";
import { googleDoArtigo } from "@/lib/blog-google";
import { periodoValido } from "@/lib/blog-google-tipos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;

  const bruto = (await params).id;
  if (!/^\d+$/.test(bruto)) return Response.json({ error: "Artigo não encontrado." }, { status: 404 });

  const [linha] = await sql`
    SELECT a.id, a.slug, a.titulo, a.status, b.url_base
    FROM artigo a JOIN blog b ON b.id = a.blog_id
    WHERE a.id = ${Number(bruto)}`;
  if (!linha) return Response.json({ error: "Artigo não encontrado." }, { status: 404 });

  const artigo = linha as unknown as Pick<Artigo, "id" | "slug" | "titulo" | "status"> & { url_base: string };
  const busca = req.nextUrl.searchParams;
  return Response.json(
    await googleDoArtigo(
      { url_base: artigo.url_base },
      artigo,
      periodoValido(busca.get("dias")),
      busca.get("atualizar") === "1",
    ),
  );
}
