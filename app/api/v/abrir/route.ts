// O player do lead avisando que a página abriu: POST { slug, w }.
//
// Pública (proxy.ts, "/api/v/"). Devolve o id da visualização e o token que os
// sinais seguintes precisam apresentar (lib/videos.ts).
import type { NextRequest } from "next/server";
import { abrirVisualizacao } from "@/lib/videos";

export const dynamic = "force-dynamic";

// Robô de prévia de link não roda JavaScript e não chega aqui — mas se algum
// rodar, não é o lead assistindo.
const ROBO = /bot\b|crawler|spider|facebookexternalhit|WhatsApp\//i;

export async function POST(req: NextRequest) {
  let corpo: Record<string, unknown>;
  try {
    corpo = JSON.parse(await req.text());
  } catch {
    return Response.json({ erro: "corpo não é JSON" }, { status: 400 });
  }

  const agente = req.headers.get("user-agent");
  if (agente && ROBO.test(agente)) return new Response(null, { status: 204 });

  const slug = typeof corpo?.slug === "string" ? corpo.slug : "";
  const sessao = await abrirVisualizacao(slug, corpo?.w, agente);
  if (!sessao) return Response.json({ erro: "vídeo não encontrado" }, { status: 404 });
  return Response.json(sessao);
}
