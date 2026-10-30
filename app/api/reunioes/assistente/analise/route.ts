import { NextRequest } from "next/server";
import { analisarReuniao, FalhaCopiloto, lerAnterior, lerFalas } from "@/lib/ia/reuniao";
import { lerCorpoJson, pedidoDaExtensao, responder } from "@/lib/reunioes-extensao";
import { fichaVisivel } from "@/lib/reunioes-lead";

// O copiloto da reunião (lib/ia/reuniao.ts): a extensão manda as falas mais
// recentes (e a sugestão que já está na tela) e recebe a objeção, a condução e
// se há novidade. Sem lead, a análise roda só com a transcrição. Com lead, a
// ficha é lida no servidor pelo id, com o que o acesso da pessoa deixa ver
// (lib/reunioes-lead.ts).

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const acesso = await pedidoDaExtensao(req, "analise", "json");
  if (acesso instanceof Response) return acesso;

  const corpo = await lerCorpoJson(req);
  if (!corpo) return responder({ erro: "Corpo inválido." }, 400);
  const falas = lerFalas(corpo.falas, "analise");
  if (!falas) return responder({ erro: "Transcrição inválida ou grande demais." }, 400);
  const anterior = lerAnterior(corpo.anterior);
  if (anterior === undefined) return responder({ erro: "Sugestão anterior inválida." }, 400);

  let ficha = null;
  if (corpo.contato_id !== undefined && corpo.contato_id !== null) {
    ficha = await fichaVisivel(acesso.usuario, corpo.contato_id);
    if (!ficha) return responder({ erro: "Lead não encontrado." }, 404);
  }

  try {
    return responder({ analise: await analisarReuniao(ficha, falas, anterior) });
  } catch (e) {
    if (e instanceof FalhaCopiloto) return responder({ erro: e.message }, 502);
    throw e;
  }
}
