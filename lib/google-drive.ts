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

async function token() {
  return tokenDeAcesso(ESCOPO_DRIVE);
}

/** Erro com o motivo para quem pediu (o modelo, no conector). */
export class ErroDrive extends Error {}

const SEM_ACESSO = (id: string) =>
  `O CRM não enxerga o arquivo ${id} no Drive. No Drive compartilhado, adicione ${process.env.GOOGLE_SA_EMAIL ?? "a conta de serviço do CRM"} como membro (Gerenciar membros → Leitor).`;

/** Nome, tipo e tamanho — sem baixar o arquivo. */
export async function arquivoDoDrive(id: string): Promise<ArquivoDrive> {
  const res = await fetch(`${API}/${encodeURIComponent(id)}?fields=id,name,mimeType,size&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404 || res.status === 403) throw new ErroDrive(SEM_ACESSO(id));
  if (!res.ok) throw new ErroDrive(`O Drive respondeu ${res.status} para o arquivo ${id}.`);
  const j = (await res.json()) as { id: string; name: string; mimeType: string; size?: string };
  return { id: j.id, nome: j.name, mime: j.mimeType, tamanho: Number(j.size ?? 0) };
}

/** Os bytes do arquivo, direto do Drive (a resposta é o arquivo inteiro). */
export async function baixarDoDrive(id: string): Promise<Response> {
  const res = await fetch(`${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(180_000),
  });
  if (res.status === 404 || res.status === 403) throw new ErroDrive(SEM_ACESSO(id));
  if (!res.ok) throw new ErroDrive(`O Drive não entregou o arquivo ${id} (${res.status}).`);
  return res;
}
