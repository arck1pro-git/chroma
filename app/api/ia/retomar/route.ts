// A rodada das retomadas da IA (lib/ia/retomada.ts). Quem chama é o agendador
// do n8n, de 5 em 5 minutos, com o token de serviço do CRM — porta de serviço,
// sem sessão (proxy.ts, SERVICO_EXATAS).
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { retomarConversas } from "@/lib/ia/retomada";

export const dynamic = "force-dynamic";
// Até 10 retomadas por rodada, cada uma com uma chamada ao modelo.
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!autorizado(req)) return naoAutorizado();
  return Response.json(await retomarConversas());
}
