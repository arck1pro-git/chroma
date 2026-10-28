import { NextRequest } from "next/server";
import { FalhaCopiloto, lerFalas, resumirReuniao } from "@/lib/ia/reuniao";
import { lerCorpoJson, pedidoDaExtensao, responder } from "@/lib/reunioes-extensao";
import { fichaVisivel } from "@/lib/reunioes-lead";

// O rascunho do resumo da reunião (lib/ia/reuniao.ts, resumirReuniao). NÃO grava
// nada: o vendedor lê, corrige no painel e só então salva por /encerrar.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const acesso = await pedidoDaExtensao(req, "resumo", "json");
  if (acesso instanceof Response) return acesso;

  const corpo = await lerCorpoJson(req);
  if (!corpo) return responder({ erro: "Corpo inválido." }, 400);
  const falas = lerFalas(corpo.falas, "resumo");
  if (!falas) return responder({ erro: "Transcrição inválida ou grande demais." }, 400);
  if (!falas.length) return responder({ erro: "Não há transcrição para resumir." }, 400);

  let ficha = null;
  if (corpo.contato_id !== undefined && corpo.contato_id !== null) {
    ficha = await fichaVisivel(acesso.usuario, corpo.contato_id);
    if (!ficha) return responder({ erro: "Lead não encontrado." }, 404);
  }

  try {
    return responder({ resumo: await resumirReuniao(ficha, falas) });
  } catch (e) {
    if (e instanceof FalhaCopiloto) return responder({ erro: e.message }, 502);
    throw e;
  }
}
