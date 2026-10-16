// O protocolo MCP do conector do CRM (app/api/mcp/[segredo]). As ferramentas
// moram em lib/mcp/ferramentas.ts (leads, só leitura) e
// lib/mcp/ferramentas-postar.ts (redes sociais); o JSON-RPC é este.
//
// Streamable HTTP na forma mais simples que a especificação permite: SEM SESSÃO
// e SEM STREAM. Cada POST traz uma mensagem JSON-RPC e volta com a resposta em
// JSON. Não há nada para empurrar do servidor, então o GET que abriria o canal
// SSE responde 405, como a especificação prevê. Escrito à mão, sem o SDK: são
// quatro métodos.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type Ferramenta = {
  nome: string;
  titulo: string;
  descricao: string;
  entrada: z.ZodObject;
  executar: (args: never) => Promise<unknown>;
  /** Sem anotações = só leitura (o conector de leitura inteiro). */
  anotacoes?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  /**
   * O `_meta` da ferramenta no tools/list — extensão de cliente. Hoje só o
   * `openai/fileParams` do ChatGPT (os campos que recebem arquivo da conversa);
   * cliente que não conhece a chave ignora.
   */
  meta?: Record<string, unknown>;
};

/** Recusa com o motivo para o modelo ler e corrigir a chamada (não é erro do servidor). */
export class ErroDaFerramenta extends Error {}

export type ServidorMcp = {
  nome: string;
  titulo: string;
  instrucoes: string;
  ferramentas: Ferramenta[];
  /** O texto que o modelo lê quando a ferramenta lança. */
  mensagemDeErro: (e: unknown) => string;
};

/** O JSON Schema de entrada que o tools/list anuncia (o que o modelo pode mandar). */
export function esquemaDeEntrada(f: Ferramenta): Record<string, unknown> {
  const esquema = z.toJSONSchema(f.entrada, { io: "input" }) as Record<string, unknown>;
  delete esquema.$schema;
  return esquema;
}

/**
 * Segredo da URL contra o da variável de ambiente. Segredo curto demais é
 * tratado como ausente: um valor de teste esquecido na Vercel não pode virar a
 * única tranca. Sem a variável, a porta fica FECHADA.
 */
export function segredoConfere(recebido: string, esperado: string | undefined): boolean {
  if (!esperado || esperado.length < 32) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Da mais nova para a mais velha. Cliente que pede uma destas recebe a mesma;
// qualquer outra recebe a primeira, e o cliente decide se segue.
const VERSOES = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type Id = string | number | null;
type Mensagem = { jsonrpc?: unknown; id?: Id; method?: unknown; params?: Record<string, unknown> };

const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const falha = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

const SO_LEITURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

/** A resposta a uma mensagem; null quando ela não pede resposta (notificação). */
async function atender(servidor: ServidorMcp, bruta: unknown): Promise<object | null> {
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
        serverInfo: { name: servidor.nome, title: servidor.titulo, version: "1.0.0" },
        instructions: servidor.instrucoes,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: servidor.ferramentas.map((f) => ({
          name: f.nome,
          title: f.titulo,
          description: f.descricao,
          inputSchema: esquemaDeEntrada(f),
          annotations: { title: f.titulo, ...(f.anotacoes ?? SO_LEITURA) },
          ...(f.meta ? { _meta: f.meta } : {}),
        })),
      });
    case "tools/call": {
      const ferramenta = servidor.ferramentas.find((f) => f.nome === params?.name);
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
        // ter nome de lead ou o texto de um post) nem o resultado.
        console.log(`[${servidor.nome}] ${ferramenta.nome} ${Date.now() - inicio}ms`);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(resultado) }] });
      } catch (e) {
        console.error(`[${servidor.nome}] ${ferramenta.nome} falhou:`, e);
        return ok(id, { content: [{ type: "text", text: servidor.mensagemDeErro(e) }], isError: true });
      }
    }
    default:
      return falha(id, -32601, `Método não suportado: ${method}`);
  }
}

/** O corpo do POST inteiro: uma mensagem ou um lote. */
export async function responderMcp(servidor: ServidorMcp, req: Request): Promise<Response> {
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
  const respostas = (await Promise.all(mensagens.map((m) => atender(servidor, m)))).filter((r) => r !== null);
  if (respostas.length === 0) return new Response(null, { status: 202 });
  return Response.json(lote ? respostas : respostas[0]);
}

/** GET e DELETE: sem canal SSE (nada a empurrar) e sem sessão para encerrar. */
export function semCanal() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
