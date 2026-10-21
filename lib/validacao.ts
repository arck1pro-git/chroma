// Validação de entrada que se repete em ação, rota e ferramenta de IA.
//
// Sem `server-only`: a mesma conferência serve na tela, antes de mandar.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O valor é um uuid no formato canônico (8-4-4-4-12)?
 *
 * Substitui as 50 cópias da regex espalhadas até 2026-10-21, em duas versões:
 * esta e a frouxa `[0-9a-f-]{36}`, que aceitava 36 hífens. Todo id gerado pelo
 * banco passa nas duas; a diferença é só o lixo que a frouxa deixava chegar à
 * consulta, onde virava erro do Postgres em vez de recusa limpa.
 */
export function ehUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}
