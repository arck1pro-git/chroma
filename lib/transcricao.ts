// Áudio → texto, pela Groq (Whisper). É o que deixa a IA "ouvir" o áudio do
// cliente: a transcrição vai para mensagens.texto, que no áudio ficava vazio,
// e a conversa que a IA lê passa a ter o que a pessoa falou.
//
// Contrato (console.groq.com/docs/speech-to-text, 2026-09-29):
//   POST https://api.groq.com/openai/v1/audio/transcriptions
//   header Authorization: Bearer <GROQ_API>, corpo multipart
//   file (com extensão aceita: mp3, ogg, m4a, wav, webm…), model, language
//   200 → { text }
//
// Sem GROQ_API no ambiente, não transcreve e ninguém quebra: o áudio continua
// salvo e tocando no chat, só a IA segue sem saber o que ele diz.
import "server-only";

const MODELO = "whisper-large-v3-turbo";

const EXTENSAO: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

/** O texto falado no áudio, ou null quando não há o que transcrever. Lança em erro da Groq. */
export async function transcreverAudio(bytes: Uint8Array, mime: string | null): Promise<string | null> {
  const chave = process.env.GROQ_API?.trim();
  if (!chave) return null;

  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  const extensao = EXTENSAO[base] ?? "mp3";

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: base || "audio/mpeg" }), `audio.${extensao}`);
  form.append("model", MODELO);
  // Português fixo: o atendimento é no Brasil, e dizer o idioma deixa o
  // Whisper mais preciso e mais rápido (é a própria doc que recomenda).
  form.append("language", "pt");
  form.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}` },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `groq respondeu ${res.status}`);

  const texto = typeof data?.text === "string" ? data.text.trim() : "";
  return texto || null;
}
