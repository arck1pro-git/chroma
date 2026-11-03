// O RETORNO COMBINADO: o cliente pede para falar em outro momento ("me chama
// amanhã às 15h", "agora não posso, fala comigo segunda") e a IA anota o dia e
// a hora para retomar a conversa nesse horário.
//
// PEDIDO (2026-11-03): "quando o lead pedir para ser atendido em outro momento
// a ia deve anotar esse dia ou hora e retomar atendimento". É a ação
// agendar_retorno (lib/ia/catalogo.ts). Aqui moram a ferramenta do modelo e o
// registro; quem usa a ferramenta é lib/ia/atendente.ts, e quem retoma na hora
// é a rodada de 5 em 5 minutos de lib/ia/retomada.ts.
//
// O ESTADO mora no histórico do contato, sem tabela, como o "parou" da
// retomada por silêncio: a linha que começa com MARCA_RETORNO ("IA vai retomar
// a conversa em qua 04/11/2026 15:00…") é o combinado, e a equipe a lê na
// ficha; a que começa com MARCA_FIM fecha ("Retorno combinado feito…" ou
// "…não feito: motivo"). Vale a ÚLTIMA das duas: pedido novo passa por cima do
// anterior.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import { diaEmBrasilia, horaEmBrasilia, instanteEmBrasilia, rotuloDoHorario } from "@/lib/agenda";

export const MARCA_RETORNO = "IA vai retomar a conversa em";
export const MARCA_FIM = "Retorno combinado";
/** Os LIKE das duas linhas, para as consultas que procuram o combinado. */
export const LIKE_RETORNO = `${MARCA_RETORNO} %`;
export const LIKE_FIM = `${MARCA_FIM} %`;

/** Antecedência mínima e prazo máximo do retorno. */
const MINIMO_MS = 5 * 60_000;
export const MAXIMO_DIAS = 60;

// "qua 04/11/2026 15:00": o dia da semana é para a equipe ler; o resto é o
// que quandoDoRetorno lê de volta.
const DATA_DA_LINHA = /^\S+ (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/;

/** "qua 04/11/2026 15:00", no relógio de Brasília. */
function dataDaLinha(d: Date): string {
  const [ano, mes, dia] = diaEmBrasilia(d).split("-");
  return `${rotuloDoHorario(d).split(" ")[0]} ${dia}/${mes}/${ano} ${horaEmBrasilia(d)}`;
}

/** O instante combinado de uma linha MARCA_RETORNO, ou null se não for uma. */
export function quandoDoRetorno(descricao: string): Date | null {
  if (!descricao.startsWith(MARCA_RETORNO)) return null;
  const m = DATA_DA_LINHA.exec(descricao.slice(MARCA_RETORNO.length).trim());
  if (!m) return null;
  return instanteEmBrasilia(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4]), Number(m[5]));
}

export const FERRAMENTA_RETORNO: Anthropic.Tool = {
  name: "agendar_retorno",
  description:
    'Anota o dia e a hora em que o cliente pediu para você voltar a falar com ele, e você mesma retoma a conversa nesse horário. Use quando ele disser que agora não pode ou pedir para conversar em outro momento ("me chama amanhã às 15h", "fala comigo segunda", "estou no trabalho, à noite a gente conversa"). Sem hora exata, escolha pelo que ele disse: de manhã 10:00, à tarde 15:00, à noite 19:00, só o dia 10:00, "mais tarde" daqui a 3 horas. Se ele pedir outro horário depois, use de novo: vale o último. Não serve para marcar reunião nem para quando ele só demorou a responder. É interno, o cliente não vê: use junto com a sua resposta, que confirma o dia e a hora combinados.',
  input_schema: {
    type: "object",
    properties: {
      quando: {
        type: "string",
        description: 'Dia e hora no horário de Brasília, no formato AAAA-MM-DD HH:MM (ex.: "2026-11-04 15:00"). Conte a partir do "Agora" do pedido.',
      },
      pedido: {
        type: "string",
        description: 'O que o cliente pediu, curto e com as palavras dele (ex.: "me chama amanhã à tarde"). Vai para o histórico, para a equipe.',
      },
    },
    required: ["quando", "pedido"],
    additionalProperties: false,
  },
  strict: true,
};

/** O agendar_retorno já conferido, para gravar depois que a resposta sair. */
export type RetornoPedido = { quando: Date; pedido: string };

/**
 * Confere o que o modelo mandou. Devolve o retorno, ou o motivo da recusa,
 * que volta para o modelo como resultado da ferramenta.
 */
export function conferirRetorno(entrada: unknown): RetornoPedido | { erro: string } {
  const e = (entrada ?? {}) as { quando?: unknown; pedido?: unknown };
  const m = typeof e.quando === "string" ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(e.quando.trim()) : null;
  if (!m) return { erro: 'Não anotado: use o formato AAAA-MM-DD HH:MM (ex.: "2026-11-04 15:00").' };
  const [ano, mes, dia, hora, minuto] = m.slice(1).map(Number);
  const quando = instanteEmBrasilia(ano, mes, dia, hora, minuto);
  // 2026-02-31 vira 03/03 no Date: a volta pelo relógio de Brasília denuncia.
  if (diaEmBrasilia(quando) !== `${m[1]}-${m[2]}-${m[3]}` || hora > 23 || minuto > 59) {
    return { erro: "Não anotado: essa data não existe. Confira o dia." };
  }
  const daqui = quando.getTime() - Date.now();
  if (daqui < MINIMO_MS) return { erro: "Não anotado: esse horário já passou. Confira o dia e a hora a partir do Agora." };
  if (daqui > MAXIMO_DIAS * 86_400_000) {
    return { erro: `Não anotado: dá para combinar até ${MAXIMO_DIAS} dias à frente. Diga que a equipe fala com ele mais perto da data.` };
  }
  const pedido = typeof e.pedido === "string" ? e.pedido.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return { quando, pedido };
}

/** O resultado da ferramenta, como o modelo vai ler. */
export function resultadoDoRetorno(r: RetornoPedido | { erro: string }): string {
  if ("erro" in r) return r.erro;
  return `Anotado: ${rotuloDoHorario(r.quando)} (horário de Brasília). Você retoma a conversa nesse horário. Confirme ao cliente o dia e a hora combinados.`;
}

/** Grava o combinado no histórico do contato (MARCA_RETORNO). */
export async function registrarRetorno(contatoId: string, oportunidadeId: string | null, r: RetornoPedido): Promise<void> {
  const linha = `${MARCA_RETORNO} ${dataDaLinha(r.quando)} (horário de Brasília).${r.pedido ? ` O cliente pediu: "${r.pedido}"` : ""}`;
  await sql`
    INSERT INTO historico (contato_id, oportunidade_id, descricao)
    VALUES (${contatoId}, ${oportunidadeId}, ${linha.slice(0, 1000)})`;
}

/** Fecha o combinado (MARCA_FIM): "feito: …" ou "não feito: …". */
export async function fecharRetorno(contatoId: string, oportunidadeId: string | null, como: string): Promise<void> {
  await sql`
    INSERT INTO historico (contato_id, oportunidade_id, descricao)
    VALUES (${contatoId}, ${oportunidadeId}, ${`${MARCA_FIM} ${como}`.slice(0, 1000)})`;
}

/** O retorno ainda aberto do contato (a última linha é um combinado), ou null. */
export async function retornoMarcado(contatoId: string): Promise<Date | null> {
  const [l] = await sql`
    SELECT h.descricao FROM historico h
     WHERE h.contato_id = ${contatoId}
       AND (h.descricao LIKE ${LIKE_RETORNO} OR h.descricao LIKE ${LIKE_FIM})
     ORDER BY h.data_criacao DESC LIMIT 1`;
  return l ? quandoDoRetorno(l.descricao as string) : null;
}

/** A linha do pedido ao modelo quando há retorno aberto. */
export function linhaDoRetorno(quando: Date): string {
  return `Retorno combinado com o cliente: ${rotuloDoHorario(quando)} (horário de Brasília). Se ele pedir outro horário, use agendar_retorno de novo.`;
}
