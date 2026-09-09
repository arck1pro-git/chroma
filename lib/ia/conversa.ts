import Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";

// Plumbing comum das conversas com a IA: credencial, streaming e NDJSON.
//
// Existe porque há duas conversas com posturas diferentes — a de /api/ia lê o
// CRM, a de /api/ia/automacoes escreve rascunho de fluxo — e só o que muda
// entre elas é o system e as ferramentas. Duplicar o stream significaria
// arrumar bug de parsing em dois lugares.
//
// NDJSON (uma linha JSON por evento) e não texto puro: dá pra avisar
// "consultando X…" enquanto o modelo usa uma ferramenta, em vez de deixar a
// tela parada.

// Sonnet 5 enquanto é teste sobre dados mockados — mais barato e rápido. Para
// voltar ao Opus 5, defina IA_MODELO=claude-opus-5 no .env (sem mexer no código).
const MODELO = process.env.IA_MODELO ?? "claude-sonnet-5";

export const SEM_CREDENCIAL =
  "Sem credencial da Anthropic. Defina ANTHROPIC_API_KEY no .env e reinicie o dev server.";

function semCredencial(e: unknown) {
  return (
    e instanceof Anthropic.AuthenticationError ||
    (e instanceof Error &&
      e.message.includes("Could not resolve authentication method"))
  );
}

export function texto(v: unknown, max: number) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

// { papel, texto } das trocas anteriores → mensagens do SDK. Só as últimas 8:
// o resto não paga o próprio custo.
export function historicoDe(bruto: unknown): Anthropic.Beta.BetaMessageParam[] {
  const anteriores = Array.isArray(bruto) ? bruto : [];
  return anteriores.slice(-8).flatMap((t) => {
    const item = t as { papel?: unknown; texto?: unknown };
    const conteudo = texto(item.texto, 4000);
    if (!conteudo) return [];
    return [
      {
        role: item.papel === "ia" ? ("assistant" as const) : ("user" as const),
        content: conteudo,
      },
    ];
  });
}

export type OpcoesConversa = {
  // Prefixo estável = prefixo cacheável. Nada de data/hora ou id aqui dentro,
  // senão o cache nunca acerta e cada pergunta paga o system inteiro de novo.
  sistema: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ferramentas: BetaRunnableTool<any>[];
  pergunta: string;
  historico: Anthropic.Beta.BetaMessageParam[];
  // o que está aberto na tela agora — é o que dá a sensação de "ele está vendo
  // o que eu vejo", e custa ~50 tokens
  contexto: string;
  // Eventos extras emitidos DEPOIS da última palavra do modelo. É por aqui que
  // a conversa de automações avisa a tela que o fluxo mudou — no fim, e não no
  // início da ferramenta, senão o builder recarregaria antes da gravação.
  eventosFinais?: () => Record<string, unknown>[];
};

export function conversar(opcoes: OpcoesConversa): Response {
  // Deixa o SDK resolver a credencial (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN
  // ou o perfil gravado por "ant auth login") em vez de exigir uma env var
  // específica — conferir só uma delas recusaria as outras, todas válidas.
  let cliente: Anthropic;
  try {
    cliente = new Anthropic();
  } catch {
    return Response.json({ erro: SEM_CREDENCIAL }, { status: 501 });
  }

  const runner = cliente.beta.messages.toolRunner({
    model: MODELO,
    max_tokens: 64000,
    // chat interativo: medium entrega bem e responde mais rápido que high
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: opcoes.sistema, cache_control: { type: "ephemeral" } },
    ],
    tools: opcoes.ferramentas,
    messages: [
      ...opcoes.historico,
      {
        role: "user",
        content: opcoes.contexto
          ? `[Tela agora: ${opcoes.contexto}]\n\n${opcoes.pergunta}`
          : opcoes.pergunta,
      },
    ],
    stream: true,
  });

  const fluxo = new ReadableStream<Uint8Array>({
    async start(controlador) {
      const codificar = new TextEncoder();
      const emitir = (evento: Record<string, unknown>) =>
        controlador.enqueue(codificar.encode(JSON.stringify(evento) + "\n"));

      try {
        for await (const stream of runner) {
          for await (const evento of stream) {
            if (
              evento.type === "content_block_start" &&
              evento.content_block.type === "tool_use"
            ) {
              emitir({ t: "ferramenta", v: evento.content_block.name });
            }
            if (
              evento.type === "content_block_delta" &&
              evento.delta.type === "text_delta"
            ) {
              emitir({ t: "texto", v: evento.delta.text });
            }
          }
        }
        for (const extra of opcoes.eventosFinais?.() ?? []) emitir(extra);
      } catch (e) {
        console.error("[ia] falhou:", e);
        emitir({
          t: "erro",
          // Sem credencial nenhuma o SDK não lança AuthenticationError (que é
          // resposta 401 do servidor) — lança um Error comum ANTES de sair da
          // máquina, com "Could not resolve authentication method".
          v: semCredencial(e)
            ? SEM_CREDENCIAL
            : e instanceof Anthropic.RateLimitError
              ? "Muitas perguntas seguidas. Tente de novo em instantes."
              : "Não consegui responder agora.",
        });
      } finally {
        controlador.close();
      }
    },
  });

  return new Response(fluxo, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
