// O player do lead dizendo o que já tocou: POST { id, token, trechos, naPagina, duracao }.
//
// Lido como TEXTO: o sinal de saída vai por navigator.sendBeacon, que manda
// text/plain — req.json() recusaria pelo tipo, e justamente o último sinal (o
// mais completo) se perderia.
import type { NextRequest } from "next/server";
import { registrarSinal } from "@/lib/videos";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let dados: unknown;
  try {
    dados = JSON.parse(await req.text());
  } catch {
    return new Response(null, { status: 400 });
  }
  const aceito = await registrarSinal(dados);
  return new Response(null, { status: aceito ? 204 : 403 });
}
