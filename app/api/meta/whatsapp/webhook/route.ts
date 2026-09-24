import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { registrarResposta } from "@/lib/campanhas-whatsapp";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const modo = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token") ?? "";
  const desafio = req.nextUrl.searchParams.get("hub.challenge") ?? "";
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
  if (modo === "subscribe" && esperado && token.length === esperado.length && timingSafeEqual(Buffer.from(token), Buffer.from(esperado))) {
    return new Response(desafio, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const segredo = process.env.META_APP_SECRET ?? "";
  if (!segredo) return Response.json({ erro: "META_APP_SECRET ausente" }, { status: 503 });
  const bytes = Buffer.from(await req.arrayBuffer());
  const recebido = req.headers.get("x-hub-signature-256") ?? "";
  const esperado = `sha256=${createHmac("sha256", segredo).update(bytes).digest("hex")}`;
  if (recebido.length !== esperado.length || !timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado))) {
    return Response.json({ erro: "assinatura inválida" }, { status: 401 });
  }
  const corpo = JSON.parse(bytes.toString("utf8")) as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ id?: string; from?: string }> } }> }> };
  let respostas = 0;
  for (const entry of corpo.entry ?? []) for (const change of entry.changes ?? []) for (const mensagem of change.value?.messages ?? []) {
    if (mensagem.from) respostas += (await registrarResposta(mensagem.from, mensagem.id)).encontradas;
  }
  return Response.json({ ok: true, respostas });
}
