// O estado das instâncias do WhatsApp Web no servidor da uazapi (/instance/all,
// com o token de admin): o que pinta o canal de verde, amarelo ou vermelho no
// chat (lib/canais.ts) e o que decide quando a secundária assume os envios
// (lib/uazapi-reserva.ts). Os dois leem daqui para não divergirem sobre o que é
// "caiu".
//
// A resposta da uazapi traz o token de cada instância: ele fica de fora do que
// sai deste arquivo.
import "server-only";
import { soDigitos } from "@/lib/telefone";

export type EstadoCanal = "conectado" | "conectando" | "desconectado" | "desconhecido";

export type InstanciaRemota = { id: string; status: string; owner: string; foto: string | null; perfil: string | null };

const ESTADO_UAZAPI: Record<string, EstadoCanal> = {
  connected: "conectado",
  connecting: "conectando",
  hibernated: "conectando",
  disconnected: "desconectado",
};

/** Todas as instâncias do servidor numa chamada. Lança se a uazapi não responder. */
export async function buscarInstanciasRemotas(): Promise<InstanciaRemota[]> {
  const base = (process.env.UAZAPI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const admin = (process.env.UAZAPI_ADMIN_TOKEN ?? "").trim();
  if (!base || !admin) return [];
  const r = await fetch(`${base}/instance/all`, {
    headers: { admintoken: admin },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`uazapi respondeu ${r.status}`);
  const dados = (await r.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(dados)) throw new Error("resposta inesperada da uazapi");
  return dados.map((d) => ({
    id: String(d.id ?? ""),
    status: String(d.status ?? ""),
    owner: String(d.owner ?? ""),
    foto: typeof d.profilePicUrl === "string" && d.profilePicUrl.trim() ? d.profilePicUrl.trim() : null,
    perfil: typeof d.profileName === "string" && d.profileName.trim() ? d.profileName.trim() : null,
  }));
}

/**
 * A instância nossa na lista da uazapi: pelo id dela ou, nas linhas antigas sem
 * id, pelo número dono (últimos 8 dígitos, como o resto do app).
 */
export function remotaDa(remotas: InstanciaRemota[], linha: { instancia_uazapi_id?: string | null; numero?: string | null }) {
  const fim8 = soDigitos(linha.numero ?? "").slice(-8);
  return remotas.find(
    (r) => (linha.instancia_uazapi_id && r.id === linha.instancia_uazapi_id) || (fim8.length === 8 && r.owner && soDigitos(r.owner).slice(-8) === fim8),
  );
}

/**
 * O estado de uma instância nossa. `remotas` null = a uazapi não respondeu, e o
 * estado é "desconhecido" em vez de inventar verde (ou vermelho). Instância que
 * não aparece na lista é desconectada.
 */
export function estadoDa(remotas: InstanciaRemota[] | null, linha: { instancia_uazapi_id?: string | null; numero?: string | null }): EstadoCanal {
  if (remotas === null) return "desconhecido";
  return ESTADO_UAZAPI[remotaDa(remotas, linha)?.status ?? ""] ?? "desconectado";
}
