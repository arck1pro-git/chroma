// O envio de um anexo de demanda, do lado do navegador: comprime a foto e sobe
// direto para o Storage (o servidor só assina — ver lib/demandas-anexos.ts).
// Usado pelo formulário (app/components/modal-demanda.tsx) e pela gaveta
// (app/demandas/anexos.tsx).
//
// FOTO VIRA WEBP antes de subir (pedido dele, 2026-10-15), pela otimização
// compartilhada (app/components/otimizar-foto.ts): o anexo fica só no CRM.
import { prepararAnexoDemanda } from "./acoes";
import type { AnexoDemanda } from "@/lib/demandas-tipos";
import { enviarArquivo } from "@/app/components/enviar-arquivo";
import { otimizarFoto } from "@/app/components/otimizar-foto";

/** Comprime (se for foto), assina e sobe. Devolve o anexo para a ação gravar. */
export async function subirAnexo(original: File): Promise<AnexoDemanda> {
  const arquivo = await otimizarFoto(original, "webp");
  const preparo = await prepararAnexoDemanda(arquivo.size, arquivo.type);
  if (!preparo.ok) throw new Error(preparo.mensagem);
  await enviarArquivo(preparo.url, arquivo, preparo.mime).catch((e: Error) => {
    throw new Error(`O arquivo "${arquivo.name}" não subiu: ${e.message}.`);
  });
  return { id: preparo.id, nome: arquivo.name };
}

export function tamanhoEmTexto(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
}
