// POST e PUT nas rotas das campanhas de WhatsApp (/api/meta/whatsapp/campanhas).
// A recusa esperada — { erro, problemas? } com status de erro — volta como
// valor, para a tela mostrar a frase e marcar os blocos que o servidor
// apontou (tag que não existe mais, IA desligada…). Resposta 2xx sem JSON
// também volta como recusa. Falha de rede sobe: quem chama mostra a mensagem
// genérica. O GET continua em ../use-consulta.ts.
import type { ProblemaDoFluxo } from "@/lib/campanhas-fluxo";

export type RespostaDaRota<T> = { ok: true; dados: T } | { ok: false; erro: string; problemas: ProblemaDoFluxo[] };

export async function pedirCampanha<T>(url: string, metodo: "POST" | "PUT", corpo?: unknown): Promise<RespostaDaRota<T>> {
  const r = await fetch(url, {
    method: metodo,
    cache: "no-store",
    ...(corpo === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }),
  });
  const dados: unknown = await r.json().catch(() => null);
  if (r.ok) {
    // 2xx sem o corpo esperado (proxy, página de erro no meio do caminho): vira
    // recusa aqui, e quem chama não lê campo de um `dados` nulo nem lança.
    if (!dados || typeof dados !== "object")
      return { ok: false, erro: "O servidor respondeu sem os dados esperados. Atualize a lista para ver se a mudança foi feita.", problemas: [] };
    return { ok: true, dados: dados as T };
  }
  const recusa = (dados && typeof dados === "object" ? dados : {}) as { erro?: unknown; problemas?: unknown };
  return {
    ok: false,
    erro: typeof recusa.erro === "string" && recusa.erro ? recusa.erro : "Não foi possível concluir. Tente de novo.",
    problemas: Array.isArray(recusa.problemas)
      ? recusa.problemas.filter(
          (p): p is ProblemaDoFluxo => !!p && typeof p === "object" && typeof (p as ProblemaDoFluxo).mensagem === "string",
        )
      : [],
  };
}
