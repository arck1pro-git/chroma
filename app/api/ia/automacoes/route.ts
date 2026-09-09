import { NextRequest } from "next/server";
import { ferramentasDoFluxo, SISTEMA_AUTOMACOES } from "@/lib/ia/automacoes";
import { conversar, historicoDe, texto } from "@/lib/ia/conversa";

// Conversa que MONTA automação. Irmã de /api/ia, com uma diferença de postura:
// aquela só lê o CRM, esta escreve — o rascunho do fluxo aberto no builder.
//
// ⚠ Como toda rota deste app, é pública: não há autenticação ainda
// (docs/automacoes-arquitetura.md §3.1). Por isso o teto do que ela alcança é
// rascunho. Publicar continua sendo clique de gente, e é o passo que fala com
// o n8n compartilhado com produção.
//
// O fluxo_id vem do corpo, mas quem o envia é o builder a partir da URL — e as
// ferramentas ficam presas a ele. O modelo não recebe um parâmetro de fluxo,
// então não existe "reescreveu o fluxo errado".

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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

  const fluxoId = texto(corpo.fluxo_id, 64).trim();
  if (!fluxoId) {
    return Response.json({ erro: "Fluxo não informado." }, { status: 400 });
  }

  const { ferramentas, gravou } = ferramentasDoFluxo(fluxoId);

  return conversar({
    sistema: SISTEMA_AUTOMACOES,
    ferramentas,
    pergunta,
    historico: historicoDe(corpo.historico),
    contexto: texto(corpo.contexto, 500),
    // Só no fim: avisar no início da ferramenta faria o builder recarregar o
    // canvas antes de a versão existir, e ele leria o rascunho antigo.
    eventosFinais: () => (gravou() ? [{ t: "mudou" }] : []),
  });
}
