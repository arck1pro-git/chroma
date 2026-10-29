// O agendador das mensagens agendadas no n8n (2026-10-29): a cada minuto chama
// /api/chat/agendadas/enviar, que manda o que venceu (lib/mensagens-agendadas.ts,
// enviarAgendadasVencidas). De minuto em minuto, como o dos posts
// (lib/social/agendador.ts): mensagem marcada para as 9h tem que sair às 9h. A
// rodada sem nada vencido é uma consulta só, no índice da fila.
//
// Criado (com autorização dele, 2026-10-29) na primeira vez que alguém agenda
// com o CRM num endereço público. No localhost não cria: o n8n é o de produção,
// compartilhado, e chamaria uma máquina que ele não alcança.
import "server-only";
import { acharWorkflowPorNome, ativarWorkflow, criarWorkflow, type WorkflowMotor } from "@/lib/automacoes/motores/n8n/adaptador";
import { garantirCredencialDoCrm } from "@/lib/campanhas-workflow";

/** Nome fixo: é a chave de "já existe?" (acharWorkflowPorNome). */
export const NOME_AGENDADOR_MENSAGENS = "[Chroma] Mensagens agendadas · enviar";

function montar(crmBaseUrl: string, credencialId: string): WorkflowMotor {
  const gatilho = "A cada minuto";
  const chamar = "Enviar mensagens vencidas";
  return {
    name: NOME_AGENDADOR_MENSAGENS,
    settings: { executionOrder: "v1" },
    nodes: [
      {
        id: "gatilho",
        name: gatilho,
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [0, 0],
        parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } },
      },
      {
        id: "enviar",
        name: chamar,
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [260, 0],
        parameters: {
          method: "POST",
          url: `${crmBaseUrl.replace(/\/+$/, "")}/api/chat/agendadas/enviar`,
          authentication: "genericCredentialType",
          genericAuthType: "httpHeaderAuth",
          // O teto é o maxDuration da rota: um lote com vídeo espera o upload.
          options: { timeout: 300000, response: { response: { neverError: true } } },
        },
        credentials: { httpHeaderAuth: { id: credencialId, name: "Chroma · CRM (token de serviço)" } },
      },
    ],
    connections: { [gatilho]: { main: [[{ node: chamar, type: "main", index: 0 }]] } },
  };
}

// Por instância da função: conferido uma vez, não a cada agendamento.
let garantido = false;

/** Deixa o agendador existindo e ligado. Idempotente. */
export async function garantirAgendadorDeMensagens(crmBaseUrl: string): Promise<void> {
  if (garantido) return;
  const existente = await acharWorkflowPorNome(NOME_AGENDADOR_MENSAGENS);
  if (existente) {
    if (!existente.active) await ativarWorkflow(existente.id);
  } else {
    const credencial = await garantirCredencialDoCrm();
    const id = await criarWorkflow(montar(crmBaseUrl, credencial.id));
    await ativarWorkflow(id);
  }
  garantido = true;
}
