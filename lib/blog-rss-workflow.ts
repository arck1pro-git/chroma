// O workflow do n8n que gera os artigos por RSS.
//
// A FORMA DELE, e por que é assim:
//
//   [Seg a sex 7h] → [Pauta do dia] → [Separar itens] → [Um por vez] ⇄ [Gerar artigo]
//
// O laço é do n8n. Gerar vários artigos leva de 10 a 20 minutos e nenhum
// `maxDuration` cobre isso — a rota morreria no meio, com parte dos artigos
// gravados e nenhum aviso. Fatiado, cada volta do laço é UMA chamada de UM
// artigo, que cabe folgado, e o motor ganha o que ele sabe fazer: seguir para o
// próximo item quando um falha.
//
// É a Opção B de docs/automacoes-n8n.md aplicada ao blog: o n8n agenda e
// orquestra; quem lê a matéria, escolhe a pauta, chama o modelo e grava é o
// CRM. A agenda (dias, hora, quantos por blog) vem de AGENDA_AUTOMACAO, e quem
// cria, atualiza, liga e pausa o workflow é lib/blog-automacao.ts.
import type { WorkflowMotor } from "@/lib/automacoes/motores/n8n/adaptador";
import { AGENDA_AUTOMACAO } from "@/lib/blog-automacao-tipos";

/**
 * Nome fixo: é a chave de "já existe?" em acharWorkflowPorNome, e o prefixo
 * "[Chroma]" é o que a trava de apagarWorkflow exige para aceitar remover.
 */
export const NOME_WORKFLOW = "[Chroma] Blog · artigos por RSS";

const NO_GATILHO = "Seg a sex, 7h";
export const NO_PAUTA = "Pauta do dia";
const NO_LACO = "Um artigo por vez";
const NO_GERAR = "Gerar artigo";

/** Expressão do n8n: o "=" na frente é o que marca o campo como calculado. */
const expr = (s: string) => `=${s}`;

export function montarWorkflowRss(opcoes: {
  /** Endereço do CRM COMO O n8n O ALCANÇA (não é localhost lá dentro). */
  crmBaseUrl: string;
  /** id, no n8n, da credencial Header Auth com o token de serviço do CRM. */
  credencialId: string;
  credencialNome: string;
}): WorkflowMotor {
  const base = opcoes.crmBaseUrl.replace(/\/+$/, "");
  const auth = {
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
  };
  const credenciais = {
    httpHeaderAuth: { id: opcoes.credencialId, name: opcoes.credencialNome },
  };

  return {
    name: NOME_WORKFLOW,
    // O fuso vai escrito: sem ele o cron segue o fuso da INSTÂNCIA, que é
    // compartilhada e pode estar em UTC — as 7h virariam 4h da manhã aqui.
    settings: { executionOrder: "v1", timezone: AGENDA_AUTOMACAO.fuso },
    nodes: [
      {
        id: "gatilho",
        name: NO_GATILHO,
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [0, 0],
        parameters: {
          rule: {
            interval: [{ field: "cronExpression", expression: AGENDA_AUTOMACAO.cron }],
          },
        },
      },
      {
        id: "pauta",
        name: NO_PAUTA,
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [220, 0],
        parameters: {
          method: "POST",
          url: `${base}/api/blogs/rss/pauta`,
          ...auth,
          // Buscar 5 feeds de cada blog leva alguns segundos; o padrão do nó
          // corta antes em instância lenta.
          options: { timeout: 120000 },
        },
        credentials: credenciais,
      },
      {
        id: "separar",
        name: "Separar itens",
        type: "n8n-nodes-base.splitOut",
        typeVersion: 1,
        position: [440, 0],
        parameters: { fieldToSplitOut: "pauta", options: {} },
      },
      {
        id: "laco",
        name: NO_LACO,
        type: "n8n-nodes-base.splitInBatches",
        typeVersion: 3,
        position: [660, 0],
        // Um de cada vez: dois artigos em paralelo seriam duas chamadas
        // simultâneas ao Opus e duas leituras de matéria, sem ganho — o gargalo
        // é o modelo, não a espera.
        parameters: { batchSize: 1, options: {} },
      },
      {
        id: "gerar",
        name: NO_GERAR,
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [900, 120],
        parameters: {
          method: "POST",
          url: `${base}/api/blogs/rss/gerar`,
          ...auth,
          sendBody: true,
          specifyBody: "json",
          // O item da pauta vai inteiro: {blogId, blogNome, titulo, link}. A
          // rota usa o que precisa e ignora o resto.
          jsonBody: expr("{{ JSON.stringify($json) }}"),
          options: {
            // Ler a matéria + escrever ~1.300 palavras. Cinco minutos é o mesmo
            // teto do maxDuration da rota.
            timeout: 300000,
            response: { response: { neverError: true } },
          },
        },
        credentials: credenciais,
      },
    ],
    connections: {
      [NO_GATILHO]: {
        main: [[{ node: NO_PAUTA, type: "main", index: 0 }]],
      },
      [NO_PAUTA]: {
        main: [[{ node: "Separar itens", type: "main", index: 0 }]],
      },
      "Separar itens": {
        main: [[{ node: NO_LACO, type: "main", index: 0 }]],
      },
      // splitInBatches tem DUAS saídas: 0 = "done" (acabou a lista), 1 = "loop"
      // (próximo item). A saída 0 fica vazia de propósito — quando a lista
      // acaba, não há mais nada a fazer.
      [NO_LACO]: {
        main: [[], [{ node: NO_GERAR, type: "main", index: 0 }]],
      },
      // E o retorno: cada artigo gerado volta ao laço para puxar o próximo.
      [NO_GERAR]: {
        main: [[{ node: NO_LACO, type: "main", index: 0 }]],
      },
    },
  };
}
