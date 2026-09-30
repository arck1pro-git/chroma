// Trava de ambiente para envio de WhatsApp.
//
// Com WHATSAPP_SO_PARA definida (lista separada por vírgula), NENHUM envio sai
// para número fora dela — chat, IA, template ou anexo, pela uazapi ou pela
// Meta. É o que deixa testar no dev com números de verdade sem risco de a IA
// ou um teste falar com um cliente. Pedido dele (2026-09-28): no dev, só o
// 47 99934-6074.
//
// Em produção a variável NÃO existe e isto não faz nada.
//
// Compara pela chave canônica (lib/telefone.ts): com ou sem o nono dígito, é
// o mesmo número.
import { chaveTelefone, soDigitos } from "@/lib/telefone";

export function conferirDestino(numero: string): void {
  const lista = (process.env.WHATSAPP_SO_PARA ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (lista.length === 0) return;
  const alvo = chaveTelefone(numero);
  if (!lista.some((n) => chaveTelefone(n) === alvo)) {
    throw new Error(
      `Envio bloqueado neste ambiente: ${soDigitos(numero)} não está em WHATSAPP_SO_PARA.`,
    );
  }
}
