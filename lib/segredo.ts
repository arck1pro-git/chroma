// Comparar segredo recebido com o esperado SEM vazar pelo tempo (2026-10-20,
// auditoria de segurança). `a !== b` para no primeiro caractere diferente, e
// medir quanto a resposta demora entrega, com paciência, quantos caracteres do
// começo estão certos. timingSafeEqual compara tudo sempre.
//
// O tamanho em si continua observável (timingSafeEqual exige tamanhos iguais),
// e tudo bem: os segredos daqui têm tamanho fixo e longo.
import "server-only";
import { timingSafeEqual } from "node:crypto";

export function segredoConfere(recebido: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!recebido || !esperado) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
