// Webhook de leads dos formulários instantâneos da Meta (Lead Ads).
//
// A Meta avisa "chegou o lead X na página Y" (campo `leadgen` do objeto
// `page`) e manda só o id; as respostas são lidas na API com o token da
// página (lib/meta-leads.ts). Quem decide o que o lead vira é a configuração
// do formulário no módulo Formulários Meta (app/formularios).
//
// CONFIGURAÇÃO: o botão "Ligar recebimento" do módulo Formulários Meta assina
// este endereço no app da Meta e inscreve a página.
// O token de verificação é o mesmo do WhatsApp (META_WEBHOOK_VERIFY_TOKEN).
//
// SEGURANÇA: todo POST é assinado pela Meta com o app secret
// (X-Hub-Signature-256), conferido em tempo constante. Sem META_APP_SECRET a
// rota recusa tudo. E o corpo nem é confiado: o lead é LIDO de novo na Meta,
// então um aviso forjado com um id inventado não cria nada.
import { NextRequest, after } from "next/server";
import { revalidatePath } from "next/cache";
import { createHmac, timingSafeEqual } from "node:crypto";
import { receberLeadDaMeta } from "@/lib/meta-leads";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const modo = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token") ?? "";
  const desafio = req.nextUrl.searchParams.get("hub.challenge") ?? "";
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
  if (
    modo === "subscribe" &&
    esperado &&
    token.length === esperado.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(esperado))
  ) {
    return new Response(desafio, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

type AvisoLead = { leadgen_id?: string; page_id?: string; form_id?: string };
type CorpoWebhook = {
  object?: string;
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: AvisoLead }> }>;
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

  const avisos: Array<{ leadgenId: string; paginaId: string; formId?: string }> = [];
  for (const entry of corpo.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const leadgenId = change.value?.leadgen_id;
      const paginaId = change.value?.page_id ?? entry.id;
      const formId = change.value?.form_id ? String(change.value.form_id) : undefined;
      if (leadgenId && paginaId) avisos.push({ leadgenId: String(leadgenId), paginaId: String(paginaId), formId });
    }
  }

  // Responde já e processa depois: a Meta espera resposta rápida, e ler o lead
  // + criar contato + disparar a cadência leva segundos. Se algo falhar aqui, a
  // varredura de 5 em 5 minutos (lib/meta-leads.ts) pega o lead — só conta
  // como recebido o que gravou recebimento.
  if (avisos.length > 0) {
    after(async () => {
      let entraram = 0;
      for (const a of avisos) {
        try {
          const r = await receberLeadDaMeta(a.leadgenId, { paginaId: a.paginaId, formId: a.formId });
          if (r.estado === "recebido") entraram++;
          if (r.estado === "sem_recepcao") {
            console.warn(`[meta leads] lead ${a.leadgenId}: formulário ${a.formId ?? "?"} não configurado ou pausado`);
          }
        } catch (e) {
          console.error(`[meta leads] lead ${a.leadgenId}:`, e);
        }
      }
      if (entraram > 0) {
        try {
          revalidatePath("/");
          revalidatePath("/formularios");
        } catch {}
      }
    });
  }

  return Response.json({ ok: true, leads: avisos.length });
}
