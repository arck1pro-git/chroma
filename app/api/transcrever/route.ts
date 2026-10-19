// Ditado: o áudio gravado no navegador (botão de microfone dos campos de
// anotação, nota e descrição) vira texto pela Groq — a mesma transcrição que
// faz a IA "ouvir" o áudio do WhatsApp (lib/transcricao.ts). Pedido dele,
// 2026-10-19: comentar falando em vez de digitar.
//
// Só quem está logado. O áudio não é guardado: entra, vira texto, some.
import { exigirLoginApi } from "@/lib/auth/dal";
import { transcreverAudio } from "@/lib/transcricao";

export const dynamic = "force-dynamic";

// A Vercel recusa corpo acima de 4,5 MB. O botão para sozinho em 3 minutos,
// que em Opus dá menos de 1,5 MB — o teto é folga, não meta.
const TETO = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const usuario = await exigirLoginApi();
  if (usuario instanceof Response) return usuario;

  let arquivo: File | null = null;
  try {
    const form = await req.formData();
    const valor = form.get("audio");
    arquivo = valor instanceof File ? valor : null;
  } catch {
    return Response.json({ erro: "Áudio inválido." }, { status: 400 });
  }
  if (!arquivo || arquivo.size === 0) return Response.json({ erro: "Nenhum áudio gravado." }, { status: 400 });
  if (arquivo.size > TETO) return Response.json({ erro: "Áudio longo demais: grave até 3 minutos." }, { status: 413 });

  try {
    const texto = await transcreverAudio(new Uint8Array(await arquivo.arrayBuffer()), arquivo.type || null);
    if (texto === null && !process.env.GROQ_API?.trim()) {
      return Response.json({ erro: "A transcrição não está configurada no servidor (GROQ_API)." }, { status: 503 });
    }
    return Response.json({ texto: texto ?? "" });
  } catch (e) {
    console.error("[transcrever] falhou:", e);
    return Response.json({ erro: "Não consegui transcrever o áudio. Tente de novo." }, { status: 502 });
  }
}
