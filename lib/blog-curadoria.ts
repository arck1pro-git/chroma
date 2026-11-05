// A curadoria da pauta da automação: entre as notícias novas dos feeds, quais
// rendem artigo PARA ESTE BLOG.
//
// POR QUE EXISTE (2026-11-05): os feeds de mercado e economia trazem de tudo —
// "Ibovespa abre em alta", resultado de empresa, câmbio do dia — e a pauta
// antiga pegava as mais NOVAS. Um blog de investimento imobiliário recebia um
// artigo sobre o fechamento do pregão. Aqui um modelo lê só os TÍTULOS e escolhe
// os que têm a ver com a descrição do blog e dão um texto útil para o leitor
// dele, na ordem de relevância.
//
// BARATO E DESCARTÁVEL: uma chamada por blog por rodada, só títulos, esforço
// baixo. Se ela falhar (rede, recusa, formato), a pauta volta para a ordem por
// data — a automação nunca para por causa da curadoria.
//
// Título de notícia é texto de terceiro: vai ao modelo como dado
// (lib/ia/sanitizar.ts), e o modelo só devolve números de uma lista fechada —
// não há o que uma injeção consiga fazer além de mudar a ordem.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { comoDado, REGRA_DADO_NAO_CONFIAVEL } from "@/lib/ia/sanitizar";
import type { ItemRss } from "@/lib/blog-rss";

const MODELO = "claude-opus-5-5";

/** Títulos que o modelo lê por blog. Mais que isso é a mesma escolha, mais cara. */
const MAX_CANDIDATOS = 60;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["escolhidas"],
  properties: {
    escolhidas: {
      type: "array",
      items: { type: "integer" },
      description: "Os números das notícias escolhidas, da mais para a menos indicada.",
    },
  },
} as const;

function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function montarPrompt(blog: { nome: string; descricao: string }, itens: ItemRss[], quantos: number): string {
  const lista = itens
    .map((i, n) => `${n + 1}. ${comoDado(i.titulo || "(sem título)")} — ${dominio(i.link)}${i.data ? `, ${i.data.slice(0, 10)}` : ""}`)
    .join("\n");

  return [
    `Você é editor do blog "${blog.nome}".`,
    "",
    "## SOBRE O BLOG (escrito pela equipe)",
    blog.descricao.trim(),
    "",
    "## TAREFA",
    `Abaixo estão notícias recentes de mercado e economia. Cada uma escolhida vira um artigo de blog`,
    `de 1.200 a 1.500 palavras, escrito a partir da matéria, com o ângulo do blog.`,
    `Escolha até ${quantos}, da mais para a menos indicada.`,
    "",
    "Prefira notícias que:",
    "- têm relação direta com o tema e o público do blog;",
    "- deixam explicar ao leitor o que muda para ele (decisão, risco, oportunidade);",
    "- continuam úteis por semanas, não só no dia.",
    "",
    "Evite:",
    "- cotação do dia, abertura e fechamento de bolsa, oscilação de moeda sem contexto;",
    "- duas notícias sobre o mesmo fato (fique com a mais completa);",
    "- assunto sem relação com o blog, mesmo que seja manchete.",
    "",
    "Se nenhuma servir, devolva a lista vazia.",
    "",
    "## NOTÍCIAS",
    lista,
  ].join("\n");
}

/**
 * As notícias que viram artigo, já na ordem de prioridade. `itens` vem do mais
 * novo para o mais antigo (lib/blog-rss.ts). Sem descrição do blog não há
 * critério de escolha: fica a ordem por data.
 */
export async function escolherPautas(
  blog: { nome: string; descricao: string },
  itens: ItemRss[],
  quantos: number,
): Promise<ItemRss[]> {
  const candidatos = itens.slice(0, MAX_CANDIDATOS);
  if (!blog.descricao.trim() || candidatos.length <= 1) return candidatos.slice(0, quantos);

  try {
    const resposta = await new Anthropic().messages.create({
      model: MODELO,
      max_tokens: 2048,
      system: REGRA_DADO_NAO_CONFIAVEL,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: montarPrompt(blog, candidatos, quantos) }],
    });
    if (resposta.stop_reason === "refusal") throw new Error("o modelo recusou a curadoria");

    const texto = resposta.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const { escolhidas } = JSON.parse(texto) as { escolhidas?: unknown };
    if (!Array.isArray(escolhidas)) throw new Error("formato inesperado");

    const vistos = new Set<number>();
    const ordem: ItemRss[] = [];
    for (const n of escolhidas) {
      const i = Number(n) - 1;
      if (!Number.isInteger(i) || i < 0 || i >= candidatos.length || vistos.has(i)) continue;
      vistos.add(i);
      ordem.push(candidatos[i]);
    }
    return ordem.slice(0, quantos);
  } catch (e) {
    console.error(`[blog-curadoria] "${blog.nome}": ${e instanceof Error ? e.message : e} — seguindo pela data`);
    return candidatos.slice(0, quantos);
  }
}
