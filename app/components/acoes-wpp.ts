"use server";

// O estado dos números de WhatsApp, para o selo que fica colado na lateral.
//
// `exigirLogin` e não `exigirModulo("configuracoes")`: o selo aparece em TODAS
// as telas e responde a uma pergunta de quem usa o CRM o dia inteiro — "o
// WhatsApp está no ar?". Prendê-lo a Configurações esconderia a resposta
// justamente de quem atende.
//
// O que sai daqui é só o que o selo desenha: nome, número, foto e estado. Token
// e base_url ficam no servidor, como em todo o resto do módulo.
import { exigirLogin } from "@/lib/auth/dal";
import { sql } from "@/lib/db";

export type EstadoWpp = "disconnected" | "connecting" | "connected" | "hibernated";

export type WhatsAppNoSelo = {
  id: string;
  nome: string;
  numero: string | null;
  /** URL da foto de perfil na CDN do WhatsApp. Expira — ver o componente. */
  foto: string | null;
  perfil: string | null;
  estado: EstadoWpp;
};

type InstanciaRemota = {
  id?: string;
  status?: string;
  owner?: string;
  profilePicUrl?: string;
  profileName?: string;
};

/**
 * Uma chamada só para todos os números: `GET /instance/all`, com o admin token.
 *
 * Sem admin token no .env, cai para uma consulta POR instância
 * (`/instance/status`, com o token de cada uma). É mais caro, mas mantém o selo
 * funcionando em quem ainda não configurou o servidor — e a lista tem poucas
 * linhas por natureza.
 */
async function remotas(): Promise<InstanciaRemota[] | null> {
  const base = (process.env.UAZAPI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const admin = (process.env.UAZAPI_ADMIN_TOKEN ?? "").trim();
  if (!base || !admin) return null;

  try {
    const r = await fetch(`${base}/instance/all`, {
      headers: { admintoken: admin },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const dados = await r.json();
    return Array.isArray(dados) ? (dados as InstanciaRemota[]) : null;
  } catch {
    return null;
  }
}

async function uma(baseUrl: string, token: string): Promise<InstanciaRemota | null> {
  try {
    const r = await fetch(`${baseUrl}/instance/status`, {
      headers: { token },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const dados = (await r.json()) as { instance?: InstanciaRemota };
    return dados.instance ?? null;
  } catch {
    return null;
  }
}

/**
 * Os números cadastrados, com o estado de cada um.
 *
 * Falha em silêncio (lista vazia): o selo é acessório e aparece em todas as
 * telas — uazapi fora do ar não pode derrubar navegação nenhuma.
 */
export async function whatsappNoSelo(): Promise<WhatsAppNoSelo[]> {
  await exigirLogin();

  let linhas;
  try {
    linhas = await sql`
      SELECT id, nome, base_url, token, numero, instancia_uazapi_id
      FROM instancias_uazapi ORDER BY data_criacao`;
  } catch {
    return [];
  }

  const todas = await remotas();

  const saida: WhatsAppNoSelo[] = [];
  for (const l of linhas) {
    const remota = todas
      ? (todas.find(
          (r) =>
            (l.instancia_uazapi_id && r.id === l.instancia_uazapi_id) ||
            (!l.instancia_uazapi_id && l.numero && r.owner === l.numero),
        ) ?? null)
      : await uma(l.base_url as string, l.token as string);

    saida.push({
      id: l.id as string,
      nome: l.nome as string,
      numero: (remota?.owner as string | null) ?? ((l.numero as string | null) ?? null),
      foto: remota?.profilePicUrl?.trim() || null,
      perfil: remota?.profileName?.trim() || null,
      // Sem resposta da uazapi, o honesto é "desconectado": o selo existe para
      // avisar que o número caiu, e um número que não sabemos responder não
      // pode aparecer verde.
      estado: ((remota?.status as EstadoWpp | undefined) ?? "disconnected"),
    });
  }

  return saida;
}
