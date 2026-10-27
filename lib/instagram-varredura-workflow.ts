import "server-only";
import {
  acharWorkflowPorNome,
  ativarWorkflow,
  criarWorkflow,
  lerWorkflow,
  type WorkflowMotor,
} from "@/lib/automacoes/motores/n8n/adaptador";
import { garantirCredencialDoCrm } from "@/lib/campanhas-workflow";

export const NOME_VARREDURA_INSTAGRAM = "[Chroma] Instagram · conferir comentarios";
export const URL_VARREDURA_INSTAGRAM = "https://amaanoffice.amaan.com.br/api/meta/instagram/varrer";

/** Apenas a referência ao cofre do motor vai para o workflow. */
export function montarWorkflowVarreduraInstagram(credencialId: string): WorkflowMotor {
  const agenda = "A cada minuto";
  const executar = "Conferir comentários do Instagram";
  return {
    name: NOME_VARREDURA_INSTAGRAM,
    nodes: [
      {
        id: "agenda", name: agenda, type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2,
        position: [0, 0],
        parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } },
      },
      {
        id: "conferir", name: executar, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
        position: [260, 0],
        parameters: {
          method: "POST", url: URL_VARREDURA_INSTAGRAM,
          authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
          options: { timeout: 250000 },
        },
        credentials: { httpHeaderAuth: { id: credencialId, name: "Chroma · CRM (token de serviço)" } },
      },
    ],
    connections: { [agenda]: { main: [[{ node: executar, type: "main", index: 0 }]] } },
    settings: { executionOrder: "v1" },
  };
}

/** Confere o destino antes de ativar; nunca altera a definição de um workflow existente. */
export async function garantirVarreduraInstagram(): Promise<{ id: string; active: boolean }> {
  const existente = await acharWorkflowPorNome(NOME_VARREDURA_INSTAGRAM);
  let id: string;
  if (existente) {
    id = existente.id;
    const workflow = await lerWorkflow(id) as WorkflowMotor & { active?: boolean };
    const chamadas = workflow.nodes?.filter((no) => no.type === "n8n-nodes-base.httpRequest") ?? [];
    if (workflow.name !== NOME_VARREDURA_INSTAGRAM || chamadas.length !== 1 ||
        chamadas[0].parameters.url !== URL_VARREDURA_INSTAGRAM || chamadas[0].parameters.method !== "POST") {
      throw new Error("O agendador de comentários existente tem destino diferente. Nenhuma alteração foi aplicada.");
    }
    if (!workflow.active) await ativarWorkflow(id);
  } else {
    const credencial = await garantirCredencialDoCrm();
    id = await criarWorkflow(montarWorkflowVarreduraInstagram(credencial.id));
    await ativarWorkflow(id);
  }
  const confirmado = await lerWorkflow(id) as { active?: boolean };
  return { id, active: confirmado.active === true };
}
