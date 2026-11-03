// O envio de um anexo de demanda, do lado do navegador: comprime a foto e sobe
// direto para o Supabase (o servidor só assina — ver lib/demandas-anexos.ts).
// Usado pelo formulário (app/components/modal-demanda.tsx) e pela gaveta
// (app/demandas/anexos.tsx).
//
// FOTO VIRA WEBP antes de subir (pedido dele, 2026-10-15), pela otimização
// compartilhada (app/components/otimizar-foto.ts): o anexo fica só no CRM.
import { prepararAnexoDemanda } from "./acoes";
import type { AnexoDemanda } from "@/lib/demandas-tipos";
import { otimizarFoto } from "@/app/components/otimizar-foto";

/** Comprime (se for foto), assina e sobe. Devolve o anexo para a ação gravar. */
export async function subirAnexo(original: File): Promise<AnexoDemanda> {
  const arquivo = await otimizarFoto(original, "webp");
  const preparo = await prepararAnexoDemanda(arquivo.size);
  if (!preparo.ok) throw new Error(preparo.mensagem);

  // O mesmo formato do supabase-js (e do upload dos vídeos): PUT multipart,
  // campo sem nome, sem Authorization — o token está na própria URL.
  const corpo = new FormData();
  corpo.append("cacheControl", "3600");
  corpo.append("", arquivo, arquivo.name);
  const res = await fetch(preparo.url, { method: "PUT", headers: { "x-upsert": "false" }, body: corpo });
  if (!res.ok) {
    const motivo = await res.json().then((j: { message?: string }) => j.message).catch(() => null);
    throw new Error(`O arquivo "${arquivo.name}" não subiu${motivo ? `: ${motivo}` : ""}.`);
  }
  return { id: preparo.id, nome: arquivo.name };
}

export function tamanhoEmTexto(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
}
