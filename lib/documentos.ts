// Biblioteca de documentos: guardar o arquivo uma vez e usar em qualquer lugar.
//
// POR QUE ESTE ARQUIVO EXISTE: o CRM sabia receber mídia do cliente
// (lib/midia.ts) e não sabia MANDAR nenhuma. Quem precisava enviar a tabela de
// preços dependia do arquivo estar na máquina dele, e aí cada um mandava a
// versão que tinha. Aqui o arquivo entra uma vez e passa a ser escolhível na
// cadência e no chat.
//
// SEPARADO DE lib/midia.ts DE PROPÓSITO, embora o storage seja parecido. São
// dois ciclos de vida opostos: mídia de atendimento CHEGA (fila de download,
// URL que expira, retentativa) e é registro imutável de uma conversa; documento
// é ACERVO — alguém sobe, renomeia, arquiva, e o mesmo arquivo sai mil vezes.
// Juntar os dois faria a fila de download carregar regra de acervo e vice-versa.
//
// ONDE FICA O ARQUIVO: Supabase Storage, bucket `crm-documentos`
// (lib/armazenamento.ts). Era disco local até 2026-09-18, e a troca não foi
// preferência — era bug: o CRM roda na Vercel, onde não há disco gravável, e a
// primeira cadência com anexo morreu com ENOENT apontando para um arquivo que
// só existia na máquina de quem subiu. Ver o cabeçalho de lib/armazenamento.ts.
//
// `caminho` continua guardando um caminho RELATIVO, e é por isso que a troca
// foi de adaptador e não de schema: mudou o que lê e escreve os bytes, não o
// que a tabela guarda.
import "server-only";
import path from "path";
import { sql } from "@/lib/db";
import { BUCKET_DOCUMENTOS, baixar, remover, subir } from "@/lib/armazenamento";

/** O que a uazapi precisa saber para escolher como a mídia chega no WhatsApp. */
export type TipoDocumento = "imagem" | "video" | "audio" | "documento";

export type Documento = {
  id: string;
  nome: string;
  descricao: string | null;
  arquivoNome: string;
  mime: string;
  tamanho: number;
  tipo: TipoDocumento;
  criadoPor: string | null;
  autor: string | null;
  dataCriacao: string;
  arquivado: boolean;
};

/** O que o envio precisa e a tela não: o caminho do objeto no bucket. */
type DocumentoComCaminho = Documento & { caminho: string };

// Teto por arquivo. 32 MB é o mesmo de lib/midia.ts, e não é coincidência: o
// WhatsApp recusa documento acima de ~100 MB, mas o gargalo real aqui é o
// envio em base64 (ver `enviarMidia` em lib/uazapi.ts) — o arquivo vira ~1,37×
// de JSON na memória do processo a cada disparo.
const TETO_BYTES = Number(process.env.DOCUMENTOS_TETO_MB ?? 32) * 1024 * 1024;

export const TETO_MB = Math.round(TETO_BYTES / 1024 / 1024);

/**
 * Como esta mídia deve chegar no WhatsApp.
 *
 * O padrão é 'documento' e isso importa: um tipo desconhecido vira anexo com
 * nome de arquivo, que é o formato que NUNCA perde informação. Chutar 'imagem'
 * para algo que não abre como imagem faria o WhatsApp recusar o envio inteiro.
 */
export function tipoDeMime(mime: string, nome: string): TipoDocumento {
  const base = (mime || "").split(";")[0].trim().toLowerCase();

  // webp/sticker entra como imagem: `sticker` da uazapi exige quadrado e
  // transparência, e um webp comum mandado como sticker chega cortado.
  if (/^image\//.test(base)) return "imagem";
  if (/^video\//.test(base)) return "video";
  if (/^audio\//.test(base)) return "audio";
  if (base && base !== "application/octet-stream") return "documento";

  // Sem mime confiável (upload de navegador antigo, ou octet-stream): a
  // extensão é o segundo palpite. É pior que o mime e melhor que nada.
  const ext = path.extname(nome).toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp|heic|avif)$/.test(ext)) return "imagem";
  if (/\.(mp4|mov|avi|mkv|webm|3gp)$/.test(ext)) return "video";
  if (/\.(mp3|ogg|opus|m4a|wav|aac)$/.test(ext)) return "audio";
  return "documento";
}

// Nome de arquivo vindo do navegador é entrada NÃO CONFIÁVEL: ele decide o
// `docName` que sai no WhatsApp e a extensão do objeto. Barra, backslash
// e caractere de controle saem; o resto é preservado, inclusive acento, porque
// é isto que o lead vê do outro lado.
function nomeSeguro(bruto: string): string {
  const limpo = (bruto || "")
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "")
    .trim()
    .slice(0, 180);
  return limpo || "arquivo";
}

/**
 * Bytes de um documento. `caminho` vem do banco, NUNCA do usuário.
 *
 * A normalização continua aqui mesmo com o arquivo fora do disco: o caminho vai
 * para dentro de uma URL do Storage, e um `..` no meio dele pediria objeto de
 * outra pasta do bucket. É uma linha, e fecha a porta antes de alguém ligar um
 * parâmetro de rota direto nela.
 */
export async function lerArquivo(caminho: string): Promise<Buffer> {
  const seguro = caminho
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
  return baixar(BUCKET_DOCUMENTOS, seguro);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function daLinha(l: any): DocumentoComCaminho {
  return {
    id: l.id,
    nome: l.nome,
    descricao: l.descricao ?? null,
    arquivoNome: l.arquivo_nome,
    caminho: l.caminho,
    mime: l.mime,
    tamanho: Number(l.tamanho),
    tipo: l.tipo,
    criadoPor: l.criado_por ?? null,
    autor: l.autor ?? null,
    dataCriacao: String(l.data_criacao),
    arquivado: l.arquivado === true,
  };
}

// `caminho` não viaja para a tela: ela não tem o que fazer com ele, e o que não
// sai do servidor não vaza. Quem entrega o arquivo é a rota, pelo id.
function semCaminho(d: DocumentoComCaminho): Documento {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { caminho: _caminho, ...resto } = d;
  return resto;
}

export async function listarDocumentos(
  incluirArquivados = false,
): Promise<Documento[]> {
  const linhas = incluirArquivados
    ? await sql`
        SELECT d.id, d.nome, d.descricao, d.arquivo_nome, d.caminho, d.mime,
               d.tamanho, d.tipo, d.criado_por, d.data_criacao, d.arquivado,
               u.nome AS autor
          FROM documentos d
          LEFT JOIN usuarios u ON u.id = d.criado_por
         ORDER BY d.arquivado, d.data_criacao DESC`
    : await sql`
        SELECT d.id, d.nome, d.descricao, d.arquivo_nome, d.caminho, d.mime,
               d.tamanho, d.tipo, d.criado_por, d.data_criacao, d.arquivado,
               u.nome AS autor
          FROM documentos d
          LEFT JOIN usuarios u ON u.id = d.criado_por
         WHERE d.arquivado = false
         ORDER BY d.data_criacao DESC`;
  return linhas.map((l) => semCaminho(daLinha(l)));
}

/**
 * Os que podem ser ANEXADOS agora. Arquivado fica de fora: a lista existe para
 * escolher o que ainda vale mandar, e oferecer a tabela de preços do ano passado
 * é exatamente o erro que arquivar serve para evitar.
 */
export async function documentosEscolhiveis(): Promise<Documento[]> {
  return listarDocumentos(false);
}

/** Só para quem vai LER o arquivo (a rota que entrega, o envio). */
export async function comCaminho(
  id: string,
): Promise<DocumentoComCaminho | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [l] = await sql`
    SELECT d.id, d.nome, d.descricao, d.arquivo_nome, d.caminho, d.mime,
           d.tamanho, d.tipo, d.criado_por, d.data_criacao, d.arquivado,
           u.nome AS autor
      FROM documentos d
      LEFT JOIN usuarios u ON u.id = d.criado_por
     WHERE d.id = ${id}`;
  return l ? daLinha(l) : null;
}

export async function documentoPorId(id: string): Promise<Documento | null> {
  const d = await comCaminho(id);
  return d ? semCaminho(d) : null;
}

/**
 * Sobe os bytes para o Storage e grava a linha no banco.
 *
 * O STORAGE VEM ANTES DO BANCO, e a ordem não é arbitrária: invertida, uma
 * falha de upload deixaria uma linha apontando para um objeto que não existe —
 * e isso só apareceria no dia em que alguém tentasse mandar o documento para um
 * lead, que foi exatamente como o bug do disco local apareceu. Nesta ordem, a
 * falha do banco deixa um objeto órfão no bucket, que não quebra nada e não
 * engana ninguém (e o catch abaixo ainda o remove).
 */
export async function criarDocumento(dados: {
  nome: string;
  descricao: string | null;
  arquivoNome: string;
  mime: string;
  bytes: Uint8Array;
  criadoPor: string | null;
}): Promise<Documento> {
  const { bytes } = dados;
  if (bytes.byteLength === 0) throw new Error("Arquivo vazio.");
  if (bytes.byteLength > TETO_BYTES) {
    throw new Error(`Arquivo acima do limite de ${TETO_MB} MB.`);
  }

  const arquivoNome = nomeSeguro(dados.arquivoNome);
  const mime = (dados.mime || "application/octet-stream").split(";")[0].trim();
  const tipo = tipoDeMime(mime, arquivoNome);

  // Pasta por ano/mês: mantém o bucket navegável quando forem milhares de
  // arquivos, em vez de uma pasta só com tudo dentro. Separador literal "/" —
  // é caminho de objeto no Storage, não do sistema de arquivos, então `path.join`
  // aqui produziria "\" no Windows e quebraria a URL.
  const agora = new Date();
  const pasta = `${agora.getUTCFullYear()}/${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
  // Nome do objeto é sorteado, não é o do usuário: dois "contrato.pdf" não podem
  // se sobrescrever, e o nome original já está guardado na coluna.
  const unico = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const caminho = `${pasta}/${unico}${path.extname(arquivoNome)}`;

  await subir(BUCKET_DOCUMENTOS, caminho, bytes, mime);

  try {
    const [l] = await sql`
      INSERT INTO documentos
        (nome, descricao, arquivo_nome, caminho, mime, tamanho, tipo, criado_por)
      VALUES
        (${dados.nome}, ${dados.descricao}, ${arquivoNome}, ${caminho},
         ${mime}, ${bytes.byteLength}, ${tipo}, ${dados.criadoPor})
      RETURNING id, nome, descricao, arquivo_nome, caminho, mime, tamanho,
                tipo, criado_por, data_criacao, arquivado`;
    return semCaminho(daLinha({ ...l, autor: null }));
  } catch (e) {
    // A linha não entrou: o objeto no bucket é lixo, e lixo que ninguém
    // referencia é lixo que ninguém vai limpar depois. Some com ele agora.
    await remover(BUCKET_DOCUMENTOS, caminho);
    throw e;
  }
}

export async function renomearDocumento(
  id: string,
  nome: string,
  descricao: string | null,
): Promise<void> {
  await sql`
    UPDATE documentos SET nome = ${nome}, descricao = ${descricao}
     WHERE id = ${id}`;
}

export async function arquivarDocumento(
  id: string,
  arquivado: boolean,
): Promise<void> {
  await sql`UPDATE documentos SET arquivado = ${arquivado} WHERE id = ${id}`;
}

/** Em quantas mensagens já enviadas este documento aparece. */
export async function usosDoDocumento(id: string): Promise<number> {
  const [linha] = await sql`
    SELECT count(*)::int AS n FROM mensagens WHERE documento_id = ${id}`;
  return (linha?.n as number) ?? 0;
}

/**
 * Exclui de vez: a linha e o arquivo.
 *
 * FALHA quando o documento está em alguma mensagem — é o ON DELETE RESTRICT da
 * migração, e quem chama traduz isso em "arquive em vez de excluir". Apagar aqui
 * esvaziaria o anexo de uma conversa já entregue, e histórico de atendimento não
 * se reescreve.
 */
export async function excluirDocumento(id: string): Promise<void> {
  const doc = await comCaminho(id);
  if (!doc) return;

  // O banco primeiro, ao contrário de criar — e de novo a ordem é o argumento:
  // o DELETE é quem pode ser RECUSADO pela FK. Apagando o arquivo antes, uma
  // recusa deixaria a linha viva apontando para o vazio.
  await sql`DELETE FROM documentos WHERE id = ${id}`;
  await remover(BUCKET_DOCUMENTOS, doc.caminho);
}

/**
 * O documento pronto para viajar até a uazapi: base64, tipo e nome.
 *
 * BASE64 E NÃO URL. A uazapi aceita os dois (`file` em POST /send/media), e a
 * URL seria mais leve — mas exigiria que o arquivo ficasse acessível SEM sessão
 * para um servidor de fora baixar. Isso é o contrário do que a biblioteca é: o
 * acervo comercial da empresa, atrás de login. Os bytes saem daqui, pela
 * conexão que já é autenticada com a instância.
 *
 * O CUSTO, dito onde dói: o arquivo inteiro passa pela memória do processo e
 * cresce ~1,37× ao virar base64. É o que o teto de DOCUMENTOS_TETO_MB segura.
 */
export async function paraEnvio(id: string): Promise<{
  base64: string;
  tipo: TipoDocumento;
  mime: string;
  arquivoNome: string;
  nome: string;
} | null> {
  const doc = await comCaminho(id);
  if (!doc) return null;
  const bytes = await lerArquivo(doc.caminho);
  return {
    base64: bytes.toString("base64"),
    tipo: doc.tipo,
    mime: doc.mime,
    arquivoNome: doc.arquivoNome,
    nome: doc.nome,
  };
}
