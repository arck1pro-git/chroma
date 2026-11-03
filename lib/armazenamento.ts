// Onde os arquivos do CRM ficam de verdade: Neon Object Storage (API do S3).
//
// POR QUE ISTO EXISTE, e vale escrito porque custou um bug em produção: antes
// os bytes iam para disco local (`.documentos/`, `.midias/`). Funciona em
// `next dev`, e NÃO funciona no deploy — o CRM roda na Vercel, onde o sistema
// de arquivos é somente-leitura fora de /tmp e cada invocação pode cair numa
// instância diferente. O sintoma foi exatamente este, na primeira cadência com
// anexo:
//
//   ENOENT: no such file or directory, open '.documentos/2026/09/mu799h2f-….pdf'
//
// O arquivo tinha sido subido pelo localhost e estava no disco daquela máquina.
// O banco é compartilhado, então a linha em `documentos` existia para todo mundo
// — só os bytes é que não. Disco local mente: o banco diz que o documento
// existe e o servidor que precisa dele não o enxerga.
//
// DO SUPABASE PARA O NEON em 2026-11-03: o Supabase suspendeu o Storage por cota
// de tráfego de saída (402) e nada subia nem abria. Os buckets estão no projeto
// do banco de produção no Neon (branch production), com os MESMOS nomes e as
// MESMAS chaves de antes — por isso a troca foi de adaptador, sem tocar no banco.
// O Neon fala a API do S3 (só path-style); as variáveis se chamam NEON_STORAGE_*
// porque a Vercel reserva AWS_*.
//
// O QUE O BUCKET NÃO TRAVA MAIS, A ASSINATURA TRAVA: o Supabase guardava o teto
// por arquivo no bucket. Aqui o link de envio assina o tamanho e o tipo que o
// servidor aprovou (`urlDeEnvio`): o navegador que mandar um byte a mais ou outro
// Content-Type leva 403. É a única trava do envio direto, que não passa pelo CRM.
import "server-only";
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const BUCKET_DOCUMENTOS = "crm-documentos";

let cliente: S3Client | null = null;

// Variáveis lidas na primeira chamada, não no topo: ler no topo quebra o build.
function s3(): S3Client {
  if (cliente) return cliente;
  const faltam = ["NEON_STORAGE_ENDPOINT", "NEON_STORAGE_ACCESS_KEY_ID", "NEON_STORAGE_SECRET_ACCESS_KEY"].filter(
    (v) => !process.env[v],
  );
  if (faltam.length) throw new Error(`Storage sem configuração: falta ${faltam.join(", ")} no ambiente`);
  cliente = new S3Client({
    region: process.env.NEON_STORAGE_REGION || "us-east-1",
    endpoint: process.env.NEON_STORAGE_ENDPOINT,
    credentials: {
      accessKeyId: process.env.NEON_STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.NEON_STORAGE_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
    // Sem isso o SDK manda checksum CRC32 em todo PUT, e o link assinado
    // exigiria do navegador um cabeçalho que ele não sabe calcular.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return cliente;
}

/** O status HTTP de um erro do SDK (404, 412...), ou null se não veio do serviço. */
function statusDoErro(e: unknown): number | null {
  return (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ?? null;
}

/** O tipo que o navegador declarou, se der para assinar: "tipo/subtipo", sem parâmetro nem espaço. */
export function mimeDeEnvio(bruto: unknown): string | null {
  const mime = typeof bruto === "string" ? bruto.trim().toLowerCase() || "application/octet-stream" : "";
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,99}$/.test(mime) ? mime : null;
}

/**
 * Sobe os bytes e devolve o caminho dentro do bucket — que é o que vai para
 * `documentos.caminho`, no lugar do antigo caminho de disco.
 *
 * Nunca sobrescreve (If-None-Match): o nome já é sorteado por quem chama, então
 * colisão aqui significa bug, não arquivo repetido. Falhar é melhor que
 * sobrescrever em silêncio o documento de outra pessoa.
 */
export async function subir(
  bucket: string,
  caminho: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: caminho,
        Body: bytes,
        ContentType: mime || "application/octet-stream",
        IfNoneMatch: "*",
      }),
      // Generoso de propósito: é upload de arquivo, não uma consulta.
      { abortSignal: AbortSignal.timeout(120_000) },
    );
  } catch (e) {
    if (statusDoErro(e) === 412) throw new Error(`Já existe um arquivo em ${bucket}/${caminho}: não sobrescrevo`);
    throw new Error(`O Storage recusou o upload de ${caminho}: ${e instanceof Error ? e.message : e}`);
  }
  return caminho;
}

/** Bytes de um arquivo. `caminho` vem do banco, nunca do usuário. */
export async function baixar(bucket: string, caminho: string): Promise<Buffer> {
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: caminho }), {
      abortSignal: AbortSignal.timeout(60_000),
    });
    return Buffer.from(await r.Body!.transformToByteArray());
  } catch (e) {
    // 404 aqui é o equivalente do ENOENT de antes: a linha existe e o objeto
    // não. Quem chama traduz isso em 410 para a tela.
    throw new Error(`O Storage não devolveu o arquivo (${statusDoErro(e) ?? "sem resposta"}): ${caminho}`);
  }
}

/**
 * URL para o NAVEGADOR subir um objeto direto no Storage, sem passar pelo CRM.
 *
 * Existe por causa dos vídeos: na Vercel o corpo de uma requisição para no
 * ~4,5 MB, e vídeo passa disso fácil (hoje também os anexos de demandas e os
 * documentos da biblioteca sobem assim). O navegador faz um PUT simples com o
 * arquivo no corpo e `Content-Type: arquivo.mime` (app/components/enviar-arquivo.ts).
 * A URL vale 2 h, para ESTE caminho, ESTE tamanho e ESTE tipo — a chave de
 * servidor nunca sai daqui.
 */
export async function urlDeEnvio(
  bucket: string,
  caminho: string,
  arquivo: { mime: string; tamanho: number },
): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: bucket, Key: caminho, ContentType: arquivo.mime, ContentLength: arquivo.tamanho }),
    // Por padrão o Content-Type não entra na assinatura, e o navegador poderia
    // guardar um HTML no lugar da foto. Assinado, outro tipo leva 403.
    { expiresIn: 2 * 3600, signableHeaders: new Set(["content-type"]) },
  );
}

/**
 * URL temporária de LEITURA de um objeto de bucket privado. Aceita Range — é o
 * que deixa o player pular para o meio do vídeo sem baixar tudo antes. Com
 * `baixarComo`, o navegador salva o arquivo com esse nome em vez de abrir.
 */
export async function urlDeLeitura(
  bucket: string,
  caminho: string,
  segundos: number,
  opcoes: { baixarComo?: string } = {},
): Promise<string> {
  const nome = opcoes.baixarComo;
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: caminho,
      ...(nome
        ? {
            // O nome em ASCII para navegador antigo e o original em UTF-8 (RFC 6266).
            ResponseContentDisposition: `attachment; filename="${nome.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
          }
        : {}),
    }),
    { expiresIn: segundos },
  );
}

/** Tamanho e tipo do objeto, ou null se ele não está lá. */
export async function infoDoObjeto(
  bucket: string,
  caminho: string,
): Promise<{ tamanho: number; mime: string } | null> {
  try {
    const h = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: caminho }), {
      abortSignal: AbortSignal.timeout(15_000),
    });
    return { tamanho: Number(h.ContentLength ?? 0), mime: h.ContentType ?? "" };
  } catch (e) {
    if (statusDoErro(e) === 404) return null;
    throw new Error(`O Storage não respondeu sobre ${caminho} (${statusDoErro(e) ?? "sem resposta"})`);
  }
}

/** O bucket está lá e a credencial o enxerga? false quando ele não existe. */
export async function bucketExiste(bucket: string): Promise<boolean> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(15_000) });
    return true;
  } catch (e) {
    if (statusDoErro(e) === 404) return false;
    throw e;
  }
}

/**
 * Deixa o bucket PRIVADO existindo: cria na primeira vez, e depois só confere.
 * Bucket do Neon nasce privado. Nome sempre com o prefixo `crm-`: o CRM só cria
 * os dele, nunca reaproveita bucket de outro uso do projeto.
 */
export async function garantirBucket(bucket: string): Promise<void> {
  if (!bucket.startsWith("crm-")) throw new Error(`Bucket do CRM precisa começar com "crm-": ${bucket}`);
  if (await bucketExiste(bucket)) return;
  try {
    await s3().send(new CreateBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(15_000) });
  } catch (e) {
    // 409: outra instância criou entre a conferência e aqui.
    if (statusDoErro(e) !== 409) throw new Error(`O Storage não criou o bucket ${bucket}: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Copia um objeto dentro do mesmo bucket, sem os bytes passarem pelo CRM. É o
 * que dá a cada cópia da demanda "para todos" o seu próprio arquivo.
 */
export async function copiarObjeto(bucket: string, de: string, para: string): Promise<void> {
  try {
    await s3().send(
      new CopyObjectCommand({ Bucket: bucket, Key: para, CopySource: `${bucket}/${encodeURIComponent(de)}` }),
      { abortSignal: AbortSignal.timeout(60_000) },
    );
  } catch (e) {
    throw new Error(`O Storage não copiou ${de} (${statusDoErro(e) ?? "sem resposta"}): ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Apaga o objeto. NÃO lança quando o arquivo já não está lá: quem chama está
 * removendo um documento, e a linha do banco é a fonte da verdade — falhar
 * aqui só deixaria a linha viva apontando para o vazio.
 */
export async function remover(bucket: string, caminho: string): Promise<void> {
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: caminho }), {
      abortSignal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.error(`[armazenamento] falhei ao apagar ${bucket}/${caminho}:`, e);
  }
}

/**
 * O Storage está no ar? Confere o bucket dos documentos, a chamada mais leve, e
 * devolve o status. É o que o módulo Infra mostra (lib/infra-banco.ts).
 */
export async function situacaoDoStorage(): Promise<{ status: number; mensagem: string | null }> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: BUCKET_DOCUMENTOS }), { abortSignal: AbortSignal.timeout(10_000) });
    return { status: 200, mensagem: null };
  } catch (e) {
    const status = statusDoErro(e);
    if (status === null) throw e;
    return { status, mensagem: (e instanceof Error ? e.message : String(e)).slice(0, 300) || null };
  }
}
