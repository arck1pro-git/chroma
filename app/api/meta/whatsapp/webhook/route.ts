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
import { alimentaCampanha, avancarExecucao, registrarResposta } from "@/lib/campanhas-whatsapp";
import { iaResponde } from "@/lib/campanhas-fluxo-envios";
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
  const novas: Array<{ atendimentoId: string; mensagemId: string; id: string }> = [];
  // As mensagens que uma campanha consumiu (id da Meta → execução a continuar,
  // e se a IA fica calada nelas).
  const daCampanha = new Map<string, { execucaoId: string; continuar: boolean; calaIa: boolean }>();

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
        // Campanhas: a resposta escolhe a saída do "Aguardar resposta". Toda
        // mensagem nova menos reação, sistema e temporária (alimentaCampanha);
        // uma por vez, e o erro numa não perde as outras.
        for (const m of r.mensagens) {
          if (!alimentaCampanha(m)) continue;
          try {
            const c = await registrarResposta(m);
            if (c.consumida) daCampanha.set(m.id, { execucaoId: c.execucaoId, continuar: c.continuar, calaIa: c.calaIa });
          } catch (e) {
            console.error("[meta webhook] campanha não leu a resposta", m.id, e);
          }
        }
      } catch (e) {
        console.error("[meta webhook] erro ao processar:", e);
      }
    }
  }

  // Depois do 200 (a Meta espera resposta rápida), nesta ordem:
  //   1. A mídia: a URL da Meta vale minutos, então o download começa já, e o
  //      áudio sai transcrito (lib/midia.ts).
  //   2. As campanhas que a resposta destravou andam até a próxima espera. Se
  //      isto morrer, o /processar retoma (o after não é fila).
  //   3. A IA (se o contato estiver com IA e ninguém da equipe na conversa,
  //      decidido em lib/ia/atendente.ts). Depois da mídia porque responder um
  //      áudio antes da transcrição seria responder sem saber o que ele disse.
  //      Na mensagem que a campanha consumiu, a IA fica calada só se o caminho
  //      que a resposta tomou manda mensagem ao contato antes da próxima espera
  //      (calaIa; decisão de 2026-10-28, docs/campanhas-whatsapp.md). Se o
  //      fluxo acabou de ligar a IA, ela responde de qualquer jeito.
  if (comMidia > 0 || novas.length > 0 || daCampanha.size > 0) {
    after(async () => {
      if (comMidia > 0) await baixarPendentes();
      const ligouIa = new Set<string>();
      for (const [id, c] of daCampanha) {
        if (!c.continuar) continue;
        try {
          if ((await avancarExecucao(c.execucaoId)).ligouIa) ligouIa.add(id);
        } catch (e) {
          console.error("[meta webhook] campanha não continuou", c.execucaoId, e);
        }
      }
      await Promise.all(
        novas
          .filter((n) => iaResponde(daCampanha.get(n.id), ligouIa.has(n.id)))
          .map((n) => responderComIa(n.atendimentoId, n.mensagemId)),
      );
    });
  }

  return Response.json({ ok: true, recebidas, respostas: daCampanha.size });
}
