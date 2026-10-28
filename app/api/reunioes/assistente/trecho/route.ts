import { NextRequest } from "next/server";
import { transcreverAudio } from "@/lib/transcricao";
import { limparTranscricao } from "@/lib/ia/reuniao";
import { pedidoDaExtensao, responder } from "@/lib/reunioes-extensao";

// Um trecho de ~15 s da reunião (da aba = o lead, ou do microfone = quem grava)
// vira texto pela Groq, a mesma do áudio do chat (lib/transcricao.ts). Nada é
// guardado nem vai para o log: o áudio passa e some, e o texto volta para a
// extensão.

export const dynamic = "force-dynamic";

// 15 s de opus a 32 kbps dão ~60 KB; 1 MB folga sem deixar a rota virar
// depósito de arquivo grande.
const TETO_BYTES = 1024 * 1024;
// Todo arquivo webm (Matroska) começa com o cabeçalho EBML.
const EBML = [0x1a, 0x45, 0xdf, 0xa3];

export async function POST(req: NextRequest) {
  const acesso = await pedidoDaExtensao(req, "trecho", "multipart");
  if (acesso instanceof Response) return acesso;
  // O tamanho declarado é conferido antes de ler o corpo; o real, depois.
  if (Number(req.headers.get("content-length") ?? 0) > TETO_BYTES + 16_384) {
    return responder({ erro: "Trecho grande demais." }, 413);
  }
  if (!process.env.GROQ_API?.trim()) return responder({ erro: "A transcrição não está configurada no CRM." }, 503);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return responder({ erro: "Áudio ausente." }, 400);
  if (audio.size > TETO_BYTES) return responder({ erro: "Trecho grande demais." }, 413);
  if (!audio.type.startsWith("audio/webm")) return responder({ erro: "Formato de áudio não aceito." }, 415);
  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (!EBML.every((b, i) => bytes[i] === b)) return responder({ erro: "Formato de áudio não aceito." }, 415);

  try {
    return responder({ texto: limparTranscricao(await transcreverAudio(bytes, "audio/webm")) });
  } catch (e) {
    console.error("[reunioes] transcrição falhou:", e instanceof Error ? e.message : e);
    return responder({ erro: "A transcrição falhou neste trecho." }, 502);
  }
}
