// O blog no Google (Search Console): o site, o recorte do blog e os números de
// cada artigo publicado, no período pedido. Só leitura.
//
// Sessão + módulo Blog. Nada aqui escreve no Google nem no banco; o que se
// guarda é em memória, por 15 minutos (lib/blog-google.ts). `?atualizar=1` é o
// botão Atualizar da tela: vai ao Google e espera.
import type { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { artigosParaOGoogle, blogPorId } from "@/lib/blog";
import { googleDoBlog } from "@/lib/blog-google";
import { periodoValido } from "@/lib/blog-google-tipos";

export const dynamic = "force-dynamic";
// Oito leituras em paralelo ao Search Console, cada uma de 1 a 3 s; o teto
// padrão cortaria uma propriedade lenta.
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;

  const bruto = (await params).id;
  const blog = /^\d+$/.test(bruto) ? await blogPorId(Number(bruto)) : null;
  if (!blog) return Response.json({ error: "Blog não encontrado." }, { status: 404 });

  const busca = req.nextUrl.searchParams;
  const resposta = await googleDoBlog(
    blog,
    await artigosParaOGoogle(blog.id),
    periodoValido(busca.get("dias")),
    busca.get("atualizar") === "1",
  );
  return Response.json(resposta);
}
