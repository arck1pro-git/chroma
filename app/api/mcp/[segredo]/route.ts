// Conector MCP do CRM: o endereço que se cola no Claude (claude.ai → Conectores
// → Adicionar conector personalizado; ou `claude mcp add --transport http`).
//
//     POST /api/mcp/<MCP_SEGREDO>
//
// Lê funis e leads (lib/mcp/ferramentas.ts) e, desde 2026-10-15, publica e
// agenda posts no Instagram e no Facebook (lib/mcp/ferramentas-postar.ts). As
// duas coisas no MESMO link foi escolha dele ("bota nesse aí essas permissões
// novas"), no lugar de um link só para postar — quem tem este link lê os leads
// E publica em nome da empresa. O protocolo (JSON-RPC sem sessão e sem stream)
// mora em lib/mcp/protocolo.ts.
//
// A TRANCA É O SEGREDO NA URL, e não cabeçalho: o conector personalizado do
// claude.ai não manda cabeçalho próprio, só URL ou OAuth (escolha dele,
// 2026-10-14: link secreto). Sem MCP_SEGREDO configurado a porta fica FECHADA.
// Segredo errado responde 404, igual a rota inexistente. Para cortar o acesso
// de quem tem o link, basta trocar o MCP_SEGREDO na Vercel.
//
// maxDuration de 300 s: o post "para agora" publica no after() desta mesma
// invocação, e vídeo no Instagram espera a Meta processar.
import type { NextRequest } from "next/server";
import { ErroDrive } from "@/lib/google-drive";
import { ErroMeta } from "@/lib/meta";
import { FERRAMENTAS } from "@/lib/mcp/ferramentas";
import { FERRAMENTAS_POSTAR } from "@/lib/mcp/ferramentas-postar";
import { responderMcp, segredoConfere, semCanal, type ServidorMcp } from "@/lib/mcp/protocolo";
import { ErroPost } from "@/lib/social/posts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SERVIDOR: ServidorMcp = {
  nome: "chroma-crm",
  titulo: "AmaanOffice",
  instrucoes:
    "CRM AmaanOffice (Amaan e Arck1Pro). LEADS, só leitura: comece por visao_geral_funis para ver os funis, as etapas e os ids; " +
    "depois use listar_leads (quem está em cada etapa), ficha_lead (um lead a fundo) e movimentacao_funil " +
    "(conversão entre etapas, tempo por etapa e resultado por campanha). " +
    "Telefone e e-mail vêm mascarados e o texto das conversas do WhatsApp não é exposto, só contagens e datas. " +
    "REDES SOCIAIS: criar_post publica agora ou agenda no Instagram e no Facebook dos perfis Fabhricio Ari, AMAAN e Arck1Pro " +
    "(perfis_sociais lista os perfis). A mídia vem do Google Drive da empresa: ache o arquivo com o conector do Drive e passe o link " +
    "ou drive:<id> ao criar_post (link https público também serve). O CRM não guarda cópia: busca na fonte e manda direto para a Meta. " +
    "Acompanhe com listar_posts e ver_post; mude ou cancele o que ainda está agendado com editar_post e cancelar_post; " +
    "o que terminou em erro, repetir_post tenta de novo só nas redes que falharam. " +
    "Publicar é público: confirme com a pessoa o perfil, o texto, as mídias e o horário antes de criar o post. Horários em Brasília.",
  ferramentas: [...FERRAMENTAS, ...FERRAMENTAS_POSTAR],
  // O motivo de uma recusa de post (data no passado, Reels sem vídeo, arquivo
  // do Drive sem acesso, erro da Meta) volta para o modelo corrigir; o resto,
  // que pode trazer detalhe do banco, fica no log.
  mensagemDeErro: (e) =>
    e instanceof ErroPost || e instanceof ErroMeta || e instanceof ErroDrive ? e.message : "Erro no CRM. Tente de novo.",
};

export async function POST(req: NextRequest, ctx: RouteContext<"/api/mcp/[segredo]">) {
  const { segredo } = await ctx.params;
  if (!segredoConfere(segredo, process.env.MCP_SEGREDO)) return new Response("Not Found", { status: 404 });
  return responderMcp(SERVIDOR, req);
}

export const GET = semCanal;
export const DELETE = semCanal;
