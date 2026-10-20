// Entrega o arquivo de um documento: é o `src` da pré-visualização e o alvo do
// botão de baixar.
//
// POR QUE UMA ROTA E NÃO O ARQUIVO EM /public — mesmo motivo de
// /api/midia/[id], e aqui pesa ainda mais: a biblioteca é o acervo comercial da
// empresa (tabela de preços, contrato-modelo, planta). Em /public, qualquer um
// com o caminho baixa tudo sem passar por lugar nenhum. Aqui o acesso passa por
// código, e o código exige sessão com o módulo.
//
// O id na URL é o do DOCUMENTO; o caminho no disco nunca chega ao navegador.
import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { comCaminho, lerArquivo } from "@/lib/documentos";
import { cabecalhosDeArquivo } from "@/lib/arquivo-seguro";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // O CHAT TAMBÉM ABRE ESTA ROTA: quem mandou um PDF na conversa precisa vê-lo
  // no histórico, e exigir o módulo Documentos ali deixaria o anexo cego para
  // quem só atende. Ter qualquer um dos dois basta para LER o arquivo — subir e
  // apagar continuam exigindo Documentos.
  const doc = await exigirModuloApi("documentos");
  const chat = doc instanceof Response ? await exigirModuloApi("chat") : doc;
  if (chat instanceof Response) return chat;

  const { id } = await params;
  const documento = await comCaminho(id);
  if (!documento) return new Response("não encontrado", { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await lerArquivo(documento.caminho);
  } catch (e) {
    // A linha existe e o objeto não veio do Storage: apagado do bucket por
    // fora, ou bucket trocado no env. Vale log — é perda de dado, não erro de
    // uso.
    console.error(`[documentos] ${id} está no banco mas não abriu:`, e);
    return new Response("arquivo indisponível", { status: 410 });
  }

  // ?baixar=1 força o "salvar como" em vez de abrir na aba. A lista usa os dois:
  // o olho pré-visualiza, a seta baixa.
  const anexar = req.nextUrl.searchParams.get("baixar") === "1";
  // O conteúdo de um id nunca muda — substituir um documento é subir outro.
  // HTML/SVG da biblioteca não abre mais na aba (lib/arquivo-seguro.ts).
  return new Response(new Uint8Array(bytes), {
    headers: cabecalhosDeArquivo({
      mime: documento.mime,
      nome: documento.arquivoNome,
      tamanho: bytes.byteLength,
      baixar: anexar,
    }),
  });
}
