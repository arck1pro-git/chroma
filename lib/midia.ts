// Mídia de atendimento: extrair do evento, baixar e guardar.
//
// POR QUE ESTE ARQUIVO EXISTE: o webhook desistia de tudo que não era texto
// ("Só trata mensagem de texto por enquanto"), então áudio, foto e documento de
// cliente chegavam e eram descartados. O pedido é o oposto — "sendo eles salvos
// no sistema para visualizarmos". Registro de atendimento sem o áudio que o
// cliente mandou não é registro.
//
// TRÊS ETAPAS, SEPARADAS DE PROPÓSITO:
//   1. `midiaDoEvento`  — lê o payload da uazapi e diz o que veio (puro, testável)
//   2. `baixarPendentes`— pega o que está na fila e traz o arquivo pra cá (e
//                         transcreve o áudio, lib/transcricao.ts)
//   3. `lerArquivo`     — devolve os bytes pra rota que exibe
//
// Elas não são um passo só porque a URL da uazapi EXPIRA. Se o download fosse
// dentro do webhook e falhasse, a mídia estaria perdida e o webhook teria que
// escolher entre demorar ou perder. Separado, a linha nasce 'pendente' com a
// URL de origem guardada, e uma falha de rede vira uma retentativa em vez de um
// buraco no histórico.
//
// ⚠ FORMATO DO PAYLOAD: como no resto do webhook, os nomes de campo abaixo são
// os prováveis do uazapiGO, não confirmados contra um evento real de mídia. Por
// isso a extração é tolerante e o que não casa vira tipo 'desconhecido' com o
// evento logado — a mensagem entra na conversa mesmo quando não sabemos ler o
// anexo, em vez de sumir.
import fs from "fs/promises";
import path from "path";
import { sql } from "@/lib/db";
import { BUCKET_DOCUMENTOS, baixar, subir } from "@/lib/armazenamento";
import { baixarMidiaMeta } from "@/lib/meta";
import { linkDaMidiaRecebida } from "@/lib/uazapi";
import { transcreverAudio } from "@/lib/transcricao";

export type TipoMensagem =
  | "texto"
  | "imagem"
  | "audio"
  | "video"
  | "documento"
  | "sticker"
  | "localizacao"
  | "contato"
  | "desconhecido";

export type MidiaDoEvento = {
  tipo: TipoMensagem;
  url: string | null;
  mime: string | null;
  nome: string | null;
  tamanho: number | null;
  duracao: number | null;
  // Legenda da foto/vídeo. Vai para mensagens.texto, que é onde ela estaria se
  // fosse mensagem de texto — a tela não precisa saber que veio de outro campo.
  legenda: string;
};

// mimetype é o sinal mais confiável quando existe; o campo de tipo da uazapi
// varia de nome entre versões, então ele é o segundo palpite, não o primeiro.
function tipoPorMime(mime: string | null): TipoMensagem | null {
  if (!mime) return null;
  if (/^image\/webp/i.test(mime)) return "sticker";
  if (/^image\//i.test(mime)) return "imagem";
  if (/^audio\//i.test(mime)) return "audio";
  if (/^video\//i.test(mime)) return "video";
  if (/^(application|text)\//i.test(mime)) return "documento";
  return null;
}

function tipoPorRotulo(bruto: unknown): TipoMensagem | null {
  const s = String(bruto ?? "").toLowerCase();
  if (!s) return null;
  if (/sticker/.test(s)) return "sticker";
  if (/image|imagem|photo|foto/.test(s)) return "imagem";
  if (/audio|voice|ptt/.test(s)) return "audio";
  if (/video/.test(s)) return "video";
  if (/document|file|arquivo/.test(s)) return "documento";
  if (/location|localiza/.test(s)) return "localizacao";
  if (/contact|vcard/.test(s)) return "contato";
  return null;
}

function numeroOuNulo(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Lê o corpo do evento e devolve o que há de mídia — ou null quando é texto
 * puro, que é o caso da esmagadora maioria e o único que existia até agora.
 */
export function midiaDoEvento(ev: Record<string, unknown>): MidiaDoEvento | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = ev as any;
  // No uazapiGO os dados do anexo vêm dentro de `content` (visto num evento
  // real, 2026-09-29): mimetype, fileLength, seconds, caption, fileName. Em
  // mensagem de texto `content` é string, e aí não há nada a ler.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = e?.content && typeof e.content === "object" ? e.content : {};

  const mime =
    textoOuNulo(e?.mimetype) ??
    textoOuNulo(e?.mimeType) ??
    textoOuNulo(e?.mime) ??
    textoOuNulo(c.mimetype);

  // A URL do arquivo. A uazapi já mandou isso com vários nomes conforme a
  // versão; tentamos os conhecidos e paramos no primeiro que parecer URL.
  // `content.URL` fica de fora de propósito: é o .enc criptografado da CDN do
  // WhatsApp. Sem URL aqui, quem chama pede o arquivo à instância
  // (linkDaMidiaRecebida em lib/uazapi.ts).
  const url =
    [e?.file, e?.fileURL, e?.url, e?.mediaUrl, e?.media?.url, e?.downloadUrl]
      .map(textoOuNulo)
      .find((u) => u && /^https?:\/\//i.test(u)) ?? null;

  const rotulo = e?.messageType ?? e?.mediaType ?? e?.type ?? e?.msgType;
  const tipo = tipoPorMime(mime) ?? tipoPorRotulo(rotulo);

  // Localização e contato não têm arquivo para baixar, mas também não são
  // texto: viram a mensagem com o tipo certo e a legenda que der.
  if (tipo === "localizacao" || tipo === "contato") {
    return {
      tipo,
      url: null,
      mime: null,
      nome: null,
      tamanho: null,
      duracao: null,
      legenda: textoOuNulo(e?.caption) ?? textoOuNulo(c.caption) ?? textoOuNulo(e?.text) ?? "",
    };
  }

  // Nada indica mídia: é texto, e quem chama segue o caminho antigo.
  if (!tipo && !url) return null;

  return {
    // Tem URL mas não soubemos classificar: entra como 'desconhecido' e é
    // baixado do mesmo jeito. Perder o arquivo por não saber o rótulo seria
    // trocar um problema pequeno por um irreversível.
    tipo: tipo ?? "desconhecido",
    url,
    mime,
    nome:
      textoOuNulo(e?.fileName) ??
      textoOuNulo(e?.filename) ??
      textoOuNulo(e?.documentFileName) ??
      textoOuNulo(c.fileName) ??
      null,
    tamanho: numeroOuNulo(e?.fileLength ?? e?.size ?? e?.fileSize ?? c.fileLength),
    duracao: numeroOuNulo(e?.seconds ?? e?.duration ?? e?.audioDuration ?? c.seconds),
    legenda: textoOuNulo(e?.caption) ?? textoOuNulo(c.caption) ?? textoOuNulo(e?.text) ?? "",
  };
}

/** Tipos que têm arquivo para buscar. Localização e contato não têm. */
export function temArquivo(tipo: TipoMensagem): boolean {
  return tipo !== "texto" && tipo !== "localizacao" && tipo !== "contato";
}

// ── Armazenamento ───────────────────────────────────────────────────────────
//
// Supabase Storage, no bucket do CRM (lib/armazenamento.ts), sob `midias/`.
//
// ERA DISCO LOCAL (MIDIA_DIR), e na Vercel isso não funciona: o sistema de
// arquivos é somente-leitura fora de /tmp e cada invocação pode cair numa
// máquina diferente — o mesmo bug que a biblioteca de documentos já tinha
// sofrido. A troca foi a prevista quando o disco foi escolhido: só
// `salvarArquivo`/`lerArquivo` mudaram, o schema não.
//
// Caminho novo começa com `midias/`; o antigo ("2026/09/<id>.ogg") continua
// sendo lido do disco, para as linhas que já existiam em ambiente local.

const RAIZ = process.env.MIDIA_DIR ?? ".midias";
const PREFIXO_STORAGE = "midias/";

// Teto por arquivo. O WhatsApp já limita, mas quem responde aqui é uma URL de
// terceiro — sem teto, um arquivo gigante enche o disco do servidor.
const TETO_BYTES = Number(process.env.MIDIA_TETO_MB ?? 32) * 1024 * 1024;

function extensaoDe(mime: string | null, nome: string | null): string {
  const doNome = nome ? path.extname(nome) : "";
  if (doNome && doNome.length <= 6) return doNome;
  const mapa: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "video/mp4": ".mp4",
    "application/pdf": ".pdf",
  };
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return mapa[base] ?? ".bin";
}

/** Grava os bytes e devolve o caminho relativo que vai em midia_caminho. */
async function salvarArquivo(
  id: string,
  bytes: Uint8Array,
  mime: string | null,
  nome: string | null,
): Promise<string> {
  const agora = new Date();
  const caminho = [
    "midias",
    String(agora.getUTCFullYear()),
    String(agora.getUTCMonth() + 1).padStart(2, "0"),
    `${id}${extensaoDe(mime, nome)}`,
  ].join("/");
  return subir(BUCKET_DOCUMENTOS, caminho, bytes, mime ?? "application/octet-stream");
}

/**
 * Guarda um arquivo que NÓS geramos (a voz da IA) no mesmo lugar da mídia
 * recebida, e devolve o caminho que vai em midia_caminho.
 */
export function guardarMidia(
  id: string,
  bytes: Uint8Array,
  mime: string | null,
  nome: string | null,
): Promise<string> {
  return salvarArquivo(id, bytes, mime, nome);
}

/**
 * Bytes de uma mídia já salva. `caminho` vem do banco, NUNCA do usuário — mas
 * a normalização abaixo existe mesmo assim: é uma linha, e o dia em que alguém
 * passar um parâmetro de rota direto aqui, `../../.env` não sai do lugar.
 */
export async function lerArquivo(caminho: string): Promise<Buffer> {
  if (caminho.startsWith(PREFIXO_STORAGE)) {
    const limpo = caminho
      .split("/")
      .filter((p) => p && p !== "." && p !== "..")
      .join("/");
    return baixar(BUCKET_DOCUMENTOS, limpo);
  }
  const seguro = path
    .normalize(caminho)
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .split(/[\\/]/)
    .filter((p) => p && p !== "..")
    .join(path.sep);
  return fs.readFile(path.join(RAIZ, seguro));
}

// ── A fila ──────────────────────────────────────────────────────────────────

/**
 * Traz os bytes da origem. Três formas de `midia_url_origem`:
 *   · https://…              → URL direta, baixada como veio.
 *   · uazapi:<numero>:<id>   → mídia recebida pela uazapi. O webhook só traz o
 *                              .enc criptografado; a instância do <numero>
 *                              decifra e devolve um link que vale 2 dias
 *                              (linkDaMidiaRecebida em lib/uazapi.ts).
 *   · meta:<id>              → mídia da API oficial. A Meta não manda URL no
 *                              webhook, só o id; a URL sai de outra chamada,
 *                              vale minutos e pede token (baixarMidiaMeta em
 *                              lib/meta.ts).
 */
async function baixarOrigem(origem: string): Promise<{ bytes: Uint8Array; mime: string | null }> {
  if (origem.startsWith("meta:")) return baixarMidiaMeta(origem.slice(5));
  if (origem.startsWith("uazapi:")) {
    const idCompleto = origem.slice("uazapi:".length);
    const numero = idCompleto.split(":")[0];
    const { url, mime } = await linkDaMidiaRecebida(numero, idCompleto);
    const baixado = await baixarUrl(url);
    return { bytes: baixado.bytes, mime: mime ?? baixado.mime };
  }
  return baixarUrl(origem);
}

async function baixarUrl(origem: string): Promise<{ bytes: Uint8Array; mime: string | null }> {
  const res = await fetch(origem, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`origem respondeu ${res.status}`);

  // Confere o tamanho ANTES de puxar tudo para a memória quando o servidor
  // informa; o teto depois do arrayBuffer não protegeria de nada.
  const declarado = Number(res.headers.get("content-length") ?? 0);
  if (declarado > TETO_BYTES) {
    throw new Error(`arquivo de ${Math.round(declarado / 1024 / 1024)}MB acima do teto`);
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") };
}

type Pendente = {
  id: string;
  tipo: TipoMensagem;
  texto: string;
  midia_url_origem: string | null;
  midia_mime: string | null;
  midia_nome: string | null;
};

/**
 * Áudio salvo sem texto: transcreve e grava em `texto`. Falhar aqui não mexe no
 * estado da mídia — o arquivo está salvo e toca no chat; só a IA fica sem
 * saber o que ele diz, e o motivo vai para o log.
 */
async function transcreverSeForAudio(linha: Pendente, bytes: Uint8Array, mime: string | null) {
  if (linha.tipo !== "audio" || linha.texto.trim()) return;
  try {
    const texto = await transcreverAudio(bytes, mime);
    if (!texto) return;
    // `texto = ''` na condição: se alguém já escreveu ali, não sobrescreve.
    await sql`UPDATE mensagens SET texto = ${texto} WHERE id = ${linha.id} AND texto = ''`;
  } catch (e) {
    console.error(`[midia] não consegui transcrever ${linha.id}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Baixa o que está em `midia_estado = 'pendente'` e grava no storage.
 *
 * Devolve quantas foram salvas e quantas falharam. NUNCA lança: é chamada em
 * caminhos que não podem quebrar por causa de uma rede ruim (o webhook, que
 * precisa responder 200 para a uazapi não reenviar em loop).
 */
export async function baixarPendentes(limite = 20): Promise<{
  salvas: number;
  erros: number;
}> {
  let salvas = 0;
  let erros = 0;

  let fila: Pendente[];
  try {
    fila = (await sql`
      SELECT id, tipo, texto, midia_url_origem, midia_mime, midia_nome
      FROM mensagens
      WHERE midia_estado = 'pendente' AND midia_url_origem IS NOT NULL
      ORDER BY data_criacao
      LIMIT ${limite}`) as unknown as Pendente[];
  } catch (e) {
    console.error("[midia] não consegui ler a fila:", e);
    return { salvas: 0, erros: 0 };
  }

  for (const linha of fila) {
    try {
      const { bytes, mime: mimeOrigem } = await baixarOrigem(linha.midia_url_origem!);
      if (bytes.byteLength > TETO_BYTES) throw new Error("arquivo acima do teto");

      // O tipo de quem entregou os bytes vale mais que o do evento: o áudio
      // chega como OGG no evento e a uazapi entrega MP3 (generate_mp3). Com o
      // do evento, o arquivo seria salvo .ogg com bytes de MP3. Genérico
      // (octet-stream) não diz nada, e aí fica o do evento.
      const doArquivo = mimeOrigem && !/octet-stream/i.test(mimeOrigem) ? mimeOrigem : null;
      const mime = doArquivo ?? linha.midia_mime;
      const caminho = await salvarArquivo(linha.id, bytes, mime, linha.midia_nome);

      await sql`
        UPDATE mensagens SET
          midia_caminho = ${caminho},
          midia_mime    = ${mime},
          midia_tamanho = ${bytes.byteLength},
          midia_estado  = 'salva',
          midia_erro    = NULL
        WHERE id = ${linha.id}`;
      salvas++;

      await transcreverSeForAudio(linha, bytes, mime);
    } catch (e) {
      erros++;
      const motivo = e instanceof Error ? e.message : String(e);
      // 'erro' e não 'pendente' de novo: sem isso a mesma URL morta seria
      // tentada em toda chamada, para sempre. Retentar é ação explícita
      // (POST /api/midia/pendentes), e o motivo fica visível na tela.
      await sql`
        UPDATE mensagens SET midia_estado = 'erro', midia_erro = ${motivo.slice(0, 500)}
        WHERE id = ${linha.id}`.catch(() => {});
      console.error(`[midia] falhou ao baixar ${linha.id}:`, motivo);
    }
  }

  return { salvas, erros };
}
