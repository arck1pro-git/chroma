// A REMARCAÇÃO pela IA (pedido dele, 2026-11-05): o lead que já tem reunião
// marcada avisa que não vai conseguir ir. A IA avisa a Fernanda, oferece
// horários para remarcar e, quando ele escolhe, muda a reunião no Google
// (lib/agenda.ts, remarcarReuniao) e avisa a Fernanda de novo. Sem resposta, a
// rodada das retomadas (lib/ia/retomada.ts) volta a oferecer 2 horas depois da
// última mensagem da IA e, daí em diante, uma vez por dia (TEMPOS_REMARCACAO).
//
// As ferramentas do modelo e o que elas fazem moram em lib/ia/atendente.ts
// (avisar_imprevisto e remarcar_reuniao); aqui ficam o estado e as regras de
// tempo que o atendente e a retomada leem igual.
//
// O ESTADO mora no histórico do contato, sem tabela, como o retorno combinado
// (lib/ia/retorno.ts): a linha que começa com MARCA_PENDENTE abre a remarcação
// (a Fernanda e a ficha a leem), a que começa com MARCA_REMARCADA fecha. Vale a
// ÚLTIMA das duas, e só por VALIDADE_DIAS: remarcação esquecida não fica
// cutucando o lead para sempre.
import "server-only";
import { sql } from "@/lib/db";

export const MARCA_PENDENTE = "Remarcação pendente pela IA";
export const MARCA_REMARCADA = "Reunião remarcada pela IA";
export const LIKE_PENDENTE = `${MARCA_PENDENTE}%`;
export const LIKE_REMARCADA = `${MARCA_REMARCADA}%`;

/** Minutos desde a mensagem ANTERIOR da IA: 2 horas e, depois, uma por dia. Depois da última, desiste e avisa. */
export const TEMPOS_REMARCACAO = [120, 1440, 1440, 1440, 1440];
/** Horas de Brasília em que a retomada da remarcação pode sair (das ≤ hora < até). */
export const JANELA_REMARCACAO = { das: 8, ate: 20 };
/** Depois disso a remarcação aberta deixa de valer. */
export const VALIDADE_DIAS = 10;

/** A remarcação do contato está aberta (a última linha é a pendente, dentro da validade)? */
export async function remarcacaoAberta(contatoId: string): Promise<boolean> {
  const [l] = await sql`
    SELECT h.descricao LIKE ${LIKE_PENDENTE} AS aberta
      FROM historico h
     WHERE h.contato_id = ${contatoId}
       AND (h.descricao LIKE ${LIKE_PENDENTE} OR h.descricao LIKE ${LIKE_REMARCADA})
       AND h.data_criacao > now() - ${`${VALIDADE_DIAS} days`}::interval
     ORDER BY h.data_criacao DESC LIMIT 1`;
  return Boolean(l?.aberta);
}

/** Abre a remarcação: o lead avisou que não vai conseguir ir. */
export async function registrarImprevisto(contatoId: string, oportunidadeId: string | null, texto: string): Promise<void> {
  await sql`
    INSERT INTO historico (contato_id, oportunidade_id, descricao)
    VALUES (${contatoId}, ${oportunidadeId}, ${`${MARCA_PENDENTE}: ${texto}`.slice(0, 1000)})`;
}

/** Fecha a remarcação: a reunião foi para o horário novo. */
export async function registrarRemarcada(contatoId: string, oportunidadeId: string | null, texto: string): Promise<void> {
  await sql`
    INSERT INTO historico (contato_id, oportunidade_id, descricao)
    VALUES (${contatoId}, ${oportunidadeId}, ${`${MARCA_REMARCADA}: ${texto}`.slice(0, 1000)})`;
}
