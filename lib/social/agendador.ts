// O agendador dos posts no n8n: a cada minuto chama /api/social/publicar, que
// publica o que venceu (lib/social/posts.ts, publicarVencidos). De minuto em
// minuto e não de 5 em 5 como a retomada da IA: post marcado para as 11h tem
// que sair às 11h. A rodada sem nada vencido é uma consulta só, no índice da
// fila.
//
// Criado na primeira vez que um post entra pelo conector com o CRM num
// endereço público. No localhost não cria: o n8n é o de produção, compartilhado
// (docs/automacoes-n8n.md §5.1), e chamaria uma máquina que ele não alcança.
import "server-only";
import { acharWorkflowPorNome, ativarWorkflow, criarWorkflow, type WorkflowMotor } from "@/lib/automacoes/motores/n8n/adaptador";
import { garantirCredencialDoCrm } from "@/lib/campanhas-workflow";

/** Nome fixo: é a chave de "já existe?" (acharWorkflowPorNome). */
export const NOME_AGENDADOR_POSTS = "[Chroma] Posts sociais · publicar agendados";

function montar(crmBaseUrl: string, credencialId: string): WorkflowMotor {
  const gatilho = "A cada minuto";
  const chamar = "Publicar posts vencidos";
  return {
    name: NOME_AGENDADOR_POSTS,
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
        id: "publicar",
        name: chamar,
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [260, 0],
        parameters: {
          method: "POST",
          url: `${crmBaseUrl.replace(/\/+$/, "")}/api/social/publicar`,
          authentication: "genericCredentialType",
          genericAuthType: "httpHeaderAuth",
          // O teto é o maxDuration da rota: uma rodada com vídeo espera a Meta
          // processar.
          options: { timeout: 300000, response: { response: { neverError: true } } },
        },
        credentials: { httpHeaderAuth: { id: credencialId, name: "Chroma · CRM (token de serviço)" } },
      },
    ],
    connections: { [gatilho]: { main: [[{ node: chamar, type: "main", index: 0 }]] } },
  };
}

// Por instância da função: conferido uma vez, não a cada post.
let garantido = false;

/** Deixa o agendador existindo e ligado. Idempotente. */
export async function garantirAgendadorDePosts(crmBaseUrl: string): Promise<void> {
  if (garantido) return;
  const existente = await acharWorkflowPorNome(NOME_AGENDADOR_POSTS);
  if (existente) {
    if (!existente.active) await ativarWorkflow(existente.id);
  } else {
    const credencial = await garantirCredencialDoCrm();
    const id = await criarWorkflow(montar(crmBaseUrl, credencial.id));
    await ativarWorkflow(id);
  }
  garantido = true;
}
