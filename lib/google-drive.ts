// O Google Drive pela conta de serviço do CRM (lib/google-sa.ts) — o mesmo
// par GOOGLE_SA_EMAIL/GOOGLE_SA_PRIVATE_KEY do Search Console, agora com o
// escopo de leitura do Drive.
//
// A conta só enxerga o que foi compartilhado com ela: nos Drives
// compartilhados, ela precisa ser MEMBRO (Gerenciar membros → Leitor);
// compartilhar uma pasta de dentro não basta. Pedido dele, 2026-10-16: postar
// nas redes direto do Drive "1. Marketing", sem guardar cópia no CRM.
import "server-only";
import { tokenDeAcesso } from "@/lib/google-sa";

const ESCOPO_DRIVE = "https://www.googleapis.com/auth/drive.readonly";
const API = "https://www.googleapis.com/drive/v3/files";

/** Id de arquivo do Drive: o que vem depois de /d/ ou em ?id= nos links. */
const ID = /^[A-Za-z0-9_-]{20,}$/;

/**
 * O id do arquivo, a partir de "drive:<id>" ou de um link do Drive/Docs
 * (…/file/d/<id>/view, open?id=<id>, uc?id=<id>). null = não é do Drive.
 */
export function idDoDrive(texto: string): string | null {
  const t = texto.trim();
  if (t.startsWith("drive:")) return ID.test(t.slice(6)) ? t.slice(6) : null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (!/(^|\.)(drive|docs)\.google\.com$/i.test(url.hostname)) return null;
  const doCaminho = url.pathname.match(/\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  const daBusca = url.searchParams.get("id");
  const id = doCaminho ?? daBusca;
  return id && ID.test(id) ? id : null;
}

export type ArquivoDrive = { id: string; nome: string; mime: string; tamanho: number };

/** Erro com o motivo para quem pediu (o modelo, no conector). */
export class ErroDrive extends Error {}

const conta = () => process.env.GOOGLE_SA_EMAIL ?? "a conta de serviço do CRM";

// Sem isso, a falha ao entrar no Google chegava ao conector como "Erro no CRM"
// e o modelo chutava a causa (2026-10-16). Agora o erro diz o que falhou.
async function token() {
  try {
    return await tokenDeAcesso(ESCOPO_DRIVE);
  } catch (e) {
    console.error("[drive] token:", e);
    const faltam = ["GOOGLE_SA_EMAIL", "GOOGLE_SA_PRIVATE_KEY"].filter((v) => !process.env[v]);
    throw new ErroDrive(
      faltam.length
        ? `O servidor do CRM está sem a conta de serviço do Google: falta ${faltam.join(" e ")} nas variáveis do servidor (Vercel).`
        : `O Google recusou a conta de serviço ${conta()} (${e instanceof Error ? e.message : String(e)}). Confira GOOGLE_SA_EMAIL e GOOGLE_SA_PRIVATE_KEY nas variáveis do servidor (Vercel).`,
    );
  }
}

/** Os Drives compartilhados de que a conta é membro — só para explicar a recusa. */
async function drivesDaConta(): Promise<string> {
  try {
    const res = await fetch("https://www.googleapis.com/drive/v3/drives?pageSize=50&fields=drives(name)", {
      headers: { Authorization: `Bearer ${await token()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const nomes = ((await res.json()) as { drives?: { name: string }[] }).drives?.map((d) => `"${d.name}"`) ?? [];
    return nomes.length ? `Hoje ela é membro de: ${nomes.join(", ")}.` : "Hoje ela não é membro de nenhum Drive compartilhado.";
  } catch {
    return "";
  }
}

/** A recusa do Drive traduzida pelo motivo que o Google manda no corpo. */
async function recusa(res: Response, id: string): Promise<never> {
  const corpo = (await res.json().catch(() => null)) as {
    error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] };
  } | null;
  const motivo = corpo?.error?.errors?.[0]?.reason ?? corpo?.error?.details?.find((d) => d.reason)?.reason;
  console.error(`[drive] ${id}: ${res.status} ${motivo ?? ""} ${corpo?.error?.message ?? ""}`);
  if (motivo === "accessNotConfigured" || motivo === "SERVICE_DISABLED") {
    throw new ErroDrive(`A API do Google Drive está desligada no projeto da conta ${conta()} (Google Cloud → APIs e serviços → Google Drive API → Ativar).`);
  }
  if (res.status === 404 || res.status === 403) {
    throw new ErroDrive(
      `A conta ${conta()} não enxerga o arquivo ${id}: ele não está num Drive compartilhado de que ela seja membro (arquivo do "Meu Drive" de uma pessoa não serve). ` +
        `${await drivesDaConta()} Mova o arquivo para um deles ou adicione a conta como membro do Drive dele (Gerenciar membros → Leitor).`,
    );
  }
  throw new ErroDrive(`O Drive respondeu ${res.status} para o arquivo ${id}${corpo?.error?.message ? `: ${corpo.error.message}` : ""}.`);
}

const ATALHO = "application/vnd.google-apps.shortcut";

/** Nome, tipo e tamanho — sem baixar o arquivo. Atalho do Drive vira o arquivo para onde aponta. */
export async function arquivoDoDrive(id: string, saltos = 0): Promise<ArquivoDrive> {
  const res = await fetch(
    `${API}/${encodeURIComponent(id)}?fields=id,name,mimeType,size,shortcutDetails(targetId)&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${await token()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) return recusa(res, id);
  const j = (await res.json()) as { id: string; name: string; mimeType: string; size?: string; shortcutDetails?: { targetId?: string } };
  if (j.mimeType === ATALHO && j.shortcutDetails?.targetId && saltos === 0) return arquivoDoDrive(j.shortcutDetails.targetId, 1);
  return { id: j.id, nome: j.name, mime: j.mimeType, tamanho: Number(j.size ?? 0) };
}

/** Os bytes do arquivo, direto do Drive (a resposta é o arquivo inteiro). */
export async function baixarDoDrive(id: string): Promise<Response> {
  const res = await fetch(`${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) return recusa(res, id);
  return res;
}

// ── Pastas e Docs (as gravações do Meet, lib/gravacoes.ts) ──────────────────

export type ItemDaPasta = { id: string; nome: string; mime: string; criado: string; duracaoMs: number | null };

/** Tudo o que está direto numa pasta (sem descer nas subpastas), página a página. */
export async function listarPasta(pastaId: string): Promise<ItemDaPasta[]> {
  const itens: ItemDaPasta[] = [];
  let pagina: string | undefined;
  do {
    const busca = new URLSearchParams({
      q: `'${pastaId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,createdTime,videoMediaMetadata(durationMillis))",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pagina) busca.set("pageToken", pagina);
    const res = await fetch(`${API}?${busca}`, {
      headers: { Authorization: `Bearer ${await token()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return recusa(res, pastaId);
    const j = (await res.json()) as {
      nextPageToken?: string;
      files: { id: string; name: string; mimeType: string; createdTime: string; videoMediaMetadata?: { durationMillis?: string } }[];
    };
    for (const f of j.files) {
      const ms = Number(f.videoMediaMetadata?.durationMillis ?? 0);
      itens.push({ id: f.id, nome: f.name, mime: f.mimeType, criado: f.createdTime, duracaoMs: ms > 0 ? ms : null });
    }
    pagina = j.nextPageToken;
  } while (pagina);
  return itens;
}

/** Um Google Doc como texto: em markdown (títulos, listas, negrito); se o Google recusar, texto puro. */
export async function exportarDoc(id: string): Promise<string> {
  for (const formato of ["text/markdown", "text/plain"]) {
    const res = await fetch(`${API}/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(formato)}`, {
      headers: { Authorization: `Bearer ${await token()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return res.text();
    if (formato === "text/plain" || (res.status !== 400 && res.status !== 415)) return recusa(res, id);
  }
  return "";
}
