// A rodada das retomadas da IA (lib/ia/retomada.ts). Quem chama é o agendador
// do n8n, de 5 em 5 minutos, com o token de serviço do CRM — porta de serviço,
// sem sessão (proxy.ts, SERVICO_EXATAS).
//
// Na mesma rodada, o fim da cadência para quem respondeu (2026-11-06,
// lib/automacoes/fim-da-cadencia.ts): o lead que conversa fica na etapa da IA,
// e quando a cadência acaba sem reunião nem atendimento humano, sai dela.
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { encerrarCadenciasVencidas } from "@/lib/automacoes/fim-da-cadencia";
import { retomarConversas } from "@/lib/ia/retomada";

export const dynamic = "force-dynamic";
// Até 10 retomadas por rodada, cada uma com uma chamada ao modelo.
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!autorizado(req)) return naoAutorizado();
  const retomadas = await retomarConversas();
  // Falhar aqui não pode esconder o resumo das retomadas, que já saíram.
  const fimDaCadencia = await encerrarCadenciasVencidas().catch((e) => {
    console.error("[fim da cadência] rodada falhou:", e);
    return null;
  });
  return Response.json({ ...retomadas, fimDaCadencia });
}
