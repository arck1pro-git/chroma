// Texto → áudio, pela Magnific (ElevenLabs Turbo v2.5 por baixo). É a voz da
// IA quando o cliente fala com ela por áudio (lib/ia/atendente.ts).
//
// Contrato (docs.magnific.com + testado em 2026-09-29):
//   POST {BASE}/v1/ai/voiceover/elevenlabs-turbo-v2-5
//        header x-magnific-api-key, body { text, voice_id, ... }
//        → { data: { task_id, status: "CREATED" } }
//   GET  {BASE}/v1/ai/voiceover/elevenlabs-turbo-v2-5/<task_id>
//        → { data: { status: CREATED|IN_PROGRESS|COMPLETED|FAILED, generated: [url] } }
//   O arquivo é MP3 num link assinado que expira — por isso os bytes são
//   baixados na hora e guardados por nós (lib/conversa-envio.ts).
// É ASSÍNCRONA: pede, recebe uma tarefa e espera. Uma frase curta ficou pronta
// em ~3s nos testes.
//
// A voz vem de MAGNIFIC_VOZ_ID (um voice_id da biblioteca da ElevenLabs).
import "server-only";
import { paraFala } from "@/lib/fala";

const BASE = "https://api.magnific.com/v1/ai/voiceover/elevenlabs-turbo-v2-5";
// Brian: nas amostras de 2026-09-29 foi a que leu valores com mais
// naturalidade ("200 mil reais"). Troca-se pelo .env, sem deploy de código.
const VOZ_PADRAO = "nPczCjzI2devNBz1zQrb";
const ESPERA_MAXIMA_MS = 45_000;

/** Sem a chave, a IA continua respondendo em texto. */
export function vozConfigurada(): boolean {
  return Boolean(process.env.MAGNIFIC_API_KEY?.trim());
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O texto falado, em MP3. Lança se a Magnific falhar ou demorar demais. */
export async function sintetizarVoz(texto: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const chave = process.env.MAGNIFIC_API_KEY?.trim();
  if (!chave) throw new Error("MAGNIFIC_API_KEY não configurada");
  const cabecalho = { "x-magnific-api-key": chave, "Content-Type": "application/json" };

  const pedido = await fetch(BASE, {
    method: "POST",
    headers: cabecalho,
    body: JSON.stringify({
      text: paraFala(texto),
      voice_id: process.env.MAGNIFIC_VOZ_ID?.trim() || VOZ_PADRAO,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const criado = await pedido.json().catch(() => ({}));
  const tarefa: string | undefined = criado?.data?.task_id;
  if (!pedido.ok || !tarefa) {
    throw new Error(criado?.message ?? `magnific respondeu ${pedido.status} ao pedir a voz`);
  }

  const limite = Date.now() + ESPERA_MAXIMA_MS;
  while (Date.now() < limite) {
    await esperar(1_000);
    const r = await fetch(`${BASE}/${tarefa}`, {
      headers: cabecalho,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    const status: string | undefined = d?.data?.status;
    if (status === "FAILED") throw new Error(d?.data?.error ?? "a Magnific não conseguiu gerar a voz");
    const url: string | undefined = d?.data?.generated?.[0];
    if (status === "COMPLETED" && url) {
      const arquivo = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!arquivo.ok) throw new Error(`download da voz respondeu ${arquivo.status}`);
      return { bytes: new Uint8Array(await arquivo.arrayBuffer()), mime: "audio/mpeg" };
    }
  }
  throw new Error("a Magnific demorou demais para gerar a voz");
}
