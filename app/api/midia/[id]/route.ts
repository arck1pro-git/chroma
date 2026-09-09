// Entrega o arquivo de uma mensagem: é o `src` das imagens, áudios e links de
// documento do chat.
//
// POR QUE UMA ROTA E NÃO O ARQUIVO DIRETO: a mídia fica fora de /public de
// propósito. Conversa de cliente não pode ser servida por URL adivinhável — em
// /public, qualquer um com o caminho baixa o áudio de um lead sem passar por
// lugar nenhum. Aqui o acesso passa por código, e é onde a checagem de sessão
// entra quando houver login (hoje não há: docs/automacoes-arquitetura §3.1, o
// app inteiro é aberto).
//
// O id na URL é o da MENSAGEM, não o do arquivo: o caminho no disco nunca
// aparece para o navegador, então não há como pedir um arquivo que não seja o
// anexo de uma mensagem existente.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { lerArquivo } from "@/lib/midia";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Formato antes do banco: sem isto, um id inválido vira erro de sintaxe de
  // uuid do Postgres (500) em vez de um 404 honesto.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("não encontrado", { status: 404 });
  }

  const [msg] = await sql`
    SELECT midia_caminho, midia_mime, midia_nome, midia_estado, midia_erro
    FROM mensagens WHERE id = ${id}`;

  if (!msg) return new Response("não encontrado", { status: 404 });

  if (msg.midia_estado !== "salva" || !msg.midia_caminho) {
    // 409 e não 404: o arquivo EXISTE do lado do cliente, só não chegou aqui
    // ainda (ou falhou). A tela usa essa diferença para mostrar "baixando…" em
    // vez de "anexo removido".
    return Response.json(
      {
        estado: msg.midia_estado,
        erro: msg.midia_erro ?? null,
      },
      { status: 409 },
    );
  }

  let bytes: Buffer;
  try {
    bytes = await lerArquivo(msg.midia_caminho as string);
  } catch (e) {
    // A linha diz 'salva' e o arquivo não está lá: disco limpo por deploy, ou
    // MIDIA_DIR apontando para outro lugar. Vale log — é perda de dado, não
    // erro de uso.
    console.error(`[midia] ${id} marcado como salvo mas não abriu:`, e);
    return new Response("arquivo indisponível", { status: 410 });
  }

  const nome = (msg.midia_nome as string | null) ?? `anexo-${id}`;

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": (msg.midia_mime as string | null) ?? "application/octet-stream",
      "content-length": String(bytes.byteLength),
      // inline: imagem e áudio tocam na própria página. O nome só importa
      // quando a pessoa escolhe baixar, e o navegador o usa mesmo assim.
      "content-disposition": `inline; filename="${nome.replace(/["\\]/g, "")}"`,
      // Mídia de WhatsApp é imutável: uma vez salva, aquele id nunca muda de
      // conteúdo. Cache privado, porque é conversa de cliente.
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
