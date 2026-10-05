"use server";

import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { desconectarGoogle } from "@/lib/google-oauth";

/**
 * Desliga a agenda do Google: apaga a conexão e revoga o acesso lá. As
 * reuniões já marcadas continuam no Google e no histórico; o que para é a
 * Agenda, a ficha e a IA lerem e marcarem.
 */
export async function desconectarGoogleCalendar(): Promise<{ ok: boolean; mensagem: string }> {
  await exigirModulo("integracoes");
  try {
    await desconectarGoogle();
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true, mensagem: "Google Calendar desconectado." };
}
