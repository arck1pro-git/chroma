"use server";

// A seção "Reuniões" da ficha da oportunidade: ler as reuniões dela, sugerir
// horários livres e marcar uma no Google Calendar. Separado de ./actions.ts
// porque tudo aqui depende da conexão com o Google (lib/agenda.ts).

import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { FORA_DO_ESCOPO, podeTocarOportunidade } from "@/lib/auth/escopo-oportunidades";
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
import { gravacaoDaReuniao, gravacoesDoMeet, gravacoesDoNome, type Gravacao } from "@/lib/gravacoes";

export type ReunioesDaFicha = {
  conectado: boolean;
  reunioes: ReuniaoDoCrm[];
  /** A gravação do Meet de cada reunião (id da reunião → gravação), quando houve. */
  gravacaoDe: Record<string, Gravacao>;
  /** Outras gravações com o nome do contato no título — as de antes do CRM. */
  doContato: Gravacao[];
};

/**
 * As gravações vêm da pasta do Meet (lib/gravacoes.ts) e são acessórias: o
 * Drive fora do ar vira "sem gravação", nunca uma seção de reuniões quebrada.
 */
async function gravacoesDaFicha(oportunidadeId: string, reunioes: ReuniaoDoCrm[]) {
  try {
    const [lista, [linha]] = await Promise.all([
      gravacoesDoMeet(),
      sql`SELECT c.nome FROM oportunidades o JOIN contatos c ON c.id = o.contato_id WHERE o.id = ${oportunidadeId}`,
    ]);
    const gravacaoDe: Record<string, Gravacao> = {};
    for (const r of reunioes) {
      const g = gravacaoDaReuniao(lista, r.inicio);
      if (g) gravacaoDe[r.id] = g;
    }
    const usadas = new Set(Object.values(gravacaoDe).map((g) => g.id));
    const doContato = linha ? gravacoesDoNome(lista, linha.nome as string).filter((g) => !usadas.has(g.id)) : [];
    return { gravacaoDe, doContato };
  } catch (e) {
    console.error("[ficha] gravações:", e);
    return { gravacaoDe: {}, doContato: [] };
  }
}

export async function reunioesDaFicha(oportunidadeId: string): Promise<ReunioesDaFicha> {
  // No escopo "próprio", só a ficha de uma oportunidade dele.
  if (!(await podeTocarOportunidade(oportunidadeId))) {
    return { conectado: false, reunioes: [], gravacaoDe: {}, doContato: [] };
  }
  const [conexao, reunioes] = await Promise.all([conexaoGoogle(), reunioesDaOportunidade(oportunidadeId)]);
  return { conectado: Boolean(conexao), reunioes, ...(await gravacoesDaFicha(oportunidadeId, reunioes)) };
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
  const { usuario } = await exigirModulo("inicio", "criar");
  if (!(await podeTocarOportunidade(oportunidadeId))) return { ok: false, mensagem: FORA_DO_ESCOPO };

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
    // 55P03 = lock_timeout: a fila de reservas (lib/agenda.ts) não andou em 20 s.
    if (e && typeof e === "object" && "code" in e && e.code === "55P03") {
      return { ok: false, mensagem: "Outra reunião está sendo marcada agora. Tente de novo em instantes." };
    }
    if (!(e instanceof GoogleDesconectado)) console.error("[agenda] ficha não marcou:", oportunidadeId, e);
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) };
  }
}
