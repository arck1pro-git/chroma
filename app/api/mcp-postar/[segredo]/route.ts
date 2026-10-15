// Conector MCP de POSTAR nas redes: publicar e agendar no Instagram e no
// Facebook dos perfis da empresa (pedido dele, 2026-10-15, para sair do
// Metricool). Cola-se no Claude como outro conector personalizado:
//
//     POST /api/mcp-postar/<MCP_SEGREDO_POSTAR>
//
// LINK SEPARADO do de leitura (escolha dele): o de leitura pode ser passado a
// outras pessoas sem risco; este publica em nome da empresa e fica só com ele.
// Mesma tranca do outro — o segredo na URL, mínimo de 32 caracteres, 404 com
// segredo errado, porta fechada sem a variável. Trocar o MCP_SEGREDO_POSTAR na
// Vercel corta o acesso de quem tem o link.
//
// maxDuration de 300 s: o post "para agora" publica no after() desta mesma
// invocação, e vídeo no Instagram espera a Meta processar.
import type { NextRequest } from "next/server";
import { FERRAMENTAS_POSTAR } from "@/lib/mcp/ferramentas-postar";
import { responderMcp, segredoConfere, semCanal, type ServidorMcp } from "@/lib/mcp/protocolo";
import { mensagemDeErroDoPost } from "@/lib/social/posts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SERVIDOR: ServidorMcp = {
  nome: "amaanoffice-postar",
  titulo: "AmaanOffice · Redes sociais",
  instrucoes:
    "Publica e agenda posts no Instagram e no Facebook dos perfis Fabhricio Ari, AMAAN e Arck1Pro. " +
    "Comece por perfis_sociais. criar_post publica agora ou agenda (horário de Brasília); as mídias são links https públicos, que o CRM copia na hora. " +
    "Acompanhe com listar_posts e ver_post; mude ou cancele o que ainda está agendado com editar_post e cancelar_post; " +
    "o que terminou em erro, repetir_post tenta de novo só nas redes que falharam. " +
    "Publicar é público: confirme com a pessoa o perfil, o texto, as mídias e o horário antes de criar o post.",
  ferramentas: FERRAMENTAS_POSTAR,
  mensagemDeErro: mensagemDeErroDoPost,
};

export async function POST(req: NextRequest, ctx: RouteContext<"/api/mcp-postar/[segredo]">) {
  const { segredo } = await ctx.params;
  if (!segredoConfere(segredo, process.env.MCP_SEGREDO_POSTAR)) return new Response("Not Found", { status: 404 });
  return responderMcp(SERVIDOR, req);
}

export const GET = semCanal;
export const DELETE = semCanal;
