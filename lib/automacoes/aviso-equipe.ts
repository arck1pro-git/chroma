// O aviso que a cadência manda para alguém da EQUIPE (o canal "ligação"/aviso,
// bloco enviar_notificacao), montado no CRM no instante do envio.
//
// Pedido dele (2026-10-16): o aviso de "lead não respondeu à cadência" vai no
// mesmo padrão do "lead quer contato" da IA (lib/ia/atendente.ts) — nome,
// WhatsApp e valor — e mais o funil, a etapa e o link da conversa. Os dados
// saem da EXECUÇÃO, que aponta para uma oportunidade só: inferir pelo contato
// pegaria outra quando ele tem duas abertas.
import "server-only";
import { sql } from "@/lib/db";
import { linkDaConversa } from "@/lib/link-do-crm";
import { soDigitos } from "@/lib/telefone";
import { ehUuid } from "@/lib/validacao";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** As linhas de dados do lead que vão no fim do aviso. Vazio se a execução não acha lead. */
export async function dadosDoLeadDaExecucao(execucaoId: string): Promise<string[]> {
  if (!ehUuid(execucaoId)) return [];
  const [l] = await sql`
    SELECT c.nome, c.whatsapp, o.valor, f.nome AS funil, et.nome AS etapa,
           -- A faixa que o lead marcou no formulário ("50 a 100 mil"): é o
           -- que existe quando a oportunidade entrou sem valor.
           nullif(COALESCE(o.campos->>'valor_inicial', c.campos->>'valor_inicial'), '') AS valor_do_formulario,
           (SELECT a.id FROM atendimentos a
             WHERE a.contato_id = c.id
             ORDER BY a.data_atualizacao DESC NULLS LAST, a.data_criacao DESC
             LIMIT 1) AS atendimento_id
      FROM fluxo_execucoes e
      LEFT JOIN oportunidades o ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
      JOIN contatos c
        ON c.id = COALESCE(o.contato_id, CASE WHEN e.entidade_tipo = 'contato' THEN e.entidade_id END)
      LEFT JOIN funis f ON f.id = o.funil_id
      LEFT JOIN etapas et ON et.id = o.etapa_id
     WHERE e.id = ${execucaoId}`;
  if (!l) return [];
  // numeric chega como texto (fetch_types:false, lib/db.ts).
  const valor = Number(l.valor ?? 0);
  return [
    `*Nome:* ${l.nome}`,
    `*WhatsApp:* ${l.whatsapp ? `+${soDigitos(l.whatsapp as string)}` : "não informado"}`,
    `*Valor:* ${valor > 0 ? brl.format(valor) : l.valor_do_formulario ? `${l.valor_do_formulario} (formulário)` : "não informado"}`,
    ...(l.funil ? [`*Funil:* ${l.funil}`] : []),
    ...(l.etapa ? [`*Etapa:* ${l.etapa}`] : []),
    ...(l.atendimento_id ? [`*Conversa:* ${linkDaConversa(l.atendimento_id as string)}`] : []),
  ];
}

/** O responsável da oportunidade da execução, para o aviso com destino "responsavel". */
export async function responsavelDaExecucao(
  execucaoId: string,
): Promise<{ nome: string; whatsapp: string | null } | { erro: string }> {
  if (!ehUuid(execucaoId)) return { erro: "execução inválida para avisar o responsável" };
  const [l] = await sql`
    SELECT o.id AS oportunidade_id, u.id AS usuario_id, u.nome, nullif(u.whatsapp, '') AS whatsapp
      FROM fluxo_execucoes e
      LEFT JOIN oportunidades o ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
      LEFT JOIN usuarios u ON u.id = o.responsavel_id
     WHERE e.id = ${execucaoId}`;
  if (!l?.oportunidade_id) return { erro: "a execução não tem uma oportunidade válida" };
  if (!l.usuario_id) return { erro: "a oportunidade está sem responsável" };
  return { nome: l.nome as string, whatsapp: (l.whatsapp as string | null) ?? null };
}
