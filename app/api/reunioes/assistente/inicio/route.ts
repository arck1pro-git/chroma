import { NextRequest } from "next/server";
import { lerCorpoJson, pedidoDaExtensao, responder } from "@/lib/reunioes-extensao";
import { acessoAFicha, escopoDoLead, fichaDoLead, fichaVisivel, leadDaSala, type FichaLead } from "@/lib/reunioes-lead";

// O começo da reunião na extensão do Chrome (extensao-reunioes/): quem é o lead
// desta sala. Com `sala` (o endereço da reunião), tenta casar com uma reunião do
// CRM e devolve também as reuniões de hoje, para a escolha à mão; com
// `contato_id`, é a escolha feita. A porta (Origin da extensão, módulo Agenda,
// freio) está em lib/reunioes-extensao.ts; o que se vê do lead, em
// lib/reunioes-lead.ts.
//
// Para a tela vão só nome e resumo: a conversa do WhatsApp e as anotações ficam
// no servidor, que as relê a cada análise.

export const dynamic = "force-dynamic";

const paraTela = (f: FichaLead) => ({ contatoId: f.contatoId, nome: f.nome, resumo: f.resumo });

export async function POST(req: NextRequest) {
  const acesso = await pedidoDaExtensao(req, "inicio", "json");
  if (acesso instanceof Response) return acesso;
  const { usuario } = acesso;

  const corpo = await lerCorpoJson(req);
  if (!corpo) return responder({ erro: "Corpo inválido." }, 400);

  const escopo = escopoDoLead(usuario);
  if (corpo.contato_id !== undefined) {
    if (!escopo) return responder({ erro: "Seu acesso não inclui Dashboard nem Contatos." }, 403);
    const ficha = await fichaVisivel(usuario, corpo.contato_id);
    if (!ficha) return responder({ erro: "Lead não encontrado." }, 404);
    return responder({ lead: paraTela(ficha), candidatos: [] });
  }

  const sala = typeof corpo.sala === "string" ? corpo.sala.slice(0, 500) : "";
  const { contatoId, candidatos } = await leadDaSala(usuario, sala);
  const ficha = contatoId && escopo ? await fichaDoLead(contatoId, acessoAFicha(usuario, escopo)) : null;
  return responder({ lead: ficha ? paraTela(ficha) : null, candidatos });
}
