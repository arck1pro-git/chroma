// A ficha de UM contato, para a tela de Contatos trocar de contato sem
// recarregar a página: GET /api/contatos/ficha?id=<uuid>.
//
// Rota GET e não server action, de propósito: as actions de um cliente rodam
// UMA DE CADA VEZ, em fila. A tela pré-carrega os vizinhos do contato aberto e
// o que está sob o mouse — por action, esse pré-carregamento ficaria na frente
// do clique de verdade. Por fetch, vão em paralelo.
import type { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { fichaDoContato } from "@/lib/contatos-ficha";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const acesso = await exigirModuloApi("contatos");
  if (acesso instanceof Response) return acesso;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const campos = await sql`SELECT chave FROM campos_personalizados`;
  const ficha = await fichaDoContato(id, new Set(campos.map((c) => c.chave as string)));
  if (!ficha) return Response.json({ erro: "contato não encontrado" }, { status: 404 });
  return Response.json(ficha, { headers: { "Cache-Control": "private, no-store" } });
}
