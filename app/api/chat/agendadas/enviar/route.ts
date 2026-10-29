// A rodada das mensagens agendadas nos grupos (lib/mensagens-agendadas.ts,
// enviarAgendadasVencidas). Quem chama é o n8n, a cada minuto, com o token de
// serviço do CRM — porta de serviço, sem sessão (proxy.ts, SERVICO_EXATAS).
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { enviarAgendadasVencidas } from "@/lib/mensagens-agendadas";

export const dynamic = "force-dynamic";
// Um lote com vídeo sobe o arquivo para a uazapi antes de mandar.
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!autorizado(req)) return naoAutorizado();
  return Response.json(await enviarAgendadasVencidas());
}
