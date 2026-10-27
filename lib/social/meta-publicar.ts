// As chamadas de publicação na Meta (Graph API), uma por rede e por tipo.
//
// OS BYTES VÃO DIRETO PARA A META (2026-10-16, pedido dele: "não salvar nada
// no nosso supabase"). Quem busca o arquivo na fonte é lib/social/midia.ts; o
// que sai daqui:
//   · VÍDEO: os bytes no envio direto — no Instagram, o contêiner "resumable"
//     e o POST no rupload; no Facebook, o upload do vídeo da página (ou do
//     story, também pelo rupload). Sem link público no meio.
//   · FOTO: o Instagram só aceita foto POR LINK. A foto sobe como NÃO
//     PUBLICADA na página do Facebook do próprio perfil (prepararFotos), e o
//     link da Meta para ela (fbcdn) é o que vai ao Instagram. O post do
//     Facebook usa a mesma foto (attached_media / photo_stories). A que não
//     virar post no Facebook é apagada no fim (apagarFotos, em posts.ts).
//
// INSTAGRAM publica em dois passos: o contêiner, que a Meta processa (vídeo
// leva de segundos a minutos), e o media_publish. O id do contêiner é salvo
// assim que ele fica pronto para processar (`salvar`): se a função cair, a
// rodada seguinte retoma dele — e publicar o mesmo contêiner duas vezes a Meta
// recusa, então retomar não duplica post.
//
// FACEBOOK publica numa chamada só, com o token DA PÁGINA. Antes dela grava
// `iniciado`: se a função cair depois da chamada e antes de guardar o id, não
// há como saber se o post saiu, e a rodada seguinte marca erro em vez de
// arriscar um post duplicado na página.
//
// COLAB (2026-10-16): os @ em `colaboradores` vão no contêiner do Instagram
// (Reels, foto e carrossel; story não aceita). Quando o convidado é um dos
// nossos perfis, o próprio CRM aceita o convite por ele logo depois de
// publicar (POST /collaboration_invites) — e o post já sai nos dois perfis.
import "server-only";
import { ErroMeta } from "@/lib/meta";
import { PERFIS, perfilPorInstagram, type Perfil } from "./perfis";

const VERSAO = process.env.META_GRAPH_VERSION?.trim() || "v26.0";

export type TipoPost = "reels" | "story" | "feed" | "carrossel";
/** O arquivo direto da fonte, sem passar pela memória. tamanho null = a fonte não disse. */
export type FluxoDaMidia = { corpo: ReadableStream<Uint8Array>; tamanho: number | null };
/**
 * A mídia na hora de publicar. Foto usa `bytes` (pequena, e a mesma serve às
 * duas redes). VÍDEO USA `fluxo` (2026-10-19): um Reels de 344 MB inteiro na
 * memória, mais as cópias do envio, passava de 1 GB e o servidor matava a
 * publicação no meio — o post ficava em "publicando" e não saía.
 */
export type MidiaParaPublicar = {
  tipo: "imagem" | "video";
  nome: string;
  mime: string;
  bytes: () => Promise<Uint8Array>;
  fluxo: () => Promise<FluxoDaMidia>;
};
export type PostParaPublicar = {
  tipo: TipoPost;
  legenda: string;
  midias: MidiaParaPublicar[];
  capaUrl: string | null;
  primeiroComentario: string | null;
  /** @ do Instagram convidados para o colab (até 3). */
  colaboradores: string[];
  /** Selo "Informações de IA" do Instagram (is_ai_generated). */
  feitoComIa: boolean;
};
/** A foto já na página do Facebook (não publicada), pelo índice da mídia. */
export type FotosNaPagina = Map<number, { id: string; url: string }>;
export type Publicado = { id: string; link: string | null; aviso?: string };
/** Grava o progresso no post (resultado.<rede>), antes do passo seguinte. */
export type Salvar = (parcial: Record<string, unknown>) => Promise<void>;

/** O vídeo do Instagram ainda processava quando o tempo da rodada acabou. */
export class AindaProcessando extends Error {}

function tokenDoSistema(): string {
  const t = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (!t) throw new ErroMeta("META_SYSTEM_USER_TOKEN não configurado.", undefined, 503);
  return t;
}

const comoCorpo = (bytes: Uint8Array) => bytes as unknown as BodyInit;

async function graph<T>(
  caminho: string,
  opcoes: {
    metodo?: "GET" | "POST" | "DELETE";
    corpo?: Record<string, unknown>;
    formulario?: FormData;
    // Corpo já montado e em fluxo (o multipart do vídeo da página): vai com o
    // tamanho exato, sem passar pela memória.
    bruto?: { corpo: ReadableStream<Uint8Array>; tipo: string; tamanho: number };
    token: string;
    host?: string;
    campos?: string;
  },
): Promise<T> {
  const url = new URL(`https://${opcoes.host ?? "graph.facebook.com"}/${VERSAO}/${caminho.replace(/^\//, "")}`);
  if (opcoes.campos) url.searchParams.set("fields", opcoes.campos);
  const res = await fetch(url, {
    method: opcoes.metodo ?? (opcoes.corpo || opcoes.formulario || opcoes.bruto ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${opcoes.token}`,
      ...(opcoes.corpo ? { "Content-Type": "application/json" } : {}),
      ...(opcoes.bruto ? { "Content-Type": opcoes.bruto.tipo, "Content-Length": String(opcoes.bruto.tamanho) } : {}),
    },
    body: opcoes.bruto?.corpo ?? opcoes.formulario ?? (opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined),
    // Corpo em fluxo exige duplex no fetch do Node.
    ...(opcoes.bruto ? { duplex: "half" } : {}),
    cache: "no-store",
    // Upload de vídeo: a Meta só responde depois de receber o arquivo inteiro.
    signal: AbortSignal.timeout(240_000),
  } as RequestInit);
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_user_msg?: string; error_user_title?: string } } & T;
  if (!res.ok || json.error) {
    const e = json.error;
    const mensagem = [e?.error_user_title, e?.error_user_msg || e?.message].filter(Boolean).join(": ") || `Meta respondeu ${res.status}.`;
    throw new ErroMeta(mensagem, e?.code, res.status >= 500 ? 502 : res.status);
  }
  return json;
}

/**
 * O arquivo em fluxo e com o tamanho exato. Fonte que não informou o tamanho
 * (link sem Content-Length) é lida para a memória: sem tamanho a Meta não
 * aceita o envio.
 */
async function comTamanho(m: MidiaParaPublicar): Promise<{ corpo: ReadableStream<Uint8Array>; tamanho: number }> {
  const f = await m.fluxo();
  if (f.tamanho) return { corpo: f.corpo, tamanho: f.tamanho };
  const bytes = new Uint8Array(await new Response(f.corpo).arrayBuffer());
  return { corpo: new Response(comoCorpo(bytes)).body!, tamanho: bytes.byteLength };
}

/** O vídeo no rupload da Meta (contêiner do Instagram, story do Facebook), em fluxo da fonte. */
async function enviarAoRupload(url: string, token: string, m: MidiaParaPublicar, rede: string): Promise<void> {
  const { corpo, tamanho } = await comTamanho(m);
  const res = await fetch(url, {
    method: "POST",
    // Content-Length explícito: em fluxo, sem ele o envio sai "chunked" e o
    // rupload recusa ("expected both Content-Length and X-Entity-Length").
    headers: {
      Authorization: `OAuth ${token}`,
      offset: "0",
      file_size: String(tamanho),
      "Content-Length": String(tamanho),
      "X-Entity-Length": String(tamanho),
    },
    body: corpo,
    duplex: "half",
    cache: "no-store",
    signal: AbortSignal.timeout(240_000),
  } as RequestInit);
  if (!res.ok) throw new ErroMeta(`O ${rede} não recebeu o vídeo (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

/**
 * O multipart do vídeo da página (graph-video) montado em fluxo: os campos de
 * texto, o arquivo direto da fonte e o fecho, com o Content-Length somado. O
 * FormData juntava o vídeo inteiro num Blob na memória.
 */
async function multipartDoVideo(campos: Record<string, string>, m: MidiaParaPublicar) {
  const { corpo, tamanho } = await comTamanho(m);
  const limite = `----amaanoffice${crypto.randomUUID().replace(/-/g, "")}`;
  const cod = new TextEncoder();
  const textos = Object.entries(campos)
    .map(([nome, valor]) => `--${limite}\r\nContent-Disposition: form-data; name="${nome}"\r\n\r\n${valor}\r\n`)
    .join("");
  const nomeArquivo = m.nome.replace(/["\r\n]/g, "_");
  const antes = cod.encode(`${textos}--${limite}\r\nContent-Disposition: form-data; name="source"; filename="${nomeArquivo}"\r\nContent-Type: ${m.mime}\r\n\r\n`);
  const depois = cod.encode(`\r\n--${limite}--\r\n`);
  const leitor = corpo.getReader();
  let fase = 0;
  const fluxo = new ReadableStream<Uint8Array>({
    async pull(c) {
      if (fase === 0) {
        fase = 1;
        c.enqueue(antes);
        return;
      }
      if (fase === 1) {
        const { done, value } = await leitor.read();
        if (!done) {
          c.enqueue(value);
          return;
        }
        fase = 2;
      }
      c.enqueue(depois);
      c.close();
    },
    cancel(motivo) {
      return leitor.cancel(motivo);
    },
  });
  return {
    corpo: fluxo,
    tipo: `multipart/form-data; boundary=${limite}`,
    tamanho: antes.byteLength + tamanho + depois.byteLength,
  };
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

/**
 * O token de uma das NOSSAS páginas (lib/social/perfis.ts), e só delas. É o
 * que o direct do Instagram usa (lib/instagram.ts, desde 2026-10-26): o token
 * do system user alcançaria qualquer página que alguém atribuísse a ele, e a
 * lista fechada é a trava.
 */
export async function tokenDaPaginaDoPerfil(paginaId: string): Promise<string> {
  if (!PERFIS.some((p) => p.paginaId === paginaId)) {
    throw new ErroMeta(`A página ${paginaId} não é de um dos perfis do CRM.`, undefined, 400);
  }
  return tokenDaPagina(paginaId);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Fotos: na página, sem publicar ──────────────────────────────────────────

async function linkDaFoto(fotoId: string, token: string): Promise<string> {
  const r = await graph<{ images?: Array<{ source: string; width: number }> }>(fotoId, { token, campos: "images" });
  const maior = [...(r.images ?? [])].sort((a, b) => b.width - a.width)[0];
  if (!maior) throw new ErroMeta(`A Meta não devolveu o link da foto ${fotoId}.`);
  return maior.source;
}

/**
 * Sobe cada foto do post como NÃO PUBLICADA na página do perfil e devolve o id
 * e o link da Meta para ela. `jaFeitas` são as de uma rodada anterior
 * (retomada): essas não sobem de novo. `salvar` guarda cada id assim que nasce.
 */
export async function prepararFotos(
  perfil: Perfil,
  post: PostParaPublicar,
  jaFeitas: Record<string, string>,
  salvar: (indice: number, fotoId: string) => Promise<void>,
): Promise<FotosNaPagina> {
  const fotos: FotosNaPagina = new Map();
  if (!post.midias.some((m) => m.tipo === "imagem")) return fotos;
  const token = await tokenDaPagina(perfil.paginaId);
  for (const [i, m] of post.midias.entries()) {
    if (m.tipo !== "imagem") continue;
    let id = jaFeitas[String(i)];
    if (!id) {
      const form = new FormData();
      form.append("published", "false");
      form.append("source", new Blob([comoCorpo(await m.bytes()) as BlobPart], { type: m.mime }), m.nome);
      id = (await graph<{ id: string }>(`${perfil.paginaId}/photos`, { token, formulario: form })).id;
      await salvar(i, id);
    }
    fotos.set(i, { id, url: await linkDaFoto(id, token) });
  }
  return fotos;
}

/** Tira da página as fotos que não viraram post no Facebook. */
export async function apagarFotos(perfil: Perfil, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const token = await tokenDaPagina(perfil.paginaId);
  await Promise.all(
    ids.map((id) =>
      graph(id, { token, metodo: "DELETE" }).catch((e) => console.error(`[social] não apaguei a foto ${id}:`, e)),
    ),
  );
}

// ── Instagram ───────────────────────────────────────────────────────────────

async function criarConteiner(igId: string, token: string, corpo: Record<string, unknown>): Promise<string> {
  return (await graph<{ id: string }>(`${igId}/media`, { token, corpo })).id;
}

/** Contêiner de vídeo com os bytes enviados direto (sem link público). */
async function conteinerDeVideo(igId: string, token: string, corpo: Record<string, unknown>, m: MidiaParaPublicar): Promise<string> {
  const c = await graph<{ id: string; uri: string }>(`${igId}/media?upload_type=resumable`, {
    token,
    corpo: { ...corpo, upload_type: "resumable" },
  });
  await enviarAoRupload(c.uri, token, m, "Instagram");
  return c.id;
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
  fotos: FotosNaPagina,
  progresso: { conteiner?: string },
  salvar: Salvar,
  ate: number,
): Promise<Publicado> {
  const token = tokenDoSistema();
  const ig = perfil.instagramId;
  const linkDa = (i: number) => {
    const f = fotos.get(i);
    if (!f) throw new ErroMeta(`A foto ${i + 1} não chegou à página do Facebook.`);
    return f.url;
  };
  let conteiner = progresso.conteiner;
  // Story não aceita colab (criarPost já recusa); nos outros, vai no contêiner
  // do post (no carrossel, no pai).
  const colab = post.colaboradores.length ? { collaborators: post.colaboradores } : {};
  // O selo "Informações de IA" (2026-10-16): no contêiner do post — no
  // carrossel, só no pai (a Meta recusa nos itens).
  const ia = post.feitoComIa ? { is_ai_generated: true } : {};

  if (!conteiner) {
    const [m] = post.midias;
    if (post.tipo === "feed") {
      conteiner = await criarConteiner(ig, token, { image_url: linkDa(0), caption: post.legenda, ...colab, ...ia });
    } else if (post.tipo === "reels") {
      conteiner = await conteinerDeVideo(ig, token, {
        media_type: "REELS",
        caption: post.legenda,
        share_to_feed: true,
        ...(post.capaUrl ? { cover_url: post.capaUrl } : {}),
        ...colab,
        ...ia,
      }, m);
    } else if (post.tipo === "story") {
      conteiner =
        m.tipo === "video"
          ? await conteinerDeVideo(ig, token, { media_type: "STORIES", ...ia }, m)
          : await criarConteiner(ig, token, { media_type: "STORIES", image_url: linkDa(0), ...ia });
    } else {
      // Carrossel: um contêiner por item, cada um pronto antes do contêiner pai.
      const filhos: string[] = [];
      for (const [i, x] of post.midias.entries()) {
        if (x.tipo === "video") {
          const filho = await conteinerDeVideo(ig, token, { media_type: "VIDEO", is_carousel_item: true }, x);
          await esperarConteiner(filho, token, ate);
          filhos.push(filho);
        } else {
          filhos.push(await criarConteiner(ig, token, { is_carousel_item: true, image_url: linkDa(i) }));
        }
      }
      conteiner = await criarConteiner(ig, token, { media_type: "CAROUSEL", children: filhos.join(","), caption: post.legenda, ...colab, ...ia });
    }
    await salvar({ conteiner });
  }

  await esperarConteiner(conteiner, token, ate);
  const { id } = await graph<{ id: string }>(`${ig}/media_publish`, { token, corpo: { creation_id: conteiner } });
  await salvar({ id });

  const link = await graph<{ permalink?: string }>(id, { token, campos: "permalink" })
    .then((r) => r.permalink ?? null)
    .catch(() => null);

  const avisos: string[] = [];
  if (post.primeiroComentario && post.tipo !== "story") {
    await graph(`${id}/comments`, { token, corpo: { message: post.primeiroComentario } }).catch((e) => {
      avisos.push(`Publicado, mas o primeiro comentário falhou: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
  // O convite do colab aceito pelos nossos perfis; conta de fora aceita no app.
  for (const usuario of post.colaboradores) {
    const nosso = perfilPorInstagram(usuario);
    if (nosso && !(await aceitarColab(nosso, id, token))) {
      avisos.push(`Colab: não consegui aceitar o convite pelo @${usuario}; aceite no app do Instagram (Notificações).`);
    }
  }
  return { id, link, aviso: avisos.join(" ") || undefined };
}

/**
 * Aceita, pelo perfil convidado, o convite de colab do post recém-publicado.
 * O convite pode levar alguns segundos para existir: tenta 4 vezes.
 */
async function aceitarColab(convidado: Perfil, mediaId: string, token: string): Promise<boolean> {
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    try {
      const r = await graph<{ success?: boolean }>(`${convidado.instagramId}/collaboration_invites`, {
        token,
        corpo: { media_id: mediaId, accept: true },
      });
      if (r.success) return true;
    } catch (e) {
      if (tentativa === 4) console.error(`[social] colab: @${convidado.instagram} não aceitou ${mediaId}:`, e);
    }
    await esperar(5_000);
  }
  return false;
}

// ── Facebook ────────────────────────────────────────────────────────────────

async function storyDeVideo(paginaId: string, token: string, m: MidiaParaPublicar): Promise<string> {
  const inicio = await graph<{ video_id: string; upload_url: string }>(`${paginaId}/video_stories`, {
    token,
    corpo: { upload_phase: "start" },
  });
  await enviarAoRupload(inicio.upload_url, token, m, "Facebook");
  const fim = await graph<{ post_id?: string }>(`${paginaId}/video_stories`, {
    token,
    corpo: { upload_phase: "finish", video_id: inicio.video_id },
  });
  return fim.post_id ?? inicio.video_id;
}

export async function publicarNoFacebook(
  perfil: Perfil,
  post: PostParaPublicar,
  fotos: FotosNaPagina,
  salvar: Salvar,
): Promise<Publicado> {
  const token = await tokenDaPagina(perfil.paginaId);
  const pagina = perfil.paginaId;
  const [m] = post.midias;
  const fotoDa = (i: number) => {
    const f = fotos.get(i);
    if (!f) throw new ErroMeta(`A foto ${i + 1} não chegou à página do Facebook.`);
    return f.id;
  };

  await salvar({ iniciado: true });

  let id: string;
  let link: string | null;
  if (post.tipo === "story") {
    id =
      m.tipo === "video"
        ? await storyDeVideo(pagina, token, m)
        : (await graph<{ post_id: string }>(`${pagina}/photo_stories`, { token, corpo: { photo_id: fotoDa(0) } })).post_id;
    link = null;
  } else if (m?.tipo === "video") {
    // O Reels do Instagram vai ao Facebook como vídeo da página (o mesmo que o
    // Metricool fazia). Upload em fluxo, direto da fonte, no host graph-video.
    const bruto = await multipartDoVideo({ description: post.legenda }, m);
    id = (await graph<{ id: string }>(`${pagina}/videos`, { token, host: "graph-video.facebook.com", bruto })).id;
    link = `https://www.facebook.com/${pagina}/videos/${id}`;
  } else if (m) {
    // Feed ou carrossel de fotos: as fotos já estão na página, não publicadas;
    // o post as junta.
    id = (await graph<{ id: string }>(`${pagina}/feed`, {
      token,
      corpo: { message: post.legenda, attached_media: post.midias.map((_, i) => ({ media_fbid: fotoDa(i) })) },
    })).id;
    link = `https://www.facebook.com/${id}`;
  } else {
    // Só texto: o feed do Facebook aceita post sem mídia.
    id = (await graph<{ id: string }>(`${pagina}/feed`, { token, corpo: { message: post.legenda } })).id;
    link = `https://www.facebook.com/${id}`;
  }
  await salvar({ id, link });

  let aviso: string | undefined;
  if (post.primeiroComentario && post.tipo !== "story") {
    await graph(`${id}/comments`, { token, corpo: { message: post.primeiroComentario } }).catch((e) => {
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

// Para o teste de envio em fluxo SEM publicar (contêiner do Instagram sem
// media_publish, vídeo da página com published=false, apagado em seguida).
export const paraTeste = { graph, tokenDaPagina, multipartDoVideo, enviarAoRupload };
