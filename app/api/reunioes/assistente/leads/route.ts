import { NextRequest } from "next/server";
import { lerCorpoJson, pedidoDaExtensao, responder } from "@/lib/reunioes-extensao";
import { buscarLeadsDaReuniao, escopoDoLead } from "@/lib/reunioes-lead";

// A busca de lead da extensão de reuniões, para quando a sala não casou com
// nenhuma reunião do CRM (Zoom, evento criado fora do CRM). POST com o termo no
// corpo: nome, telefone ou e-mail não vão para a URL nem para o log. A mesma
// regra da gaveta: busca quem tem Dashboard ou Contatos.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const acesso = await pedidoDaExtensao(req, "leads", "json");
  if (acesso instanceof Response) return acesso;
  if (!escopoDoLead(acesso.usuario)) return responder({ erro: "Seu acesso não inclui Dashboard nem Contatos." }, 403);

  const corpo = await lerCorpoJson(req);
  if (!corpo) return responder({ erro: "Corpo inválido." }, 400);
  const termo = typeof corpo.termo === "string" ? corpo.termo.trim().slice(0, 100) : "";
  if (termo.length < 2) return responder({ leads: [] });
  return responder({ leads: await buscarLeadsDaReuniao(termo) });
}
