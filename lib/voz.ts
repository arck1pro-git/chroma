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
import "server-only";
import { paraFala } from "@/lib/fala";

const BASE = "https://api.magnific.com/v1/ai/voiceover/elevenlabs-turbo-v2-5";

// A VOZ É FIXA NO CÓDIGO: Roberta, brasileira, "suave e confiante", da
// biblioteca da ElevenLabs. Escolhida por ele em 2026-10-14 entre 14 amostras,
// com o pedido de ser ela "sempre". Por isso não há mais MAGNIFIC_VOZ_ID: um
// valor esquecido na Vercel trocaria a voz sem ninguém ver. A anterior, Brian
// (nPczCjzI2devNBz1zQrb), era americana e soava estrangeira em português.
const VOZ = "RGymW84CSmfVugnA5tvA";

// Os ajustes da amostra que ele aprovou ("mais suave, mais natural": a 1 de 6
// variações). Estabilidade baixa solta a entonação; 0,95 de velocidade acalma.
// Sem ajuste nenhum a Magnific usa similarity_boost 0,2 (o padrão dela; o da
// ElevenLabs é 0,75), a voz se afasta da gravação original e soa artificial.
//
// A voz não é a persona: o nome "Roberta" é só o da voz na biblioteca. Como a
// IA se apresenta (ex.: "assistente virtual da Amaan") quem decide é o prompt.
const AJUSTES = { stability: 0.35, similarity_boost: 0.75, speed: 0.95, use_speaker_boost: true };

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
      voice_id: VOZ,
      ...AJUSTES,
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
