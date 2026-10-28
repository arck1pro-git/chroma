import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { criarTemplateMeta, respostaErroMeta, wabasMeta } from "@/lib/meta";
import { componentesDoRascunho, IDIOMA_PADRAO, problemasDo } from "@/lib/templates-whatsapp";
import { entradaDaCriacao } from "@/lib/templates-whatsapp-criacao";

export const dynamic = "force-dynamic";

// Só criação. A leitura saiu daqui em 2026-10-27: a tela lê no servidor
// (app/templates/dados.ts) e o GET antigo, sem chamador, repassava o `waba` da
// URL direto para o caminho da Graph.
//
// O formato é o do editor (app/templates/editor.tsx), lido por entradaDaCriacao
// (lib/templates-whatsapp-criacao.ts); as regras da Meta são as de problemasDo,
// as mesmas que o editor mostra enquanto se digita.

export async function POST(req: NextRequest) {
  const acesso = await exigirModuloApi("templates", "criar");
  if (acesso instanceof Response) return acesso;
  const lido = entradaDaCriacao.safeParse(await req.json().catch(() => null));
  if (!lido.success) return Response.json({ erro: "Os dados do template vieram incompletos." }, { status: 400 });
  const { waba, ...rascunho } = lido.data;
  const problema = problemasDo(rascunho)[0];
  if (problema) return Response.json({ erro: problema.mensagem }, { status: 400 });
  try {
    // A conta vem do navegador: só vale uma das que o token da Meta enxerga.
    if (!(await wabasMeta()).some((w) => w.id === waba)) {
      return Response.json({ erro: "Conta do WhatsApp desconhecida." }, { status: 400 });
    }
    const resultado = await criarTemplateMeta(waba, {
      name: rascunho.nome.trim(),
      language: IDIOMA_PADRAO,
      category: rascunho.categoria,
      components: componentesDoRascunho(rascunho),
    });
    // Template é a voz pública da marca e não guarda autor na Meta: fica no log quem criou.
    console.info("[templates] criado", { usuario: acesso.usuario.id, waba, nome: rascunho.nome.trim(), id: resultado.id });
    return Response.json({ ok: true, resultado }, { status: 201 });
  } catch (e) { return respostaErroMeta(e); }
}
