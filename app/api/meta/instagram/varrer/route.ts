import { revalidatePath } from "next/cache";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { varrerComentariosInstagram } from "@/lib/instagram-varredura";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!autorizado(req)) return naoAutorizado();
  const resultado = await varrerComentariosInstagram();
  if (resultado.novos > 0) revalidatePath("/chat");
  return Response.json(resultado);
}
