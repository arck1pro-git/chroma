// Fim de execução, avisado pelo motor. É a fonte da verdade do estado de
// `fluxo_execucoes` — o polling do /executions do motor fica só para
// reconciliar as 'perdidas' (docs/automacoes-n8n.md §6).
//
// Sem esta rota, uma execução ficaria 'pendente' para sempre e o índice
// ux_execucao_ativa_por_entidade impediria a mesma oportunidade de entrar de
// novo na cadência — o fluxo travaria sozinho no segundo disparo.

import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";

export const dynamic = "force-dynamic";

function texto(v: unknown, max: number) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return naoAutorizado();

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "Corpo inválido." }, { status: 400 });
  }

  const execucaoId = texto(corpo.execucao_id, 64).trim();
  if (!execucaoId) {
    return Response.json({ erro: "Falta execucao_id." }, { status: 400 });
  }

  // O motor não sabe se um bloco falhou — quem soube foi o CRM, e ele já
  // gravou o passo. Então o estado final sai DOS PASSOS, não do que o corpo
  // afirma: um POST forjado não consegue marcar como sucesso uma execução que
  // errou.
  const [passos] = await sql`
    SELECT COALESCE(SUM((estado = 'erro')::int), 0)::int AS erros,
           count(*)::int AS total
    FROM fluxo_execucao_passos WHERE execucao_id = ${execucaoId}`;

  const houveErro = ((passos?.erros as number) ?? 0) > 0;

  const [erroNo] = houveErro
    ? await sql`
        SELECT no_id, erro FROM fluxo_execucao_passos
        WHERE execucao_id = ${execucaoId} AND estado = 'erro'
        ORDER BY ordem LIMIT 1`
    : [undefined];

  await sql`
    UPDATE fluxo_execucoes SET
      estado = ${houveErro ? "erro" : "sucesso"},
      erro_no = ${erroNo?.no_id ?? null},
      erro_msg = ${erroNo?.erro ?? null},
      motor_execucao_id = COALESCE(${texto(corpo.motor_execucao_id, 64) || null},
                                   motor_execucao_id),
      finalizado_em = now(),
      duracao_ms = EXTRACT(EPOCH FROM (now() - iniciado_em))::int * 1000
    WHERE id = ${execucaoId}
      AND estado IN ('pendente', 'rodando', 'esperando')`;

  // Espera pendurada de uma execução que acabou não pode continuar viva: ela é
  // o que a tela mostra como "parado em Esperar" e o que o webhook da uazapi
  // consulta ao chegar resposta.
  await sql`
    UPDATE fluxo_esperas SET estado = 'cancelada'
    WHERE execucao_id = ${execucaoId} AND estado = 'ativa'`;

  return Response.json({
    ok: true,
    estado: houveErro ? "erro" : "sucesso",
    passos: (passos?.total as number) ?? 0,
  });
}
