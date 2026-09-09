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
//   2. `baixarPendentes`— pega o que está na fila e traz o arquivo pra cá
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

  const mime =
    textoOuNulo(e?.mimetype) ?? textoOuNulo(e?.mimeType) ?? textoOuNulo(e?.mime);

  // A URL do arquivo. A uazapi já mandou isso com vários nomes conforme a
  // versão; tentamos os conhecidos e paramos no primeiro que parecer URL.
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
      legenda: textoOuNulo(e?.caption) ?? textoOuNulo(e?.text) ?? "",
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
      null,
    tamanho: numeroOuNulo(e?.fileLength ?? e?.size ?? e?.fileSize),
    duracao: numeroOuNulo(e?.seconds ?? e?.duration ?? e?.audioDuration),
    legenda: textoOuNulo(e?.caption) ?? textoOuNulo(e?.text) ?? "",
  };
}

// ── Armazenamento ───────────────────────────────────────────────────────────
//
// Disco local, sob MIDIA_DIR. É a escolha que funciona HOJE, sem credencial
// nova: o projeto não tem chave de service role do Supabase Storage nem bucket
// S3 configurado, e inventar um segredo que ninguém cadastrou só adiaria o
// problema.
//
// O QUE ISSO CUSTA, e é bom estar escrito: em serverless o disco é efêmero e
// isto NÃO sobrevive a um deploy. Enquanto o app roda em `next dev`/servidor
// próprio, sobrevive. `midia_caminho` guarda um caminho relativo justamente
// para a troca ser de adaptador, não de schema — trocar por bucket é mudar
// `salvarArquivo`/`lerArquivo` e nada mais.

const RAIZ = process.env.MIDIA_DIR ?? ".midias";

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
  const pasta = path.join(
    String(agora.getUTCFullYear()),
    String(agora.getUTCMonth() + 1).padStart(2, "0"),
  );
  const relativo = path.join(pasta, `${id}${extensaoDe(mime, nome)}`);
  const destino = path.join(RAIZ, relativo);

  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, bytes);
  // Sempre com "/": o caminho vai para o banco e é lido em qualquer SO.
  return relativo.split(path.sep).join("/");
}

/**
 * Bytes de uma mídia já salva. `caminho` vem do banco, NUNCA do usuário — mas
 * a normalização abaixo existe mesmo assim: é uma linha, e o dia em que alguém
 * passar um parâmetro de rota direto aqui, `../../.env` não sai do lugar.
 */
export async function lerArquivo(caminho: string): Promise<Buffer> {
  const seguro = path
    .normalize(caminho)
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .split(/[\\/]/)
    .filter((p) => p && p !== "..")
    .join(path.sep);
  return fs.readFile(path.join(RAIZ, seguro));
}

// ── A fila ──────────────────────────────────────────────────────────────────

type Pendente = {
  id: string;
  midia_url_origem: string | null;
  midia_mime: string | null;
  midia_nome: string | null;
};

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
      SELECT id, midia_url_origem, midia_mime, midia_nome
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
      const res = await fetch(linha.midia_url_origem!, {
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

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > TETO_BYTES) throw new Error("arquivo acima do teto");

      const mime = linha.midia_mime ?? res.headers.get("content-type");
      const caminho = await salvarArquivo(linha.id, bytes, mime, linha.midia_nome);

      await sql`
        UPDATE mensagens SET
          midia_caminho = ${caminho},
          midia_mime    = COALESCE(midia_mime, ${mime}),
          midia_tamanho = ${bytes.byteLength},
          midia_estado  = 'salva',
          midia_erro    = NULL
        WHERE id = ${linha.id}`;
      salvas++;
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

/**
 * Dispara a fila sem segurar quem chamou.
 *
 * O webhook precisa responder 200 rápido (senão a uazapi reenvia), mas a URL da
 * uazapi expira — esperar um cron de minutos arrisca perder o arquivo. Então a
 * baixa começa aqui, solta, e o `catch` garante que uma falha dela nunca vire
 * exceção não tratada no processo.
 */
export function baixarPendentesEmSegundoPlano(): void {
  void baixarPendentes().catch((e) =>
    console.error("[midia] fila em segundo plano falhou:", e),
  );
}
