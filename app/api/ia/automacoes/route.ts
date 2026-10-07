import { NextRequest } from "next/server";
import { enderecoDoCrm } from "@/lib/endereco";
import {
  blocoDeDocumentos,
  blocoDeVideos,
  ferramentasDoFluxo,
  SISTEMA_AUTOMACOES,
} from "@/lib/ia/automacoes";
import { conversar, historicoDe, texto } from "@/lib/ia/conversa";
import { exigirModuloApi } from "@/lib/auth/dal";
import { conversaCompleta, temIaCompleta } from "@/lib/ia/completa";

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
  const sessao = await exigirModuloApi("automacoes");
  if (sessao instanceof Response) return sessao;
  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "Corpo inválido." }, { status: 400 });
  }

  // O TI conversa no modo completo em qualquer tela (lib/ia/completa.ts). O
  // fluxo aberto vira contexto da tela, não trava as ferramentas.
  if (temIaCompleta(sessao.usuario)) {
    return conversaCompleta({
      usuario: sessao.usuario,
      corpo,
      fluxoAberto: texto(corpo.fluxo_id, 64).trim() || null,
    });
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

  // A biblioteca vai JUNTO do system, montada agora: ela muda a cada upload, e
  // o modelo só consegue anexar o que ele enxerga. Mesmo padrão dos contextos
  // em app/api/ia/route.ts.
  // Os vídeos também: é daqui que o modelo copia o link rastreável que vai na
  // mensagem, já com o domínio deste CRM (tirado do request).
  const [documentos, videos] = await Promise.all([
    blocoDeDocumentos(),
    blocoDeVideos(enderecoDoCrm(req.headers)),
  ]);

  return conversar({
    sistema: [SISTEMA_AUTOMACOES, documentos, videos].join("\n\n"),
    ferramentas,
    pergunta,
    historico: historicoDe(corpo.historico),
    contexto: texto(corpo.contexto, 500),
    // Só no fim: avisar no início da ferramenta faria o builder recarregar o
    // canvas antes de a versão existir, e ele leria o rascunho antigo.
    eventosFinais: () => (gravou() ? [{ t: "mudou" }] : []),
  });
}
