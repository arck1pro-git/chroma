"use server";

// A seção "Reuniões" da ficha da oportunidade: ler as reuniões dela, sugerir
// horários livres e marcar uma no Google Calendar. Separado de ./actions.ts
// porque tudo aqui depende da conexão com o Google (lib/agenda.ts).

import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { conexaoGoogle, GoogleDesconectado } from "@/lib/google-oauth";
import {
  diaEmBrasilia,
  horaEmBrasilia,
  horariosLivres,
  HorarioOcupado,
  instanteEmBrasilia,
  marcarReuniao,
  reunioesDaOportunidade,
  rotuloDoHorario,
  type ReuniaoDoCrm,
} from "@/lib/agenda";

export type ReunioesDaFicha = { conectado: boolean; reunioes: ReuniaoDoCrm[] };

export async function reunioesDaFicha(oportunidadeId: string): Promise<ReunioesDaFicha> {
  await exigirModulo("inicio");
  const [conexao, reunioes] = await Promise.all([conexaoGoogle(), reunioesDaOportunidade(oportunidadeId)]);
  return { conectado: Boolean(conexao), reunioes };
}

/** Um horário livre como a ficha usa: data e hora de Brasília, prontos para o formulário. */
export type SugestaoHorario = { data: string; hora: string; rotulo: string };

export async function sugestoesDeHorario(): Promise<
  { ok: true; horarios: SugestaoHorario[] } | { ok: false; mensagem: string }
> {
  await exigirModulo("inicio");
  try {
    const livres = await horariosLivres();
    return {
      ok: true,
      horarios: livres.map((h) => ({ data: diaEmBrasilia(h.inicio), hora: horaEmBrasilia(h.inicio), rotulo: h.rotulo })),
    };
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) };
  }
}

const DURACOES = [30, 45, 60, 90, 120];

/**
 * Marca a reunião da oportunidade no horário escolhido (data e hora de
 * Brasília). O contato é o da oportunidade; o convite do Google vai para o
 * e-mail dele quando o cadastro tem um.
 */
export async function marcarReuniaoDaOportunidade(
  oportunidadeId: string,
  data: string,
  hora: string,
  duracaoMin: number,
): Promise<{ ok: boolean; mensagem: string }> {
  const { usuario } = await exigirModulo("inicio");

  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  const h = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!d || !h) return { ok: false, mensagem: "Escolha a data e a hora." };
  if (!DURACOES.includes(duracaoMin)) return { ok: false, mensagem: "Duração inválida." };

  const inicio = instanteEmBrasilia(Number(d[1]), Number(d[2]), Number(d[3]), Number(h[1]), Number(h[2]));
  if (Number.isNaN(inicio.getTime())) return { ok: false, mensagem: "Data inválida." };
  if (inicio.getTime() < Date.now()) return { ok: false, mensagem: "Esse horário já passou." };

  const [op] = await sql`SELECT contato_id FROM oportunidades WHERE id = ${oportunidadeId}`;
  if (!op) return { ok: false, mensagem: "Oportunidade não encontrada." };

  try {
    const r = await marcarReuniao({
      contatoId: op.contato_id as string,
      oportunidadeId,
      inicio,
      duracaoMin,
      autorId: usuario.id,
      quem: usuario.nome,
    });
    revalidatePath("/");
    revalidatePath("/agenda");
    return {
      ok: true,
      mensagem:
        `Reunião marcada para ${rotuloDoHorario(r.inicio)}.` +
        (r.convidou ? " O convite foi para o e-mail do contato." : " O contato não tem e-mail: mande o link pelo WhatsApp.") +
        (r.meet ? "" : " O Google não gerou link do Meet."),
    };
  } catch (e) {
    if (e instanceof HorarioOcupado) {
      return { ok: false, mensagem: "Já tem compromisso na agenda nesse horário. Escolha outro." };
    }
    if (!(e instanceof GoogleDesconectado)) console.error("[agenda] ficha não marcou:", oportunidadeId, e);
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) };
  }
}
