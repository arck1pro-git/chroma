import { NextRequest } from "next/server";
import { ferramentasDeWebhooks, SISTEMA_WEBHOOKS } from "@/lib/ia/webhooks";
import { conversar, historicoDe, texto } from "@/lib/ia/conversa";
import { exigirModuloApi } from "@/lib/auth/dal";

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

  const pergunta = texto(corpo.pergunta, 4000).trim();
  if (!pergunta) {
    return Response.json({ erro: "Pergunta vazia." }, { status: 400 });
  }

  const { ferramentas, gravou } = ferramentasDeWebhooks();

  return conversar({
    sistema: SISTEMA_WEBHOOKS,
    ferramentas,
    pergunta,
    historico: historicoDe(corpo.historico),
    contexto: texto(corpo.contexto, 500),
    // Só no fim: a tela é renderizada no servidor, e recarregar no meio do
    // stream mostraria o estado anterior à gravação.
    eventosFinais: () => (gravou() ? [{ t: "mudou" }] : []),
  });
}
