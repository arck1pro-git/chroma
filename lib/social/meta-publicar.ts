// As chamadas de publicação na Meta (Graph API), uma por rede e por tipo.
//
// INSTAGRAM publica em dois passos: cria o "contêiner" com o link da mídia, a
// Meta baixa e processa (vídeo leva de segundos a minutos), e só então
// media_publish põe no ar. O id do contêiner é salvo assim que nasce
// (`salvar`): se a função cair no meio do processamento, a próxima rodada
// retoma do contêiner em vez de criar outro — e publicar o mesmo contêiner
// duas vezes a Meta recusa, então retomar não duplica post.
//
// FACEBOOK publica numa chamada só, com o token DA PÁGINA (tirado do token do
// system user). Antes dela grava `iniciado`: se a função cair depois da chamada
// e antes de guardar o id, não há como saber se o post saiu, e a rodada
// seguinte marca erro em vez de arriscar um post duplicado na página.
import "server-only";
import { ErroMeta } from "@/lib/meta";
import type { Perfil } from "./perfis";

const VERSAO = process.env.META_GRAPH_VERSION?.trim() || "v26.0";

export type TipoPost = "reels" | "story" | "feed" | "carrossel";
export type MidiaParaPublicar = { url: string; tipo: "imagem" | "video" };
export type PostParaPublicar = {
  tipo: TipoPost;
  legenda: string;
  midias: MidiaParaPublicar[];
  capaUrl: string | null;
  primeiroComentario: string | null;
};
export type Publicado = { id: string; link: string | null; aviso?: string };
/** Grava o progresso da rede no post (resultado.<rede>), antes do passo seguinte. */
export type Salvar = (parcial: Record<string, unknown>) => Promise<void>;

/** O vídeo do Instagram ainda processava quando o tempo da rodada acabou. */
export class AindaProcessando extends Error {}

function tokenDoSistema(): string {
  const t = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (!t) throw new ErroMeta("META_SYSTEM_USER_TOKEN não configurado.", undefined, 503);
  return t;
}

async function graph<T>(
  caminho: string,
  opcoes: { metodo?: "GET" | "POST"; corpo?: Record<string, unknown>; token: string; host?: string; campos?: string },
): Promise<T> {
  const url = new URL(`https://${opcoes.host ?? "graph.facebook.com"}/${VERSAO}/${caminho.replace(/^\//, "")}`);
  if (opcoes.campos) url.searchParams.set("fields", opcoes.campos);
  const res = await fetch(url, {
    method: opcoes.metodo ?? "GET",
    headers: {
      Authorization: `Bearer ${opcoes.token}`,
      ...(opcoes.corpo ? { "Content-Type": "application/json" } : {}),
    },
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
    cache: "no-store",
    // Publicar vídeo no Facebook pode demorar a responder: a Meta baixa o
    // arquivo antes de devolver o id.
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_user_msg?: string; error_user_title?: string } } & T;
  if (!res.ok || json.error) {
    const e = json.error;
    const mensagem = [e?.error_user_title, e?.error_user_msg || e?.message].filter(Boolean).join(": ") || `Meta respondeu ${res.status}.`;
    throw new ErroMeta(mensagem, e?.code, res.status >= 500 ? 502 : res.status);
  }
  return json;
}

// O token da página vale enquanto o do system user valer; guardado por meia
// hora para não pedir de novo a cada post da mesma rodada.
const tokensDePagina = new Map<string, { token: string; ate: number }>();

async function tokenDaPagina(paginaId: string): Promise<string> {
  const guardado = tokensDePagina.get(paginaId);
  if (guardado && guardado.ate > Date.now()) return guardado.token;
  const r = await graph<{ access_token?: string }>(paginaId, { token: tokenDoSistema(), campos: "access_token" });
  if (!r.access_token) throw new ErroMeta(`O token não tem acesso de publicação à página ${paginaId}.`);
  tokensDePagina.set(paginaId, { token: r.access_token, ate: Date.now() + 30 * 60_000 });
  return r.access_token;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Instagram ───────────────────────────────────────────────────────────────

async function criarConteiner(igId: string, token: string, corpo: Record<string, unknown>): Promise<string> {
  return (await graph<{ id: string }>(`${igId}/media`, { metodo: "POST", token, corpo })).id;
}

/** Espera a Meta terminar de processar. `ate` é o relógio da rodada inteira. */
async function esperarConteiner(id: string, token: string, ate: number): Promise<void> {
  for (;;) {
    const r = await graph<{ status_code?: string; status?: string }>(id, { token, campos: "status_code,status" });
    if (r.status_code === "FINISHED" || r.status_code === "PUBLISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") {
      throw new ErroMeta(`O Instagram recusou a mídia (${r.status_code}): ${r.status ?? "sem detalhe"}`);
    }
    if (Date.now() + 5_000 > ate) throw new AindaProcessando(`contêiner ${id} ainda em ${r.status_code ?? "processamento"}`);
    await esperar(4_000);
  }
}

export async function publicarNoInstagram(
  perfil: Perfil,
  post: PostParaPublicar,
  progresso: { conteiner?: string },
  salvar: Salvar,
  ate: number,
): Promise<Publicado> {
  const token = tokenDoSistema();
  const ig = perfil.instagramId;
  let conteiner = progresso.conteiner;

  if (!conteiner) {
    const [m] = post.midias;
    const daMidia = (x: MidiaParaPublicar) => (x.tipo === "video" ? { video_url: x.url } : { image_url: x.url });
    if (post.tipo === "feed") {
      conteiner = await criarConteiner(ig, token, { image_url: m.url, caption: post.legenda });
    } else if (post.tipo === "reels") {
      conteiner = await criarConteiner(ig, token, {
        media_type: "REELS",
        video_url: m.url,
        caption: post.legenda,
        share_to_feed: true,
        ...(post.capaUrl ? { cover_url: post.capaUrl } : {}),
      });
    } else if (post.tipo === "story") {
      conteiner = await criarConteiner(ig, token, { media_type: "STORIES", ...daMidia(m) });
    } else {
      // Carrossel: um contêiner por item, cada um pronto antes do contêiner pai.
      const filhos: string[] = [];
      for (const x of post.midias) {
        const filho = await criarConteiner(ig, token, {
          is_carousel_item: true,
          ...(x.tipo === "video" ? { media_type: "VIDEO", video_url: x.url } : { image_url: x.url }),
        });
        if (x.tipo === "video") await esperarConteiner(filho, token, ate);
        filhos.push(filho);
      }
      conteiner = await criarConteiner(ig, token, { media_type: "CAROUSEL", children: filhos.join(","), caption: post.legenda });
    }
    await salvar({ conteiner });
  }

  await esperarConteiner(conteiner, token, ate);
  const { id } = await graph<{ id: string }>(`${ig}/media_publish`, { metodo: "POST", token, corpo: { creation_id: conteiner } });
  await salvar({ id });

  const link = await graph<{ permalink?: string }>(id, { token, campos: "permalink" })
    .then((r) => r.permalink ?? null)
    .catch(() => null);

  let aviso: string | undefined;
  if (post.primeiroComentario && post.tipo !== "story") {
    await graph(`${id}/comments`, { metodo: "POST", token, corpo: { message: post.primeiroComentario } }).catch((e) => {
      aviso = `Publicado, mas o primeiro comentário falhou: ${e instanceof Error ? e.message : String(e)}`;
    });
  }
  return { id, link, aviso };
}

// ── Facebook ────────────────────────────────────────────────────────────────

/** Foto subida sem aparecer na página: vira item de carrossel ou de story. */
async function fotoNaoPublicada(paginaId: string, token: string, url: string): Promise<string> {
  return (await graph<{ id: string }>(`${paginaId}/photos`, { metodo: "POST", token, corpo: { url, published: false } })).id;
}

async function storyDeVideo(paginaId: string, token: string, url: string): Promise<string | null> {
  const inicio = await graph<{ video_id: string; upload_url: string }>(`${paginaId}/video_stories`, {
    metodo: "POST",
    token,
    corpo: { upload_phase: "start" },
  });
  // O upload do story é por link: a Meta baixa do file_url.
  const envio = await fetch(inicio.upload_url, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_url: url },
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!envio.ok) throw new ErroMeta(`O Facebook não aceitou o vídeo do story (${envio.status}): ${(await envio.text()).slice(0, 200)}`);
  const fim = await graph<{ post_id?: string }>(`${paginaId}/video_stories`, {
    metodo: "POST",
    token,
    corpo: { upload_phase: "finish", video_id: inicio.video_id },
  });
  return fim.post_id ?? inicio.video_id;
}

export async function publicarNoFacebook(perfil: Perfil, post: PostParaPublicar, salvar: Salvar): Promise<Publicado> {
  const token = await tokenDaPagina(perfil.paginaId);
  const pagina = perfil.paginaId;
  const [m] = post.midias;

  await salvar({ iniciado: true });

  let id: string;
  let link: string | null;
  if (post.tipo === "story") {
    if (m.tipo === "video") {
      id = (await storyDeVideo(pagina, token, m.url)) ?? "";
    } else {
      const foto = await fotoNaoPublicada(pagina, token, m.url);
      id = (await graph<{ post_id: string }>(`${pagina}/photo_stories`, { metodo: "POST", token, corpo: { photo_id: foto } })).post_id;
    }
    link = null;
  } else if (post.tipo === "reels" || m?.tipo === "video") {
    // O Reels do Instagram vai ao Facebook como vídeo da página (o mesmo que o
    // Metricool fazia). O upload de vídeo mora no host graph-video.
    id = (await graph<{ id: string }>(`${pagina}/videos`, {
      metodo: "POST",
      token,
      host: "graph-video.facebook.com",
      corpo: { file_url: m.url, description: post.legenda },
    })).id;
    link = `https://www.facebook.com/${pagina}/videos/${id}`;
  } else if (post.tipo === "carrossel") {
    const fotos: string[] = [];
    for (const x of post.midias) fotos.push(await fotoNaoPublicada(pagina, token, x.url));
    id = (await graph<{ id: string }>(`${pagina}/feed`, {
      metodo: "POST",
      token,
      corpo: { message: post.legenda, attached_media: fotos.map((f) => ({ media_fbid: f })) },
    })).id;
    link = `https://www.facebook.com/${id}`;
  } else if (m) {
    const r = await graph<{ id: string; post_id?: string }>(`${pagina}/photos`, {
      metodo: "POST",
      token,
      corpo: { url: m.url, message: post.legenda, published: true },
    });
    id = r.post_id ?? r.id;
    link = `https://www.facebook.com/${id}`;
  } else {
    // Só texto: o feed do Facebook aceita post sem mídia.
    id = (await graph<{ id: string }>(`${pagina}/feed`, { metodo: "POST", token, corpo: { message: post.legenda } })).id;
    link = `https://www.facebook.com/${id}`;
  }
  await salvar({ id, link });

  let aviso: string | undefined;
  if (post.primeiroComentario && post.tipo !== "story") {
    await graph(`${id}/comments`, { metodo: "POST", token, corpo: { message: post.primeiroComentario } }).catch((e) => {
      aviso = `Publicado, mas o primeiro comentário falhou: ${e instanceof Error ? e.message : String(e)}`;
    });
  }
  return { id, link, aviso };
}

// ── Leitura ─────────────────────────────────────────────────────────────────

/** Quantos posts o Instagram ainda aceita nas próximas 24 h (o teto é 100). */
export async function cotaDoInstagram(perfil: Perfil): Promise<{ usados: number; teto: number } | null> {
  try {
    const r = await graph<{ data: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
      `${perfil.instagramId}/content_publishing_limit`,
      { token: tokenDoSistema(), campos: "quota_usage,config" },
    );
    return { usados: r.data[0]?.quota_usage ?? 0, teto: r.data[0]?.config?.quota_total ?? 100 };
  } catch {
    return null;
  }
}
