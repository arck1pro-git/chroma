// Guardas da porta de serviço: quem pode chamar /api/automacoes/*, quanto pode
// disparar por minuto e se o disparo é de verdade.
//
// Existe separado das rotas porque as três respostas valem para TODAS elas, e
// porque nenhuma delas é opinião: a instância uazapi é COMPARTILHADA com o
// SprintHub (docs/automacoes-n8n.md §5.1), então um fluxo em looping aqui vira
// número banido lá. O documento pede, nesta ordem, rate limit e modo simulação
// ANTES do primeiro disparo real (§7, item 7) — é isto aqui.

import { timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";

// ── Token de serviço ────────────────────────────────────────────────────────

/**
 * Confere o `Authorization: Bearer <CRM_SERVICE_TOKEN>` que o motor manda de
 * volta. Comparação em tempo constante: com `===`, o tempo de resposta vaza o
 * prefixo certo do token e ele cai em algumas milhares de tentativas.
 */
export function autorizado(req: Request): boolean {
  const esperado = process.env.CRM_SERVICE_TOKEN;
  // Sem token configurado a porta fica FECHADA, não aberta. Um default
  // permissivo aqui publicaria um endpoint anônimo que dispara WhatsApp.
  if (!esperado) return false;

  const cabecalho = req.headers.get("authorization") ?? "";
  const recebido = cabecalho.startsWith("Bearer ")
    ? cabecalho.slice(7).trim()
    : "";
  if (!recebido) return false;

  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  // timingSafeEqual estoura se os tamanhos diferem — e o tamanho, esse, já é
  // público (vai no header). Comparar só quando bate evita a exceção.
  return a.length === b.length && timingSafeEqual(a, b);
}

export function naoAutorizado() {
  return Response.json({ erro: "não autorizado" }, { status: 401 });
}

// ── Modo simulação: REMOVIDO em 2026-09-09 ──────────────────────────────────
//
// Havia aqui um `disparoReal()` lendo AUTOMACOES_DISPARAR: enquanto a variável
// não fosse "true", o executor fazia todo o caminho e não chamava a uazapi.
// Saiu por decisão do dono do produto — publicar uma cadência passa a enviar.
//
// O que isso significa na prática, e não é pouco: um bloco mal configurado, ou
// um laço num fluxo, vira mensagem real na `arckwpp`, que é COMPARTILHADA com a
// produção do SprintHub (§5.1 de docs/automacoes-n8n.md). O que sobrou de
// contenção é o rate limit logo abaixo, e ele limita a VELOCIDADE do estrago,
// não o estrago.

// ── Rate limit ──────────────────────────────────────────────────────────────

// Teto conservador: WhatsApp não-oficial em número compartilhado. Ajuste por
// env quando houver histórico para justificar outro número.
const TETO_PADRAO = 12;

function teto() {
  const bruto = Number(process.env.AUTOMACOES_MSGS_POR_MINUTO);
  return Number.isFinite(bruto) && bruto > 0 ? Math.floor(bruto) : TETO_PADRAO;
}

/**
 * Quantas mensagens de automação saíram no último minuto, e se cabe mais uma.
 *
 * Conta em `fluxo_execucao_passos` e não em `mensagens` porque o que precisa
 * de freio é o disparo automático — o que uma pessoa digita no /chat não entra
 * nesta conta, e uma linha de `mensagens` sozinha não distingue as duas.
 *
 * O teto é do CRM inteiro, não por instância: com uma instância em uso hoje, a
 * diferença é nenhuma, e um teto global é o que continua valendo se alguém
 * publicar três cadências no mesmo número.
 */
export async function cabeDisparo(): Promise<
  { ok: true } | { ok: false; erro: string }
> {
  const [linha] = await sql`
    SELECT count(*)::int AS enviadas
    FROM fluxo_execucao_passos
    WHERE no_tipo = 'enviar_whatsapp_web'
      AND estado = 'sucesso'
      AND iniciado_em > now() - interval '1 minute'`;

  const enviadas = (linha?.enviadas as number) ?? 0;
  const limite = teto();
  if (enviadas < limite) return { ok: true };

  return {
    ok: false,
    erro: `Rate limit: ${enviadas} mensagens no último minuto (teto ${limite}). Ajuste AUTOMACOES_MSGS_POR_MINUTO se for intencional.`,
  };
}
