// Os canais do /chat: cada número nosso que recebe conversa.
//
// São DOIS tipos, com papéis diferentes na empresa — e é por isso que a tela os
// separa em vez de listar "números":
//   · web → instâncias da uazapi (WhatsApp Web). É o comercial: gente
//           conversando pelo número dela.
//   · api → números da Cloud API da Meta. É onde rodam automações e IA; tem
//           janela de 24h e exige template fora dela.
//
// A CHAVE DE UM CANAL É O NÚMERO (só dígitos), porque é o número que as
// conversas guardam em `atendimentos.numero_instancia` — carimbado pelo webhook
// de cada lado. Id de instância não serviria: o número da Meta nem está numa
// tabela nossa.
//
// De onde vem cada lista:
//   · web → `instancias_uazapi` (o que foi cadastrado em Configurações), com o
//           estado e a foto que a uazapi informa em /instance/all.
//   · api → a própria Meta (WABAs → números), com cache de 10 minutos: é uma
//           cadeia de 3+ chamadas que muda quase nunca.
import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { soDigitos } from "@/lib/telefone";
import { fotoDoTelefoneMeta, telefonesMeta, wabasMeta } from "@/lib/meta";

export type TipoCanal = "web" | "api";
export type EstadoCanal = "conectado" | "conectando" | "desconectado" | "desconhecido";

export type CanalServidor = {
  chave: string;
  tipo: TipoCanal;
  /** O nome que demos ao canal (instância) ou o nome verificado na Meta. */
  nome: string;
  /** O nome do perfil no WhatsApp — o que o cliente vê. */
  perfil: string | null;
  numero: string;
  foto: string | null;
  estado: EstadoCanal;
  /** Só api: para enviar. */
  telefoneId?: string;
  wabaId?: string;
};

/** Os últimos 8 dígitos: é assim que o app inteiro casa número (lib/telefone.ts). */
export const fim8 = (numero: string | null | undefined) => soDigitos(numero ?? "").slice(-8);

// ── WhatsApp Web (uazapi) ───────────────────────────────────────────────────

type Remota = { id: string; status: string; owner: string; foto: string | null; perfil: string | null };

/**
 * Estado e foto de todas as instâncias numa chamada só. Cache de 60s: a tela
 * do chat recarrega a cada conversa aberta, e perguntar à uazapi a cada clique
 * é custo sem ganho — o estado de um número não muda de segundo em segundo.
 *
 * O que entra no cache é SÓ o que a tela mostra: /instance/all devolve o token
 * de cada instância, e segredo não vai para cache de dado.
 */
const remotasUazapi = unstable_cache(
  async (): Promise<Remota[]> => {
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
  },
  ["chat-uazapi-remotas-v1"],
  { revalidate: 60 },
);

const ESTADO_UAZAPI: Record<string, EstadoCanal> = {
  connected: "conectado",
  connecting: "conectando",
  hibernated: "conectando",
  disconnected: "desconectado",
};

async function canaisWeb(): Promise<CanalServidor[]> {
  const linhas = await sql`
    SELECT id, nome, numero, instancia_uazapi_id
    FROM instancias_uazapi
    WHERE tipo = 'web' AND numero IS NOT NULL AND numero <> ''
    ORDER BY data_criacao`;

  // Sem resposta da uazapi o canal continua na lista — as conversas dele estão
  // no nosso banco —, só que com estado "desconhecido" em vez de inventar verde.
  const remotas = await remotasUazapi().catch(() => null);

  return linhas.map((l) => {
    const numero = soDigitos(l.numero as string);
    const remota = remotas?.find(
      (r) =>
        (l.instancia_uazapi_id && r.id === l.instancia_uazapi_id) ||
        (r.owner && fim8(r.owner) === fim8(numero)),
    );
    return {
      chave: numero,
      tipo: "web" as const,
      nome: l.nome as string,
      perfil: remota?.perfil ?? null,
      numero,
      foto: remota?.foto ?? null,
      estado: remotas === null ? "desconhecido" : (ESTADO_UAZAPI[remota?.status ?? ""] ?? "desconectado"),
    };
  });
}

// ── API oficial (Meta) ──────────────────────────────────────────────────────

const canaisApiCache = unstable_cache(
  async (): Promise<CanalServidor[]> => {
    const lista: CanalServidor[] = [];
    for (const waba of await wabasMeta()) {
      for (const tel of await telefonesMeta(waba.id)) {
        const numero = soDigitos(tel.display_phone_number);
        if (!numero) continue;
        // A foto é enfeite: sem ela o canal aparece com as iniciais.
        const foto = await fotoDoTelefoneMeta(tel.id).catch(() => null);
        lista.push({
          chave: numero,
          tipo: "api",
          nome: tel.verified_name || waba.name,
          perfil: tel.verified_name || null,
          numero,
          foto,
          estado: "conectado",
          telefoneId: tel.id,
          wabaId: waba.id,
        });
      }
    }
    return lista;
  },
  ["chat-canais-api-v1"],
  { revalidate: 600 },
);

async function canaisApi(): Promise<CanalServidor[]> {
  if (!process.env.META_SYSTEM_USER_TOKEN?.trim()) return [];
  // A Meta fora do ar não pode derrubar o chat. A falha NÃO é cacheada (a
  // exceção sai de dentro do unstable_cache), então a próxima visita tenta de novo.
  return canaisApiCache().catch((e) => {
    console.error("[canais] não consegui listar os números da Meta:", e);
    return [];
  });
}

/** Todos os canais: comercial (web) primeiro, depois automações (api). */
export async function listarCanais(): Promise<CanalServidor[]> {
  const [web, api] = await Promise.all([canaisWeb(), canaisApi()]);
  // Um número pode estar nos dois lados só por engano de cadastro; aí vale o
  // da Meta, que é o que decide as regras de envio.
  const daApi = new Set(api.map((c) => fim8(c.chave)));
  return [...web.filter((c) => !daApi.has(fim8(c.chave))), ...api];
}

/** O número da Meta que corresponde a este canal — para enviar por ele. */
export async function canalOficial(numero: string | null): Promise<CanalServidor | null> {
  if (!numero) return null;
  const alvo = fim8(numero);
  return (await canaisApi()).find((c) => fim8(c.chave) === alvo) ?? null;
}

// ── Foto do contato ─────────────────────────────────────────────────────────

/**
 * A URL da foto de perfil de um número, pela uazapi (POST /chat/avatar).
 *
 * A Cloud API da Meta NÃO dá a foto de quem escreve — então mesmo contato do
 * canal de API é consultado por uma instância web. Primeiro a do canal da
 * conversa (`via`), depois as outras, até uma responder.
 *
 * Cache de 12h por número: a foto muda raramente, e perguntar por ela em cada
 * abertura de lista faria o número comercial consultar dezenas de perfis por
 * minuto — o tipo de padrão que o WhatsApp lê como robô. Falha não entra no
 * cache (a exceção atravessa o unstable_cache); "sem foto" entra, e é o certo.
 */
export async function urlDaFoto(numero: string, via: string | null): Promise<string | null> {
  const linhas = await sql`
    SELECT base_url, token, numero FROM instancias_uazapi
    WHERE tipo = 'web' AND numero IS NOT NULL
    ORDER BY data_criacao`;
  const alvo = via ? fim8(via) : "";
  const instancias = [...linhas].sort(
    (a, b) => Number(fim8(b.numero as string) === alvo) - Number(fim8(a.numero as string) === alvo),
  );
  if (instancias.length === 0) return null;

  const buscar = unstable_cache(
    async (n: string): Promise<string> => {
      for (const i of instancias.slice(0, 3)) {
        try {
          const r = await fetch(`${String(i.base_url).replace(/\/+$/, "")}/chat/avatar`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: i.token as string },
            body: JSON.stringify({ number: n, preview: true }),
            cache: "no-store",
            signal: AbortSignal.timeout(8_000),
          });
          if (!r.ok) continue;
          const j = (await r.json().catch(() => ({}))) as { url?: unknown };
          return typeof j.url === "string" ? j.url : "";
        } catch {
          // Instância fora do ar: tenta a próxima.
        }
      }
      throw new Error("nenhuma instância respondeu");
    },
    ["chat-foto-contato-v1"],
    { revalidate: 43_200, tags: [tagDaFoto(numero)] },
  );

  try {
    return (await buscar(numero)) || null;
  } catch {
    return null;
  }
}

export const tagDaFoto = (numero: string) => `chat-foto:${fim8(numero)}`;
