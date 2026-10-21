import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processarExpirados, processarFila } from "@/lib/campanhas-whatsapp";
import { ehUuid } from "@/lib/validacao";

function autorizado(req: NextRequest) {
  const esperado = process.env.CRM_SERVICE_TOKEN ?? "";
  const recebido = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!esperado || esperado.length !== recebido.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ erro: "não autorizado" }, { status: 401 });
  const corpo = await req.json().catch(() => ({})) as { campanhaId?: unknown };
  const campanhaId = typeof corpo.campanhaId === "string" && ehUuid(corpo.campanhaId) ? corpo.campanhaId : undefined;
  const [fila, prazos] = await Promise.all([processarFila(100, campanhaId), processarExpirados(500, campanhaId)]);
  return Response.json({ ok: true, fila, prazos });
}
