// Webhook do Instagram (object = "instagram"): as mensagens do direct e os
// comentários das três contas de lib/social/perfis.ts entram por aqui
// (2026-10-26). Rota PÚBLICA (proxy.ts): quem chama é a Meta, sem cookie.
//
// CONFIGURAÇÃO, do lado da Meta (não é feita por esta rota): o app assina o
// objeto "instagram" (campos messages e comments) com este endereço e o
// META_WEBHOOK_VERIFY_TOKEN — a função pronta é inscreverInstagramNoApp, em
// lib/instagram-inscricao.ts, e só roda com o OK dele.
//
// TRANCA: GET confere o verify token em tempo constante; POST confere a
// assinatura X-Hub-Signature-256 do corpo bruto com o META_APP_SECRET. Sem o
// segredo, 503; assinatura errada, 401; certa, 200 para inválidos/ignorados
// ou 503 se a persistência falhar (reentrega idempotente). O trabalho pesado
// (perfil, mídia, IAs) vai para `after`, inclusive dos itens salvos num lote
// parcialmente falho; o processamento está em lib/instagram-webhook.ts.
import { NextRequest, after } from "next/server";
import { segredoConfere } from "@/lib/segredo";
import { receberWebhookInstagram } from "@/lib/instagram-webhook";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const modo = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const desafio = req.nextUrl.searchParams.get("hub.challenge") ?? "";
  if (modo === "subscribe" && segredoConfere(token, process.env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(desafio, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const r = await receberWebhookInstagram(
    new Uint8Array(await req.arrayBuffer()),
    req.headers.get("x-hub-signature-256"),
    process.env.META_APP_SECRET ?? "",
  );
  // O 503 também pode trazer trabalho de itens que já foram persistidos.
  if (r.depois) after(r.depois);
  return Response.json(r.corpo, { status: r.status });
}
