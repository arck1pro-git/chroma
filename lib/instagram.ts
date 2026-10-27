// O Instagram das três contas do CRM (lib/social/perfis.ts) na Graph API: as
// contas, as postagens, os comentários lidos na Meta, o perfil de quem escreve
// e o PONTO ÚNICO de envio (direct, direct a partir de comentário, resposta
// pública). Desde 2026-10-26 (canal de Instagram no /chat).
//
// ENDPOINTS (Meta for Developers, Instagram Platform / Instagram API with
// Facebook Login; conferidos na documentação em 2026-10-26):
//   · direct por texto        POST /{page-id}/messages  {recipient:{id:IGSID}, message:{text}}
//                              com o token DA PÁGINA → {recipient_id, message_id}
//                              (…/instagram-api-with-facebook-login/messaging-api)
//   · direct do comentário    POST /{page-id}/messages  {recipient:{comment_id}, message:{text}}
//     (private reply)          → {recipient_id, message_id}; um por comentário, até 7 dias
//                              (…/instagram-platform/private-replies)
//   · resposta pública        POST /{ig-comment-id}/replies  {message} → {id}
//                              (…/instagram-platform/comment-moderation)
//   · postagens               GET /{ig-user-id}/media?fields=… (…/reference/instagram-user/media)
//   · comentários             GET /{ig-media-id}/comments?fields=… (…/reference/instagram-media/comments)
//   · perfil de quem escreve  GET /{IGSID}?fields=name,username com o token da página
//                              (…/messaging-api/user-profile)
// O texto vai sempre no CORPO do POST (JSON), nunca na query string.
//
// TRAVAS (revisão de segurança, 2026-10-26):
//   · todo id da Meta passa por /^\d+$/ e a conta tem de estar em PERFIS;
//   · o token da página só sai para página de PERFIS (tokenDaPaginaDoPerfil);
//   · FORA DA PRODUÇÃO (VERCEL_ENV ≠ 'production') nada sai para o Instagram,
//     salvo direct para os IGSIDs de INSTAGRAM_SO_PARA; resposta PÚBLICA, nunca.
//     Sem a variável, o dev não envia nada. É o par de WHATSAPP_SO_PARA, e
//     nunca vai para a Vercel.
import "server-only";
import { ErroMeta, lembrar, listarMeta, MINUTO, requisicao, type Validade } from "@/lib/meta";
import { PERFIS, type Perfil } from "@/lib/social/perfis";
import { tokenDaPaginaDoPerfil } from "@/lib/social/meta-publicar";
import { urlExternaSegura } from "@/lib/rede-externa";
import type { ContaInstagram, PostagemInstagram } from "@/lib/instagram-tipos";

// ── Ids e contas ────────────────────────────────────────────────────────────

/** Id da Meta: só dígitos. Tudo que vem de fora (webhook, URL, tela) passa por aqui. */
export function ehIdMeta(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{1,32}$/.test(valor);
}

/** O perfil da conta do Instagram, só se for uma das nossas. */
export function perfilDaConta(contaId: unknown): Perfil | null {
  if (!ehIdMeta(contaId)) return null;
  return PERFIS.find((p) => p.instagramId === contaId) ?? null;
}

/** O id é de uma das contas do CRM (qualquer uma das três)? */
export const ehContaNossa = (id: unknown): boolean => perfilDaConta(id) !== null;

export function contaDoPerfil(p: Perfil): ContaInstagram {
  return { id: p.instagramId, usuario: p.instagram, nome: p.nome, paginaId: p.paginaId };
}

/** O @ do Instagram, sem a arroba, só se tiver a forma de um (letras, números, ponto, _). */
export function usuarioValido(bruto: unknown): string | null {
  const u = typeof bruto === "string" ? bruto.trim().replace(/^@/, "") : "";
  return /^[A-Za-z0-9._]{1,30}$/.test(u) ? u : null;
}

/** O nome do contato que nasce de uma DM antes de o perfil dele chegar. */
export const NOME_PROVISORIO = "Contato do Instagram";

/**
 * Link, inclusive disfarçado, em texto escrito por quem comenta ou pelo modelo.
 * Além de http e www, QUALQUER domínio colado ("golpe.xyz", "bit.ly"), espaço
 * ANTES do ponto ("site .com", "site . com") e espaço só depois do ponto com
 * terminação que não é palavra do português ("site. net"). Espaço só depois do
 * ponto com "com", "me", "co" ficou de fora de propósito: "Gostei. Com certeza"
 * e "aqui. Me conta" são fim de frase, e casar isso calaria a IA em quase todo
 * comentário (revisão de segurança, 2026-10-26).
 */
const LINK =
  /(https?:\/\/|www\.|[\p{L}\p{N}-]+\.\p{L}{2,}|[\p{L}\p{N}-]+\s+\.\s*\p{L}{2,}|[\p{L}\p{N}-]+\.\s+(net|org|br|io|ly|xyz|online|store|shop|top|club|vip|biz|info)(?![\p{L}\p{N}]))/iu;

export const temLink = (texto: string): boolean => LINK.test(texto);

/**
 * O motivo de um erro para o log e para a coluna `erro`: só a mensagem, curta.
 * Nunca o objeto inteiro (pode carregar o pedido, com texto e IGSID de cliente).
 */
export const motivoDoErro = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);

// ── Trava de desenvolvimento ────────────────────────────────────────────────

/**
 * Fora da produção, só para os IGSIDs de INSTAGRAM_SO_PARA (lista separada
 * por vírgula). Lida aqui dentro, a cada envio, como as outras variáveis.
 *
 * RESPOSTA PÚBLICA, NUNCA fora da produção (revisão de segurança, 2026-10-26):
 * DEV e produção usam as MESMAS contas reais, e um comentário em público é
 * visto por todo mundo, não só pela pessoa liberada.
 */
export function conferirDestinoInstagram(igsid: string | null, publico = false): void {
  if (process.env.VERCEL_ENV === "production") return;
  if (publico) throw new Error("Envio público ao Instagram bloqueado neste ambiente: fora da produção, nada sai em público.");
  const lista = (process.env.INSTAGRAM_SO_PARA ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (igsid && lista.includes(igsid)) return;
  throw new Error("Envio ao Instagram bloqueado neste ambiente: o destinatário não está em INSTAGRAM_SO_PARA.");
}

// ── Envio: o ponto único ────────────────────────────────────────────────────

type Envio =
  | { tipo: "direct"; perfil: Perfil; igsid: string; texto: string }
  | { tipo: "direct_do_comentario"; perfil: Perfil; comentarioId: string; autorId: string; texto: string }
  | { tipo: "publico"; perfil: Perfil; comentarioId: string; autorId: string; texto: string };

export type Enviado = { id: string; recipientId: string | null };

/**
 * TODO envio ao Instagram passa por aqui: confere a conta, os ids e a trava
 * do dev antes de pedir token ou falar com a Meta.
 */
async function enviarAoInstagram(e: Envio): Promise<Enviado> {
  // A página e a conta saem da lista fechada, não do objeto recebido.
  const perfil = perfilDaConta(e.perfil.instagramId);
  if (!perfil || perfil.paginaId !== e.perfil.paginaId) throw new Error("Conta do Instagram fora das contas do CRM.");
  const texto = e.texto.trim();
  if (!texto) throw new Error("Mensagem vazia.");
  const destino = e.tipo === "direct" ? e.igsid : e.autorId;
  if (!ehIdMeta(destino)) throw new Error("Destinatário do Instagram inválido.");
  if (e.tipo !== "direct" && !ehIdMeta(e.comentarioId)) throw new Error("Comentário do Instagram inválido.");
  conferirDestinoInstagram(destino, e.tipo === "publico");

  switch (e.tipo) {
    case "direct":
    case "direct_do_comentario": {
      const token = await tokenDaPaginaDoPerfil(perfil.paginaId);
      const r = await requisicao<{ recipient_id?: string; message_id?: string }>(`${perfil.paginaId}/messages`, {
        method: "POST",
        accessToken: token,
        body: {
          recipient: e.tipo === "direct" ? { id: e.igsid } : { comment_id: e.comentarioId },
          message: { text: texto },
        },
      });
      if (!r.message_id) throw new ErroMeta("A Meta não devolveu o id da mensagem.");
      return { id: r.message_id, recipientId: ehIdMeta(r.recipient_id) ? r.recipient_id : null };
    }
    case "publico": {
      const r = await requisicao<{ id?: string }>(`${e.comentarioId}/replies`, {
        method: "POST",
        body: { message: texto },
      });
      if (!ehIdMeta(r.id)) throw new ErroMeta("A Meta não devolveu o id da resposta.");
      return { id: r.id, recipientId: null };
    }
  }
}

/** Direct por texto para quem já escreveu (janela de 24 h conferida por quem chama). */
export function enviarDirect(perfil: Perfil, igsid: string, texto: string) {
  return enviarAoInstagram({ tipo: "direct", perfil, igsid, texto });
}

/** Direct a partir de um comentário (private reply). `autorId` é quem comentou: é a ele que a trava confere. */
export function enviarDirectDoComentario(perfil: Perfil, comentarioId: string, autorId: string, texto: string) {
  return enviarAoInstagram({ tipo: "direct_do_comentario", perfil, comentarioId, autorId, texto });
}

/** Resposta pública a um comentário (sempre ao comentário raiz: o Instagram só tem um nível). */
export function responderEmPublico(perfil: Perfil, comentarioId: string, autorId: string, texto: string) {
  return enviarAoInstagram({ tipo: "publico", perfil, comentarioId, autorId, texto });
}

// ── Leituras ────────────────────────────────────────────────────────────────

/** As postagens mudam quando alguém posta: dois minutos frescas, quinze no máximo. */
const VALIDADE_POSTAGENS: Validade = { fresco: 2 * MINUTO, velho: 15 * MINUTO };
const VALIDADE_CONTA: Validade = { fresco: 10 * MINUTO, velho: 60 * MINUTO };

type MidiaBruta = {
  id: string;
  caption?: string;
  media_type?: string;
  thumbnail_url?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  comments_count?: number;
};

/** "2026-10-26T12:00:00+0000" → ISO que todo navegador lê. */
export function isoDaMeta(bruto: string | undefined): string | null {
  if (!bruto) return null;
  const d = new Date(bruto.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** As postagens recentes da conta (sem os não lidos, que são do banco). */
export async function postagensDaConta(perfil: Perfil, forcar = false): Promise<PostagemInstagram[]> {
  const { valor } = await lembrar(
    `instagram/${perfil.instagramId}/media`,
    VALIDADE_POSTAGENS,
    async () => {
      const r = await requisicao<{ data?: MidiaBruta[] }>(`${perfil.instagramId}/media`, {
        params: {
          fields: "id,caption,media_type,thumbnail_url,media_url,permalink,timestamp,comments_count",
          limit: "30",
        },
      });
      return (r.data ?? [])
        .filter((m) => ehIdMeta(m.id))
        .map(
          (m): PostagemInstagram => ({
            id: m.id,
            legenda: (m.caption ?? "").slice(0, 2200),
            tipo: m.media_type ?? "",
            // Vídeo: media_url é o mp4; a miniatura é a capa.
            miniatura: m.media_type === "VIDEO" ? (m.thumbnail_url ?? null) : (m.media_url ?? m.thumbnail_url ?? null),
            link: m.permalink ?? "",
            quando: isoDaMeta(m.timestamp) ?? "",
            comentarios: Number(m.comments_count ?? 0),
            naoLidos: 0,
          }),
        );
    },
    forcar,
  );
  return valor;
}

/**
 * A postagem é desta conta? Primeiro pela lista recente (sem ida extra à
 * Meta); fora dela, pelo dono da mídia. Na dúvida, não.
 */
export async function midiaEhDaConta(perfil: Perfil, midiaId: string): Promise<boolean> {
  if (!ehIdMeta(midiaId)) return false;
  const recentes = await postagensDaConta(perfil).catch(() => []);
  if (recentes.some((p) => p.id === midiaId)) return true;
  try {
    const r = await requisicao<{ owner?: { id?: string } }>(midiaId, { params: { fields: "owner{id}" } });
    return r.owner?.id === perfil.instagramId;
  } catch {
    return false;
  }
}

/** A legenda da postagem, para a IA de comentário. Sem ela, vazio. */
export async function legendaDaPostagem(perfil: Perfil, midiaId: string): Promise<string> {
  const recentes = await postagensDaConta(perfil).catch(() => []);
  const achada = recentes.find((p) => p.id === midiaId);
  if (achada) return achada.legenda;
  try {
    const r = await requisicao<{ caption?: string }>(midiaId, { params: { fields: "caption" } });
    return (r.caption ?? "").slice(0, 2200);
  } catch {
    return "";
  }
}

/** Comentário mais velho que isto é gravado e não respondido pela IA (evento atrasado, reenvio da Meta). */
export const COMENTARIO_RECENTE_MS = 10 * 60_000;

export type ComentarioDaMeta = {
  id: string;
  texto: string;
  quando: string | null;
  autorId: string | null;
  autorUsuario: string | null;
  paiId: string | null;
  oculto: boolean;
};

type ComentarioBruto = {
  id?: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: { id?: string; username?: string };
  parent_id?: string;
  hidden?: boolean;
  replies?: { data?: ComentarioBruto[]; paging?: { next?: string; cursors?: { after?: string } } };
};

function doBruto(c: ComentarioBruto, pai: string | null): ComentarioDaMeta | null {
  if (!ehIdMeta(c.id)) return null;
  const autorId = c.from?.id;
  return {
    id: c.id,
    texto: (c.text ?? "").slice(0, 2200),
    quando: isoDaMeta(c.timestamp),
    autorId: ehIdMeta(autorId) ? autorId : null,
    autorUsuario: usuarioValido(c.from?.username ?? c.username),
    paiId: ehIdMeta(c.parent_id) ? c.parent_id : pai,
    oculto: c.hidden === true,
  };
}

/** Os comentários recentes da postagem na Meta (os de cima e as respostas), para o "Buscar comentários". */
export async function comentariosDaPostagem(midiaId: string): Promise<ComentarioDaMeta[]> {
  if (!ehIdMeta(midiaId)) throw new ErroMeta("Postagem inválida.", undefined, 400);
  const campos = "id,text,timestamp,username,from{id,username},parent_id,hidden";
  const raizes = await listarMeta<ComentarioBruto>(`${midiaId}/comments`, { fields: `${campos},replies{${campos}}`, limit: "50" });
  const lista: ComentarioDaMeta[] = [];
  for (const c of raizes) {
    const raiz = doBruto(c, null);
    if (!raiz) continue;
    lista.push(raiz);
    const respostas = [...(c.replies?.data ?? [])];
    if (c.replies?.paging?.next) {
      const after = c.replies.paging.cursors?.after;
      if (!after) throw new ErroMeta("A Meta não devolveu o cursor das respostas.");
      respostas.push(...await listarMeta<ComentarioBruto>(`${raiz.id}/replies`, { fields: campos, limit: "50", after }));
    }
    for (const resposta of respostas) {
      const filho = doBruto(resposta, raiz.id);
      if (filho) lista.push(filho);
    }
  }
  return [...new Map(lista.map((c) => [c.id, c])).values()];
}

/** Um comentário como a Meta o vê agora: é o que diz se ele está oculto antes de a IA responder. */
export async function lerComentario(comentarioId: string): Promise<ComentarioDaMeta | null> {
  if (!ehIdMeta(comentarioId)) return null;
  const r = await requisicao<ComentarioBruto>(comentarioId, {
    params: { fields: "id,text,timestamp,username,from{id,username},parent_id,hidden" },
  });
  return doBruto(r, null);
}

/** Nome e @ de quem escreveu no direct (perfil do usuário, com o token da página). */
export async function perfilDoUsuario(
  perfil: Perfil,
  igsid: string,
): Promise<{ nome: string | null; usuario: string | null }> {
  if (!ehIdMeta(igsid)) return { nome: null, usuario: null };
  const token = await tokenDaPaginaDoPerfil(perfil.paginaId);
  const r = await requisicao<{ name?: string; username?: string }>(igsid, {
    accessToken: token,
    params: { fields: "name,username" },
  });
  const nome = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 120) : null;
  return { nome, usuario: usuarioValido(r.username) };
}

/**
 * A foto de perfil da conta, para o trilho de canais. null = a Meta não respondeu.
 * É enfeite: espera no máximo 3 s (o render do /chat não pode esperar a Meta) e a
 * falha também fica guardada, para não virar uma ida à Graph a cada render.
 */
export async function fotoDaConta(perfil: Perfil): Promise<{ foto: string | null } | null> {
  if (!process.env.META_SYSTEM_USER_TOKEN?.trim()) return null;
  try {
    const { valor } = await lembrar(`instagram/${perfil.instagramId}/perfil`, VALIDADE_CONTA, async () => {
      try {
        const r = await Promise.race([
          requisicao<{ profile_picture_url?: string }>(perfil.instagramId, { params: { fields: "profile_picture_url" } }),
          new Promise<null>((ok) => setTimeout(() => ok(null), 3_000)),
        ]);
        return { foto: r?.profile_picture_url || null };
      } catch (e) {
        console.error("[instagram] não consegui ler a foto da conta", perfil.instagramId, motivoDoErro(e));
        return { foto: null };
      }
    });
    return valor;
  } catch (e) {
    console.error("[instagram] não consegui ler a conta", perfil.instagramId, motivoDoErro(e));
    return null;
  }
}

// ── Anexo recebido no direct ────────────────────────────────────────────────
//
// O anexo do direct chega como URL da Meta (lookaside.fbsbx.com, que redireciona
// para a CDN). Baixado só de hosts da Meta, com cada redirecionamento conferido
// de novo, endereço público (lib/rede-externa.ts) e teto de tamanho. O que não
// é imagem, vídeo ou áudio nem entra na fila (vira "[anexo do Instagram]").

const HOSTS_DE_ANEXO = [/^lookaside\.fbsbx\.com$/i, /(^|\.)fbcdn\.net$/i, /(^|\.)cdninstagram\.com$/i];

/** A URL é https e de um host da Meta que serve anexo do Instagram? */
export function hostDeAnexoPermitido(bruto: string): boolean {
  try {
    const u = new URL(bruto);
    return u.protocol === "https:" && !u.username && !u.password && HOSTS_DE_ANEXO.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

async function lerComTeto(res: Response, teto: number): Promise<Uint8Array> {
  const leitor = res.body?.getReader();
  if (!leitor) return new Uint8Array();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel();
      throw new Error("anexo do Instagram acima do teto");
    }
    partes.push(value);
  }
  const bytes = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    bytes.set(p, i);
    i += p.byteLength;
  }
  return bytes;
}

/** Os bytes de um anexo do direct ('ig:<url>' em mensagens.midia_url_origem). */
export async function baixarAnexoInstagram(bruto: string, teto: number): Promise<{ bytes: Uint8Array; mime: string | null }> {
  let alvo = bruto;
  for (let salto = 0; salto < 4; salto++) {
    // O host antes do DNS: endereço de fora da Meta nem é consultado.
    if (!hostDeAnexoPermitido(alvo)) throw new Error("anexo do Instagram fora dos endereços da Meta");
    const url = await urlExternaSegura(alvo);
    const res = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get("location");
      if (!destino) throw new Error("o Instagram redirecionou sem destino");
      alvo = new URL(destino, url).href;
      continue;
    }
    if (!res.ok) throw new Error(`o Instagram respondeu ${res.status}`);
    const mime = res.headers.get("content-type");
    if (!/^(image|video|audio)\//i.test(mime ?? "")) throw new Error("anexo do Instagram de tipo não aceito");
    if (Number(res.headers.get("content-length") ?? 0) > teto) throw new Error("anexo do Instagram acima do teto");
    return { bytes: await lerComTeto(res, teto), mime };
  }
  throw new Error("o Instagram redirecionou vezes demais");
}
