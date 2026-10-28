import { NextRequest } from "next/server";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { moverPelaCadencia } from "@/lib/automacoes/mover-pela-cadencia";

// O bloco "Atualizar oportunidade" (com etapa) do motor chama aqui. Mesma porta
// e mesmo token do /api/automacoes/enviar; quem decide se move é
// lib/automacoes/mover-pela-cadencia.ts.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return naoAutorizado();

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "corpo inválido" }, { status: 400 });
  }

  // no_id: o bloco no fluxo. Com ele, o destino é o da versão publicada agora.
  const r = await moverPelaCadencia(
    String(corpo.execucao_id ?? ""),
    String(corpo.etapa_id ?? ""),
    String(corpo.no_id ?? "").slice(0, 100),
  );
  if ("erro" in r) return Response.json({ erro: r.erro }, { status: r.status });
  // Pulado não é falha: o motor segue para o fim, e a resposta diz por quê.
  return Response.json({ ok: true, ...r });
}
