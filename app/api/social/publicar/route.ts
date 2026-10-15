// A rodada do agendador dos posts das redes (lib/social/posts.ts,
// publicarVencidos). Quem chama é o n8n, a cada minuto, com o token de serviço
// do CRM — porta de serviço, sem sessão (proxy.ts, SERVICO_EXATAS).
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { publicarVencidos } from "@/lib/social/posts";

export const dynamic = "force-dynamic";
// Vídeo no Instagram espera a Meta processar; a rodada para com folga antes.
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!autorizado(req)) return naoAutorizado();
  return Response.json(await publicarVencidos());
}
