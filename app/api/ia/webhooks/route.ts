import { NextRequest } from "next/server";
import { ferramentasDeWebhooks, SISTEMA_WEBHOOKS } from "@/lib/ia/webhooks";
import { conversar, historicoDe, texto } from "@/lib/ia/conversa";
import { exigirModuloApi } from "@/lib/auth/dal";
import { conversaCompleta, temIaCompleta } from "@/lib/ia/completa";
import { ferramentasDeTagsESegmentos, REGRAS_DE_TAGS } from "@/lib/ia/tags-segmentos";

// Conversa que MONTA captação. Terceira irmã de /api/ia: aquela só lê o CRM,
// /api/ia/automacoes escreve rascunho de fluxo, e esta escreve webhook, campo e
// ação.
//
// PRESA AO MÓDULO, ao contrário de /api/ia: aqui a conversa só faz sentido para
// quem tem Webhooks, e as ferramentas ESCREVEM. `exigirModuloApi` é a mesma
// checagem que a tela e as server actions fazem — a rota da IA não pode ser a
// porta larga do módulo.
//
// O que ela alcança é o mesmo que a tela alcança, menos apagar: não há
// ferramenta de excluir webhook, campo ou ação (lib/ia/webhooks.ts explica por
// quê), e o segredo de envio não sai daqui.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sessao = await exigirModuloApi("webhooks");
  if (sessao instanceof Response) return sessao;

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "Corpo inválido." }, { status: 400 });
  }

  // O TI conversa no modo completo em qualquer tela (lib/ia/completa.ts).
  if (temIaCompleta(sessao.usuario)) return conversaCompleta({ usuario: sessao.usuario, corpo });

  const pergunta = texto(corpo.pergunta, 4000).trim();
  if (!pergunta) {
    return Response.json({ erro: "Pergunta vazia." }, { status: 400 });
  }

  const { ferramentas, gravou } = ferramentasDeWebhooks();
  // Criar tag e segmento é da tela de Configurações: só entra para quem tem o
  // módulo (lib/ia/tags-segmentos.ts).
  const tags = sessao.usuario.modulos.has("configuracoes") ? ferramentasDeTagsESegmentos() : null;

  return conversar({
    sistema: tags ? `${SISTEMA_WEBHOOKS}\n\nTAGS E SEGMENTOS\n${REGRAS_DE_TAGS}` : SISTEMA_WEBHOOKS,
    ferramentas: [...ferramentas, ...(tags?.ferramentas ?? [])],
    pergunta,
    historico: historicoDe(corpo.historico),
    contexto: texto(corpo.contexto, 500),
    // Só no fim: a tela é renderizada no servidor, e recarregar no meio do
    // stream mostraria o estado anterior à gravação.
    eventosFinais: () => (gravou() || tags?.gravou() ? [{ t: "mudou" }] : []),
  });
}
