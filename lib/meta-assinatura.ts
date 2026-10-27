// A assinatura dos webhooks da Meta (X-Hub-Signature-256): HMAC-SHA256 do
// corpo BRUTO com o app secret, comparado em tempo constante (lib/segredo.ts).
//
// Nasceu com o webhook do Instagram (2026-10-26). As rotas do WhatsApp e dos
// leads têm a conferência delas e ficaram como estavam: trocar não era o
// pedido, e cada uma é ponto de entrada crítico.
import "server-only";
import { createHmac } from "node:crypto";
import { segredoConfere } from "@/lib/segredo";

/** O cabeçalho confere com o corpo? Sem segredo ou sem cabeçalho, não. */
export function assinaturaMetaConfere(corpo: Uint8Array, cabecalho: string | null, segredo: string): boolean {
  if (!segredo || !cabecalho) return false;
  const esperado = `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;
  return segredoConfere(cabecalho, esperado);
}
