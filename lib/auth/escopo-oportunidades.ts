// O ESCOPO "PRÓPRIO" DO DASHBOARD NAS AÇÕES (2026-10-20, auditoria de segurança).
//
// Quem tem o módulo Dashboard ("inicio") no escopo "próprio" vê no quadro só as
// oportunidades de que é responsável (lib/funil.ts). Mas as ações do
// funil — mover, fechar, excluir, exportar, passar para outro, inscrever em
// fluxo, marcar reunião — só conferiam o MÓDULO e aceitavam o id de qualquer
// oportunidade. Bastava o id (e a IA os entregava) para mexer na de um colega.
//
// Aqui fica a regra única: no escopo "todos", passa tudo; no "próprio", só o
// que tem `responsavel_id` = quem chamou. Quem usa recebe a lista JÁ filtrada
// (ações em lote fazem o que podem e dizem quantas ficaram de fora) ou um
// sim/não para uma oportunidade só.
import "server-only";
import { exigirModulo } from "@/lib/auth/dal";
import { listaUuid, sql } from "@/lib/db";
import { ehUuid } from "@/lib/validacao";

/** As oportunidades da lista que quem chamou pode tocar, e quem chamou. */
export async function oportunidadesNoEscopo(ids: string[]) {
  const acesso = await exigirModulo("inicio");
  const validos = ids.filter((id) => typeof id === "string" && ehUuid(id));
  if (acesso.escopo !== "proprio" || validos.length === 0) return { ...acesso, ids: validos };
  const linhas = await sql`
    SELECT id FROM oportunidades
     WHERE id = ANY(string_to_array(${listaUuid(validos)}, ',')::uuid[])
       AND responsavel_id = ${acesso.usuario.id}`;
  const permitidos = new Set(linhas.map((l) => l.id as string));
  return { ...acesso, ids: validos.filter((id) => permitidos.has(id)) };
}

/** Pode tocar ESTA oportunidade? */
export async function podeTocarOportunidade(id: string): Promise<boolean> {
  const { ids } = await oportunidadesNoEscopo([id]);
  return ids.length === 1;
}

/** Pode tocar a oportunidade desta execução de automação (pausar/retomar na ficha)? */
export async function podeTocarExecucao(execucaoId: string): Promise<boolean> {
  const acesso = await exigirModulo("inicio");
  if (!ehUuid(execucaoId)) return false;
  const [e] = await sql`
    SELECT e.entidade_tipo, e.entidade_id, o.responsavel_id
      FROM fluxo_execucoes e
      LEFT JOIN oportunidades o ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
     WHERE e.id = ${execucaoId}`;
  if (!e) return false;
  if (acesso.escopo !== "proprio") return true;
  return e.entidade_tipo === "oportunidade" && e.responsavel_id === acesso.usuario.id;
}

export const FORA_DO_ESCOPO = "Esta oportunidade não é sua — no seu acesso, você só mexe nas oportunidades de que é responsável.";
