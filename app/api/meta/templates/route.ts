import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { comCaminho, lerArquivo } from "@/lib/documentos";
import { criarTemplateMeta, respostaErroMeta, subirExemploDeTemplate, wabasMeta } from "@/lib/meta";
import {
  componentesDoRascunho,
  IDIOMA_PADRAO,
  midiaDoRascunho,
  problemaDoExemploDoCabecalho,
  problemasDo,
} from "@/lib/templates-whatsapp";
import { entradaDaCriacao } from "@/lib/templates-whatsapp-criacao";

export const dynamic = "force-dynamic";

// Só criação. A leitura saiu daqui em 2026-10-27: a tela lê no servidor
// (app/templates/dados.ts) e o GET antigo, sem chamador, repassava o `waba` da
// URL direto para o caminho da Graph.
//
// O formato é o do editor (app/templates/editor.tsx), lido por entradaDaCriacao
// (lib/templates-whatsapp-criacao.ts); as regras da Meta são as de problemasDo,
// as mesmas que o editor mostra enquanto se digita.
//
// Cabeçalho de imagem, vídeo ou PDF (2026-10-28): o exemplo é um documento da
// biblioteca, então pede também o módulo Documentos, como o envio com arquivo
// nas campanhas. O arquivo é conferido de novo aqui (existe, não arquivado,
// tipo, formato e tamanho) e sobe para a Meta só depois da conta conferida.

export async function POST(req: NextRequest) {
  const acesso = await exigirModuloApi("templates", "criar");
  if (acesso instanceof Response) return acesso;
  const lido = entradaDaCriacao.safeParse(await req.json().catch(() => null));
  if (!lido.success) return Response.json({ erro: "Os dados do template vieram incompletos." }, { status: 400 });
  const { waba, ...rascunho } = lido.data;
  const problema = problemasDo(rascunho)[0];
  if (problema) return Response.json({ erro: problema.mensagem }, { status: 400 });

  const midia = midiaDoRascunho(rascunho);
  const doc = midia ? await comCaminho(rascunho.midiaCabecalho.trim()) : null;
  if (midia) {
    if (!acesso.usuario.modulos.has("documentos")) {
      return Response.json({ erro: "O arquivo do cabeçalho vem da biblioteca, e seu acesso não inclui Documentos." }, { status: 403 });
    }
    if (!doc) return Response.json({ erro: "O arquivo do cabeçalho não está mais na biblioteca." }, { status: 400 });
    const recusa = problemaDoExemploDoCabecalho(midia, doc);
    if (recusa) return Response.json({ erro: recusa }, { status: 400 });
  }

  try {
    // A conta vem do navegador: só vale uma das que o token da Meta enxerga.
    if (!(await wabasMeta()).some((w) => w.id === waba)) {
      return Response.json({ erro: "Conta do WhatsApp desconhecida." }, { status: 400 });
    }
    const exemplo = doc ? await subirExemploDeTemplate(await lerArquivo(doc.caminho), doc.mime, doc.arquivoNome) : undefined;
    const resultado = await criarTemplateMeta(waba, {
      name: rascunho.nome.trim(),
      language: IDIOMA_PADRAO,
      category: rascunho.categoria,
      components: componentesDoRascunho(rascunho, exemplo),
    });
    // Template é a voz pública da marca e não guarda autor na Meta: fica no log quem criou.
    console.info("[templates] criado", {
      usuario: acesso.usuario.id, waba, nome: rascunho.nome.trim(), id: resultado.id, cabecalho: rascunho.formatoCabecalho, documento: doc?.id,
    });
    return Response.json({ ok: true, resultado }, { status: 201 });
  } catch (e) { return respostaErroMeta(e); }
}
