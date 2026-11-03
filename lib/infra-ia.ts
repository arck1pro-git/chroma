// Módulo Infra: as IAs. Os limites vêm dos cabeçalhos que cada serviço devolve
// numa chamada mínima, porque nenhum dos dois tem leitura de uso com a chave
// que o CRM usa:
//   · Anthropic: uma pergunta de 1 token ao Haiku (custo desprezível) devolve os
//     limites POR MINUTO da conta (pedidos, tokens de entrada e de saída) e
//     quanto sobra. O gasto em dólar só sai com a chave de admin (sk-ant-admin),
//     que o CRM não tem.
//   · Groq: uma transcrição de 1 s de silêncio devolve o limite de pedidos POR
//     DIA e o de segundos de áudio POR HORA. No plano gratuito são 2.000 pedidos
//     por dia, e a extensão de reuniões manda dezenas por minuto.
// Cada sonda gasta um pedido do serviço: o resultado fica guardado na instância
// (GUARDA_*), e o cartão diz a hora da leitura.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { estadoPorUso, piorEstado, type CartaoInfra, type MedidaInfra } from "@/lib/infra-tipos";

const GUARDA_ANTHROPIC_MS = 5 * 60_000;
// A da Groq é mais longa: cada leitura come um dos 2.000 pedidos do dia.
const GUARDA_GROQ_MS = 30 * 60_000;

/** Guarda a última leitura por `ms`; leitura que falhou não fica guardada. */
function guardada<T>(ms: number, ler: () => Promise<T>): () => Promise<T> {
  let ultima: { em: number; valor: Promise<T> } | null = null;
  return () => {
    if (!ultima || Date.now() - ultima.em > ms) {
      const valor = ler();
      ultima = { em: Date.now(), valor };
      valor.catch(() => {
        ultima = null;
      });
    }
    return ultima.valor;
  };
}

const numero = (h: Headers, nome: string) => {
  const v = Number(h.get(nome));
  return Number.isFinite(v) && h.get(nome) !== null ? v : null;
};
const mil = (n: number) => n.toLocaleString("pt-BR");

/** Uma medida "sobram X de Y" a partir de dois cabeçalhos de limite. */
function folga(h: Headers, rotulo: string, limite: string, restante: string, unidade: string): MedidaInfra | null {
  const total = numero(h, limite);
  const sobra = numero(h, restante);
  if (total === null || sobra === null || total <= 0) return null;
  const uso = 1 - sobra / total;
  const usados = total - sobra;
  return { rotulo, valor: `${mil(usados)} ${usados === 1 ? "usado" : "usados"}`, limite: `de ${mil(total)} ${unidade}`, uso, estado: estadoPorUso(uso) };
}

const pct = (uso: number) => `${Math.round(uso * 100)}%`;

// ── Anthropic ───────────────────────────────────────────────────────────────

export const cartaoAnthropic = guardada(GUARDA_ANTHROPIC_MS, async (): Promise<CartaoInfra> => {
  const lidoEm = new Date().toISOString();
  const base = { chave: "anthropic", titulo: "IA", subtitulo: "Anthropic · atendimento, copiloto e IAs das telas", lidoEm };
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { ...base, estado: "critico", medidas: [], avisos: ["A chave da Anthropic não está configurada: nenhuma IA responde."] };
  }
  try {
    const cliente = new Anthropic({ timeout: 15_000, maxRetries: 0 });
    const { response } = await cliente.messages
      .create({ model: "claude-haiku-5-5", max_tokens: 1, messages: [{ role: "user", content: "ok" }] })
      .withResponse();
    const h = response.headers;
    const medidas = [
      folga(h, "Pedidos", "anthropic-ratelimit-requests-limit", "anthropic-ratelimit-requests-remaining", "por minuto"),
      folga(h, "Tokens de entrada", "anthropic-ratelimit-input-tokens-limit", "anthropic-ratelimit-input-tokens-remaining", "por minuto"),
      folga(h, "Tokens de saída", "anthropic-ratelimit-output-tokens-limit", "anthropic-ratelimit-output-tokens-remaining", "por minuto"),
    ].filter((m): m is MedidaInfra => m !== null);
    medidas.push({ rotulo: "Gasto do mês", valor: "não lido", limite: "precisa da chave de admin da Anthropic" });
    const pior = piorEstado(...medidas.map((m) => m.estado));
    const avisos = pior === "ok" ? [] : ["A conta da Anthropic está perto do limite por minuto: as IAs podem demorar ou falhar nos picos."];
    return { ...base, estado: pior, medidas, avisos };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return { ...base, estado: "critico", medidas: [], avisos: ["A Anthropic recusou a chave: nenhuma IA responde até trocar a chave."] };
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { ...base, estado: "critico", medidas: [], avisos: ["A conta da Anthropic está no limite agora: as IAs estão falhando."] };
    }
    if (e instanceof Anthropic.APIError && (e.status ?? 0) === 402) {
      return { ...base, estado: "critico", medidas: [], avisos: ["A Anthropic recusou por falta de crédito: as IAs param até recarregar."] };
    }
    throw e;
  }
});


// ── Groq (transcrição) ──────────────────────────────────────────────────────

/** 1 s de silêncio em WAV (16 kHz, 16 bits, mono): o mínimo que a Groq aceita transcrever. */
function silencio(): Blob {
  const amostras = 16_000;
  const b = Buffer.alloc(44 + amostras * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + amostras * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16_000, 24);
  b.writeUInt32LE(32_000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(amostras * 2, 40);
  return new Blob([b], { type: "audio/wav" });
}

export const cartaoGroq = guardada(GUARDA_GROQ_MS, async (): Promise<CartaoInfra> => {
  const lidoEm = new Date().toISOString();
  const base = { chave: "groq", titulo: "Transcrição de áudio", subtitulo: "Groq · áudio do chat e das reuniões", lidoEm };
  const chave = process.env.GROQ_API?.trim();
  if (!chave) {
    return { ...base, estado: "critico", medidas: [], avisos: ["A chave da Groq não está configurada: áudio não vira texto."] };
  }
  const form = new FormData();
  form.append("file", silencio(), "silencio.wav");
  form.append("model", "whisper-large-v3-turbo");
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}` },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 401) {
    return { ...base, estado: "critico", medidas: [], avisos: ["A Groq recusou a chave: áudio não vira texto até trocar a chave."] };
  }
  if (r.status === 429) {
    return { ...base, estado: "critico", medidas: [], avisos: ["A Groq está no limite agora: o áudio do chat e das reuniões não está virando texto."] };
  }
  const h = r.headers;
  const pedidos = folga(h, "Transcrições", "x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "por dia");
  const audio = numero(h, "x-ratelimit-limit-audio-seconds");
  const audioSobra = numero(h, "x-ratelimit-remaining-audio-seconds");
  const medidas = [pedidos].filter((m): m is MedidaInfra => m !== null);
  if (audio !== null && audioSobra !== null && audio > 0) {
    const uso = 1 - audioSobra / audio;
    medidas.push({ rotulo: "Áudio", valor: `${Math.round((audio - audioSobra) / 60)} min usados`, limite: `de ${Math.round(audio / 60)} min por hora`, uso, estado: estadoPorUso(uso) });
  }
  if (numero(h, "x-ratelimit-limit-requests") === 2000) {
    medidas.push({ rotulo: "Plano", valor: "Gratuito", limite: "2.000 transcrições por dia" });
  }
  const avisos: string[] = [];
  if (pedidos?.uso !== undefined && pedidos.uso >= 0.75) {
    avisos.push(`A transcrição está em ${pct(pedidos.uso)} do limite do dia: acima dele, o áudio do chat e das reuniões deixa de virar texto até o dia virar.`);
  }
  return { ...base, estado: piorEstado(...medidas.map((m) => m.estado)), medidas, avisos };
});
