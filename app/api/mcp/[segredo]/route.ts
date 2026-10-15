// Conector MCP do CRM: o endereço que se cola no Claude (claude.ai → Conectores
// → Adicionar conector personalizado; ou `claude mcp add --transport http`).
//
//     POST /api/mcp/<MCP_SEGREDO>
//
// Só leitura. O protocolo (JSON-RPC sem sessão e sem stream) mora em
// lib/mcp/protocolo.ts, junto do conector de postar (app/api/mcp-postar), que
// tem link e segredo próprios.
//
// A TRANCA É O SEGREDO NA URL, e não cabeçalho: o conector personalizado do
// claude.ai não manda cabeçalho próprio, só URL ou OAuth (escolha dele,
// 2026-10-14: link secreto). Sem MCP_SEGREDO configurado a porta fica FECHADA.
// Segredo errado responde 404, igual a rota inexistente. Para cortar o acesso
// de quem tem o link, basta trocar o MCP_SEGREDO na Vercel.
//
// O que as ferramentas devolvem, e o que mascaram, está em lib/mcp/ferramentas.ts.
import type { NextRequest } from "next/server";
import { FERRAMENTAS } from "@/lib/mcp/ferramentas";
import { responderMcp, segredoConfere, semCanal, type ServidorMcp } from "@/lib/mcp/protocolo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SERVIDOR: ServidorMcp = {
  nome: "chroma-crm",
  titulo: "AmaanOffice",
  instrucoes:
    "CRM AmaanOffice (Amaan e Arck1Pro), só leitura. Comece por visao_geral_funis para ver os funis, as etapas e os ids; " +
    "depois use listar_leads (quem está em cada etapa), ficha_lead (um lead a fundo) e movimentacao_funil " +
    "(conversão entre etapas, tempo por etapa e resultado por campanha). Horários em Brasília. " +
    "Telefone e e-mail vêm mascarados e o texto das conversas do WhatsApp não é exposto, só contagens e datas.",
  ferramentas: FERRAMENTAS,
  mensagemDeErro: () => "Erro ao consultar o CRM. Tente de novo.",
};

export async function POST(req: NextRequest, ctx: RouteContext<"/api/mcp/[segredo]">) {
  const { segredo } = await ctx.params;
  if (!segredoConfere(segredo, process.env.MCP_SEGREDO)) return new Response("Not Found", { status: 404 });
  return responderMcp(SERVIDOR, req);
}

export const GET = semCanal;
export const DELETE = semCanal;
