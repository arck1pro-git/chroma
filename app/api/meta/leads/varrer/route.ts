// A varredura dos formulários da Meta (lib/meta-leads.ts): lê os leads das
// últimas 24 horas de cada formulário configurado e recebe os que ainda não
// entraram. Quem chama é o agendador do n8n, de 5 em 5 minutos, com o token de
// serviço do CRM — porta de serviço, sem sessão (proxy.ts, SERVICO_EXATAS).
//
// 24 horas e não 5 minutos: a rodada é barata (uma leitura por formulário) e a
// janela larga cobre o n8n que ficou fora do ar por umas horas. O que já
// entrou é pulado pelo leadgen_id.
import { revalidatePath } from "next/cache";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { varrerLeadsDaMeta } from "@/lib/meta-leads";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!autorizado(req)) return naoAutorizado();
  const r = await varrerLeadsDaMeta(24);
  if (r.novos > 0) {
    revalidatePath("/");
    revalidatePath("/formularios");
  }
  return Response.json(r);
}
