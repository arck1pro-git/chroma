// Conector MCP do CRM: o endereço que se cola no Claude (claude.ai → Conectores
// → Adicionar conector personalizado; ou `claude mcp add --transport http`).
//
//     POST /api/mcp/<MCP_SEGREDO>
//
// O protocolo é o Streamable HTTP do MCP, na forma mais simples que ele
// permite: SEM SESSÃO e SEM STREAM. Cada POST traz uma mensagem JSON-RPC e
// volta com a resposta em JSON. Não há nada para empurrar do servidor (as
// ferramentas só leem), então o GET que abriria o canal SSE responde 405, como
// a especificação prevê. Escrito à mão, sem o SDK: são quatro métodos.
//
// A TRANCA É O SEGREDO NA URL, e não cabeçalho: o conector personalizado do
// claude.ai não manda cabeçalho próprio, só URL ou OAuth (escolha dele,
// 2026-10-14: link secreto). Sem MCP_SEGREDO configurado a porta fica FECHADA.
// Segredo errado responde 404, igual a rota inexistente. Para cortar o acesso
// de quem tem o link, basta trocar o MCP_SEGREDO na Vercel.
//
// O que as ferramentas devolvem, e o que mascaram, está em lib/mcp/ferramentas.ts.
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { FERRAMENTAS, esquemaDeEntrada } from "@/lib/mcp/ferramentas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Da mais nova para a mais velha. Cliente que pede uma destas recebe a mesma;
// qualquer outra recebe a primeira, e o cliente decide se segue.
const VERSOES = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCOES =
  "CRM AmaanOffice (Amaan e Arck1Pro), só leitura. Comece por visao_geral_funis para ver os funis, as etapas e os ids; " +
  "depois use listar_leads (quem está em cada etapa), ficha_lead (um lead a fundo) e movimentacao_funil " +
  "(conversão entre etapas, tempo por etapa e resultado por campanha). Horários em Brasília. " +
  "Telefone e e-mail vêm mascarados e o texto das conversas do WhatsApp não é exposto, só contagens e datas.";

function segredoConfere(recebido: string): boolean {
  const esperado = process.env.MCP_SEGREDO;
  // Segredo curto demais é tratado como ausente: um valor de teste esquecido na
  // Vercel não pode virar a única tranca dos dados dos leads.
  if (!esperado || esperado.length < 32) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Id = string | number | null;
type Mensagem = { jsonrpc?: unknown; id?: Id; method?: unknown; params?: Record<string, unknown> };

const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const falha = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** A resposta a uma mensagem; null quando ela não pede resposta (notificação). */
async function atender(bruta: unknown): Promise<object | null> {
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) return falha(null, -32600, "Requisição inválida.");
  const { id, method, params } = bruta as Mensagem;
  // Sem id é notificação (notifications/initialized, cancelled...); sem method
  // é uma resposta do cliente. Nenhuma das duas leva resposta.
  if (id === undefined || id === null || typeof method !== "string") return null;

  switch (method) {
    case "initialize": {
      const pedida = params?.protocolVersion;
      return ok(id, {
        protocolVersion: typeof pedida === "string" && VERSOES.includes(pedida) ? pedida : VERSOES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "chroma-crm", title: "AmaanOffice", version: "1.0.0" },
        instructions: INSTRUCOES,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: FERRAMENTAS.map((f) => ({
          name: f.nome,
          title: f.titulo,
          description: f.descricao,
          inputSchema: esquemaDeEntrada(f),
          annotations: { title: f.titulo, readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const ferramenta = FERRAMENTAS.find((f) => f.nome === params?.name);
      if (!ferramenta) return falha(id, -32602, `Ferramenta desconhecida: ${String(params?.name)}`);
      // Argumento errado volta como resultado com isError, não como erro de
      // protocolo: assim o modelo lê o motivo e corrige a chamada sozinho.
      const args = ferramenta.entrada.safeParse(params?.arguments ?? {});
      if (!args.success) {
        const motivo = args.error.issues.map((i) => `${i.path.join(".") || "argumentos"}: ${i.message}`).join("; ");
        return ok(id, { content: [{ type: "text", text: `Argumentos inválidos — ${motivo}` }], isError: true });
      }
      const inicio = Date.now();
      try {
        const resultado = await ferramenta.executar(args.data as never);
        // Auditoria: QUAL ferramenta e quanto tempo, nunca os argumentos (podem
        // ter nome de lead) nem o resultado.
        console.log(`[mcp] ${ferramenta.nome} ${Date.now() - inicio}ms`);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(resultado) }] });
      } catch (e) {
        console.error(`[mcp] ${ferramenta.nome} falhou:`, e);
        return ok(id, { content: [{ type: "text", text: "Erro ao consultar o CRM. Tente de novo." }], isError: true });
      }
    }
    default:
      return falha(id, -32601, `Método não suportado: ${method}`);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/mcp/[segredo]">) {
  const { segredo } = await ctx.params;
  if (!segredoConfere(segredo)) return new Response("Not Found", { status: 404 });

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json(falha(null, -32700, "JSON inválido."), { status: 400 });
  }
  // Lote (array) saiu da especificação em 2025-06-18, mas cliente mais velho
  // ainda manda: responder em lote não custa nada.
  const lote = Array.isArray(corpo);
  const mensagens: unknown[] = Array.isArray(corpo) ? corpo : [corpo];
  const respostas = (await Promise.all(mensagens.map(atender))).filter((r) => r !== null);
  if (respostas.length === 0) return new Response(null, { status: 202 });
  return Response.json(lote ? respostas : respostas[0]);
}

// Sem canal SSE (nada a empurrar) e sem sessão para encerrar.
function semCanal() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
export const GET = semCanal;
export const DELETE = semCanal;
