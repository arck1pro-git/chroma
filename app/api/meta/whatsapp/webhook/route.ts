// Webhook da API oficial do WhatsApp (Cloud API). É por aqui que as mensagens
// enviadas ao número oficial entram no /chat, e que os status (enviado,
// entregue, lido, falhou) do que mandamos voltam para a conversa.
//
// CONFIGURAÇÃO, do lado da Meta (painel do app → WhatsApp → Configuração):
//   · URL de callback: https://<domínio do CRM>/api/meta/whatsapp/webhook
//   · Token de verificação: o valor de META_WEBHOOK_VERIFY_TOKEN
//   · Campo assinado: "messages"
// E o app precisa estar inscrito na WABA (POST /{waba}/subscribed_apps) —
// sem isso a Meta não entrega evento nenhum, e nem as mensagens saem.
//
// SEGURANÇA: todo POST é assinado pela Meta com o app secret
// (X-Hub-Signature-256). Sem META_APP_SECRET a rota recusa tudo.
import { NextRequest, after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { registrarResposta } from "@/lib/campanhas-whatsapp";
import { processarWebhookOficial, type ValorWebhookMeta } from "@/lib/whatsapp-oficial";
import { baixarPendentes } from "@/lib/midia";
import { responderComIa } from "@/lib/ia/atendente";

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

type CorpoWebhook = {
  entry?: Array<{ changes?: Array<{ field?: string; value?: ValorWebhookMeta }> }>;
};

export async function POST(req: NextRequest) {
  const segredo = process.env.META_APP_SECRET ?? "";
  if (!segredo) return Response.json({ erro: "META_APP_SECRET ausente" }, { status: 503 });
  const bytes = Buffer.from(await req.arrayBuffer());
  const recebido = req.headers.get("x-hub-signature-256") ?? "";
  const esperado = `sha256=${createHmac("sha256", segredo).update(bytes).digest("hex")}`;
  if (recebido.length !== esperado.length || !timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado))) {
    return Response.json({ erro: "assinatura inválida" }, { status: 401 });
  }

  let corpo: CorpoWebhook;
  try {
    corpo = JSON.parse(bytes.toString("utf8")) as CorpoWebhook;
  } catch {
    return Response.json({ ok: true });
  }

  let recebidas = 0;
  let comMidia = 0;
  let respostas = 0;
  const novas: Array<{ atendimentoId: string; mensagemId: string }> = [];

  // Daqui para baixo, SEMPRE 200. Assinatura válida é evento legítimo; se o
  // processamento falhar, o erro vai para o log. Devolver 500 faria a Meta
  // reenviar o lote por dias — duplicando o que já tinha dado certo nele.
  for (const entry of corpo.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== "messages") continue;
      const valor = change.value ?? {};
      try {
        const r = await processarWebhookOficial(valor);
        recebidas += r.recebidas;
        comMidia += r.comMidia;
        novas.push(...r.novas);
        // Campanhas: resposta do contato encerra a espera e dispara as ações.
        for (const { numero, id } of r.remetentes) {
          respostas += (await registrarResposta(numero, id)).encontradas;
        }
      } catch (e) {
        console.error("[meta webhook] erro ao processar:", e);
      }
    }
  }

  // Depois do 200 (a Meta espera resposta rápida), nesta ordem:
  //   1. A mídia: a URL da Meta vale minutos, então o download começa já, e o
  //      áudio sai transcrito (lib/midia.ts).
  //   2. A IA (se o contato estiver com IA e ninguém da equipe na conversa,
  //      decidido em lib/ia/atendente.ts). Depois da mídia porque responder um
  //      áudio antes da transcrição seria responder sem saber o que ele disse.
  if (comMidia > 0 || novas.length > 0) {
    after(async () => {
      if (comMidia > 0) await baixarPendentes();
      await Promise.all(novas.map((n) => responderComIa(n.atendimentoId, n.mensagemId)));
    });
  }

  return Response.json({ ok: true, recebidas, respostas });
}
