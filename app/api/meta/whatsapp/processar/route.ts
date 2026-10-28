// A rodada das campanhas de WhatsApp oficial, chamada pelo agendador de cada
// campanha no n8n (lib/campanhas-workflow.ts) a cada minuto, com o token de
// serviço. Nesta ordem: execuções presas viram falha (nunca reenvio no
// escuro), prazos vencidos saem por "sem resposta", a fila anda (inscritas e
// as que têm hora de continuar) e os avisos à equipe saem juntos por pessoa.
// Os avisos são de TODAS as campanhas ativas: juntar por pessoa só vale se a
// rodada vê o que cada campanha enfileirou.
import { NextRequest } from "next/server";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { enviarAvisosPendentes, processarExpirados, processarFila, recuperarPresas } from "@/lib/campanhas-whatsapp";
import { ehUuid } from "@/lib/validacao";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return naoAutorizado();
  const corpo = (await req.json().catch(() => ({}))) as { campanhaId?: unknown };
  const campanhaId = typeof corpo.campanhaId === "string" && ehUuid(corpo.campanhaId) ? corpo.campanhaId : undefined;
  const presas = await recuperarPresas();
  const prazos = await processarExpirados(500, campanhaId);
  const fila = await processarFila(100, campanhaId);
  const avisos = await enviarAvisosPendentes();
  return Response.json({ ok: true, presas, prazos, fila, avisos });
}
