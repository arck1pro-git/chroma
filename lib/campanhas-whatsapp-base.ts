// O que toda parte do MOTOR das campanhas em blocos usa (lib/campanhas-whatsapp.ts
// explica o motor inteiro): a execução como o motor a carrega, os eventos, as
// transições de estado de uma execução reservada (concluir, falhar, estacionar),
// a conversa oficial do contato e as constantes de tempo. Dividido do motor em
// 2026-10-28 (pedido dele: o arquivo passava de 1.300 linhas), sem mudar nada.
//
// TODA TRANSIÇÃO daqui só vale para a execução 'enviando' (reservada pela rodada
// que chama): se alguém a encerrou no meio (descadastro, edição), a instrução
// não acha a linha e nada muda.
import "server-only";
import { sql } from "@/lib/db";
import { soDigitos } from "@/lib/telefone";
import { dadosDoContato, type DadosDoContato } from "@/lib/templates-whatsapp";
import type { BlocoCampanha, Destino, FluxoCampanha } from "@/lib/campanhas-fluxo";

// ── Eventos ─────────────────────────────────────────────────────────────────

export type Detalhe = Record<string, unknown>;

export async function evento(campanhaId: string, execucaoId: string | null, tipo: string, detalhe: Detalhe = {}) {
  await sql`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
            VALUES (${campanhaId}::uuid, ${execucaoId}::uuid, ${tipo}, ${sql.json(detalhe as never)})`;
}

// ── A execução ──────────────────────────────────────────────────────────────

export type Execucao = {
  id: string;
  campanha_id: string;
  campanha_nome: string;
  contato_id: string;
  bloco_atual: string | null;
  contato_nome: string;
  whatsapp: string | null;
  email: string | null;
  cidade: string | null;
  telefone_id: string;
  telefone_exibicao: string;
  waba_id: string;
  template_nome: string;
  template_idioma: string;
  definicao: unknown;
};

/** O que a rodada fez que importa a quem chamou: o webhook só deixa a IA responder a mensagem consumida se o fluxo a ligou. */
export type Efeitos = { ligouIa: boolean };

export type Passo = { tipo: "segue"; destino: Destino } | { tipo: "parou" };
export const segue = (destino: Destino): Passo => ({ tipo: "segue", destino });
export const PAROU: Passo = { tipo: "parou" };

export const RESERVA = "15 minutes";
export const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
export const ehBloco = (f: FluxoCampanha, id: string) => Object.hasOwn(f.blocos, id);
export const dadosDe = (e: Execucao): DadosDoContato =>
  dadosDoContato({ nome: e.contato_nome, whatsapp: e.whatsapp, email: e.email, cidade: e.cidade });

/** Folga para o relógio da Meta e o nosso: a resposta vale a partir do envio que o bloco aguarda. */
export const FOLGA_RELOGIO_MS = 5_000;

/** 23505 no índice único de resposta_id: a mesma mensagem já andou outro fluxo (corrida com o webhook). */
export const respostaRepetida = (e: unknown) => (e as { code?: string })?.code === "23505";

export const ADIAR_MINUTOS = 10;

export const MOTIVO_PRESA = "A rodada parou no meio (mais de 15 minutos sem terminar): não reenviado, para não mandar em dobro.";

export async function eventoBloco(e: Execucao, id: string, b: BlocoCampanha, r: { saida?: string; ok: boolean; erro?: string; wamid?: string | null }) {
  await evento(e.campanha_id, e.id, "bloco", { bloco: id, tipo: b.tipo, ...r });
}

/** O bloco já rodou nesta execução (sem laço, só uma vez): é o que separa "chegou ao Esperar" de "a espera acabou". */
export async function jaComecou(e: Execucao, id: string): Promise<boolean> {
  const [r] = await sql`
    SELECT 1 FROM campanha_whatsapp_eventos
     WHERE campanha_id = ${e.campanha_id}::uuid AND execucao_id = ${e.id}::uuid
       AND tipo = 'bloco' AND detalhe->>'bloco' = ${id}
     LIMIT 1`;
  return !!r;
}

// ── Transições da execução reservada ────────────────────────────────────────

export async function concluir(e: Execucao) {
  await sql`
    UPDATE campanha_whatsapp_execucoes
       SET estado = 'concluida', bloco_atual = NULL, prazo_resposta = NULL, finalizado_em = now()
     WHERE id = ${e.id}::uuid AND estado = 'enviando'`;
}

export async function falhar(e: Execucao, onde: { id: string; b: BlocoCampanha } | null, erro: string) {
  await sql`
    UPDATE campanha_whatsapp_execucoes
       SET estado = 'falhou', erro = ${erro}, bloco_atual = COALESCE(${onde?.id ?? null}, bloco_atual),
           prazo_resposta = NULL, finalizado_em = now()
     WHERE id = ${e.id}::uuid AND estado = 'enviando'`;
  if (onde) await eventoBloco(e, onde.id, onde.b, { ok: false, erro });
  else await evento(e.campanha_id, e.id, "falhou", { erro });
}

/** Para em `id` e volta a rodar em `minutos` (0 = na próxima rodada, se a campanha estiver ativa). */
export async function estacionar(e: Execucao, id: string, minutos: number) {
  await sql`
    UPDATE campanha_whatsapp_execucoes
       SET estado = 'em_andamento', bloco_atual = ${id},
           prazo_resposta = now() + make_interval(mins => ${minutos}::int)
     WHERE id = ${e.id}::uuid AND estado = 'enviando'`;
}

/** Para em `id` até a hora `quando` (Horário de envio fora da janela, Permissão de passagem cheia). */
export async function estacionarAte(e: Execucao, id: string, quando: Date) {
  await sql`
    UPDATE campanha_whatsapp_execucoes
       SET estado = 'em_andamento', bloco_atual = ${id}, prazo_resposta = ${quando}
     WHERE id = ${e.id}::uuid AND estado = 'enviando'`;
}

// ── A conversa oficial do contato ───────────────────────────────────────────

export type Conversa = { id: string; responsavel_id: string | null; status: string };

/** A conversa do contato no número da campanha: é nela que o texto sai e é o link do aviso. */
export async function conversaOficial(e: Execucao): Promise<Conversa | null> {
  const [a] = (await sql`
    SELECT id, responsavel_id, status FROM atendimentos
     WHERE contato_id = ${e.contato_id}::uuid AND canal = 'whatsapp_oficial'
       AND numero_instancia = ${soDigitos(e.telefone_exibicao)}
     LIMIT 1`) as Conversa[];
  return a ?? null;
}

/** Alguém da equipe assumiu a conversa: a campanha não fala por cima nem liga a IA. */
export const temGente = (c: Conversa) => c.responsavel_id !== null && c.status !== "encerrado";
