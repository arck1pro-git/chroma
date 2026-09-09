// ÚNICO lugar do projeto que conhece o n8n.
//
// Regra que torna a troca de motor verificável: a string "n8n" não deve
// aparecer fora de lib/automacoes/motores/n8n/. Dá para checar em CI com grep.
//
// A instância é COMPARTILHADA com automação de produção da empresa (SprintHub,
// landing pages, disparo de WhatsApp). Por isso este adaptador:
//   · nunca lista workflows para decidir o que mexer
//   · nunca resolve workflow por nome — só por id que o CRM gravou
//   · não expõe DELETE
// Ver docs/automacoes-n8n.md §5.1.

import type { PlanoCompilado } from "../../compilador";

const BASE = process.env.N8N_BASE_URL;
const CHAVE = process.env.N8N_API_KEY;

export type WorkflowMotor = {
  name: string;
  nodes: NoN8n[];
  connections: Record<string, { main: { node: string; type: "main"; index: number }[][] }>;
  settings: Record<string, unknown>;
};

type NoN8n = {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
};

// Nome do nó no n8n. Usa o id do CRM como sufixo para o callback de erro
// conseguir dizer QUAL bloco falhou no vocabulário do CRM, não no do n8n.
function nomeDoNo(p: { id: string; rotulo: string }) {
  return `${p.rotulo} [${p.id}]`;
}

// O nó de entrada é referenciado por NOME dentro das expressões (é de lá que
// sai o execucao_id de todo bloco), então a string tem que ser uma só.
const NOME_ENTRADA = "Entrada do fluxo";
const NOME_FIM = "Fim da execução";

// De onde cada bloco tira o execucao_id.
//
// Não dá para usar `$json.execucao_id`: no primeiro bloco `$json` é a saída do
// Webhook node, que embrulha o corpo em `body`, e nos seguintes é a resposta do
// bloco anterior. Referenciar o nó de entrada pelo nome vale igual nos dois —
// e é o que faz uma cadência de 18 mensagens carregar a mesma execução até o
// fim em vez de perder o id na segunda.
const EXECUCAO_ID = `{{ $('${NOME_ENTRADA}').item.json.body.execucao_id }}`;

// Corpo de um POST de volta ao CRM. O "=" na frente é o que liga a avaliação
// de expressão do n8n no parâmetro inteiro — sem ele, `{{ … }}` viaja literal
// e o CRM recebe a string em vez do id.
function corpoParaCrm(campos: Record<string, unknown>) {
  return "=" + JSON.stringify(campos);
}

/**
 * Autenticação dos nós que voltam ao CRM: o header escrito direto no nó, com o
 * CRM_SERVICE_TOKEN que já existe no .env.
 *
 * A alternativa era uma credencial Header Auth cadastrada dentro do motor, com
 * o CRM guardando só o id (é para isso que a tabela motor_credenciais existe, e
 * o docs/automacoes-n8n.md §3 ainda descreve esse caminho). Ficou de fora por
 * decisão explícita: era um passo manual na UI do motor antes de qualquer
 * publicação funcionar, e não temos credencial cadastrada lá.
 *
 * O QUE ISSO CUSTA, e é bom saber: o token passa a viajar em texto no JSON do
 * workflow. A instância é compartilhada (§5.1) — quem abrir o workflow lê o
 * token, e com ele consegue reexecutar blocos de fluxos publicados, isto é,
 * reenviar mensagem para contatos. Credencial do motor seria mascarada; um
 * parâmetro de nó não é.
 *
 * Consequência prática: trocar o CRM_SERVICE_TOKEN exige REPUBLICAR os fluxos,
 * senão eles seguem mandando o token antigo e o CRM responde 401.
 */
function cabecalhoDoCrm() {
  const token = process.env.CRM_SERVICE_TOKEN;
  // Publicar sem token geraria nós com "Bearer undefined": workflow ativo,
  // 401 em cada bloco. Falhar aqui é a única leitura honesta.
  if (!token) {
    throw new Error(
      "CRM_SERVICE_TOKEN não definida — sem ela os blocos publicados não conseguiriam voltar ao CRM.",
    );
  }
  return {
    sendHeaders: true,
    headerParameters: {
      parameters: [{ name: "Authorization", value: `Bearer ${token}` }],
    },
  };
}

/**
 * Endereço do CRM, do ponto de vista do motor. Ele é ASSADO dentro de cada nó
 * no momento da publicação — não é lido em tempo de execução —, então um valor
 * ruim aqui vira um workflow ativo que falha calado.
 *
 * Foi o que aconteceu em 2026-09-04: com CRM_BASE_URL vazia, o `??` de antes
 * (que só cobre null/undefined) deixava passar a string vazia e o nó ia para o
 * motor apontando para "/api/automacoes/acao", relativo. O fluxo publicava, a
 * execução era criada e morria no primeiro bloco, sem passo e sem callback —
 * 'pendente' para sempre.
 */
function baseDoCrm() {
  const bruto = (process.env.CRM_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!bruto) {
    throw new Error(
      "CRM_BASE_URL está vazia. Ela é gravada dentro do workflow, então o motor precisa de um endereço ABSOLUTO e alcançável por ele — em desenvolvimento, a URL de um túnel (ngrok, cloudflared) para o seu localhost.",
    );
  }
  if (!/^https?:\/\/[^/]+/i.test(bruto)) {
    throw new Error(
      `CRM_BASE_URL inválida ("${bruto}"): precisa começar com http:// ou https:// e ter host. O motor não resolve caminho relativo.`,
    );
  }
  return bruto;
}

/**
 * Traduz o plano neutro para o JSON do n8n.
 *
 * Toda ação vira um HTTP Request de volta para o CRM (Opção B do
 * docs/automacoes-n8n.md §1): o n8n orquestra, o CRM executa. É o que mantém a
 * mensagem de automação aparecendo no chat e o rate limit num ponto só.
 */
export function paraWorkflow(plano: PlanoCompilado): WorkflowMotor {
  const nodes: NoN8n[] = [];
  const connections: WorkflowMotor["connections"] = {};

  const gatilho: NoN8n = {
    id: plano.entrada.id,
    name: NOME_ENTRADA,
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [plano.entrada.posicao.x, plano.entrada.posicao.y],
    parameters: {
      path: plano.webhookCaminho,
      httpMethod: "POST",
      responseMode: "onReceived",
    },
  };
  nodes.push(gatilho);

  const autenticacao = cabecalhoDoCrm();
  const crm = baseDoCrm();

  for (const passo of plano.passos) {
    if (passo.tipo === "se") {
      nodes.push({
        id: passo.id,
        name: nomeDoNo(passo),
        type: "n8n-nodes-base.if",
        typeVersion: 2,
        position: [passo.posicao.x, passo.posicao.y],
        parameters: { conditions: passo.config.condicao ?? {} },
      });
      continue;
    }

    if (passo.tipo === "alternador") {
      nodes.push({
        id: passo.id,
        name: nomeDoNo(passo),
        type: "n8n-nodes-base.switch",
        typeVersion: 3,
        position: [passo.posicao.x, passo.posicao.y],
        parameters: { rules: passo.config.casos ?? {} },
      });
      continue;
    }

    if (passo.tipo === "esperar" || passo.tipo === "verificar_resposta") {
      nodes.push({
        id: passo.id,
        name: nomeDoNo(passo),
        type: "n8n-nodes-base.wait",
        typeVersion: 1.1,
        position: [passo.posicao.x, passo.posicao.y],
        parameters: {
          resume: passo.tipo === "esperar" ? "timeInterval" : "webhook",
          amount: passo.config.minutos ?? 5,
          unit: "minutes",
        },
      });
      continue;
    }

    // Todo o resto: o CRM executa.
    nodes.push({
      id: passo.id,
      name: nomeDoNo(passo),
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [passo.posicao.x, passo.posicao.y],
      parameters: {
        method: "POST",
        url: `${crm}/api/automacoes/acao`,
        ...autenticacao,
        sendBody: true,
        specifyBody: "json",
        // SÓ ponteiros: fluxo, nó e execução. O `tipo` e a `config` do bloco
        // NÃO viajam, e não é economia de bytes — são duas coisas:
        //
        // 1. Colisão de sintaxe. Este corpo é uma expressão do motor (o "=" na
        //    frente), e o motor avalia `{{ … }}` dentro dela. Uma mensagem com
        //    {{primeiro_nome}} seria avaliada LÁ, onde essa variável não
        //    existe, e chegaria aqui vazia ou quebrada.
        // 2. Confiança. Quem alcança /api/automacoes/acao com o token poderia
        //    mandar qualquer texto para qualquer contato. Lendo a config da
        //    versão PUBLICADA, o pior que um corpo forjado faz é reexecutar um
        //    bloco que já existe.
        jsonBody: corpoParaCrm({
          fluxo_id: plano.fluxoId,
          no_id: passo.id,
          execucao_id: EXECUCAO_ID,
        }),
      },
    });
  }

  // Nó de fim: avisa o CRM que a execução acabou (§5 do documento). Sem ele a
  // linha de fluxo_execucoes fica 'pendente' para sempre, e o índice parcial
  // ux_execucao_ativa_por_entidade passa a recusar a mesma oportunidade no
  // disparo seguinte — o fluxo travaria sozinho na segunda vez.
  const fim: NoN8n = {
    id: "__fim__",
    name: NOME_FIM,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    // Uma linha abaixo do bloco mais fundo, para não cair em cima de ninguém.
    position: [0, Math.max(0, ...plano.passos.map((p) => p.posicao.y)) + 130],
    parameters: {
      method: "POST",
      url: `${crm}/api/automacoes/callback`,
      ...autenticacao,
      sendBody: true,
      specifyBody: "json",
      jsonBody: corpoParaCrm({
        fluxo_id: plano.fluxoId,
        execucao_id: EXECUCAO_ID,
        motor_execucao_id: "{{ $execution.id }}",
      }),
    },
  };
  nodes.push(fim);

  // Conexões: main[índiceDaSaída] = lista de destinos.
  const porId = new Map(plano.passos.map((p) => [p.id, p]));
  const nomePorId = new Map<string, string>([[plano.entrada.id, gatilho.name]]);
  for (const p of plano.passos) nomePorId.set(p.id, nomeDoNo(p));

  const paraFim = [{ node: NOME_FIM, type: "main" as const, index: 0 }];

  // Do webhook direto para o começo da corrente. Fluxo sem primeiro bloco não
  // passa no compilador, mas o fim cobre o caso em vez de deixar a saída solta.
  const inicioDaCorrente = plano.entrada.proximo
    ? (nomePorId.get(plano.entrada.proximo) ?? null)
    : null;
  connections[gatilho.name] = {
    main: [
      inicioDaCorrente
        ? [{ node: inicioDaCorrente, type: "main", index: 0 }]
        : paraFim,
    ],
  };

  for (const p of plano.passos) {
    const saidas = Object.entries(p.destinos);
    // Saída sem destino é o FIM de um caminho — e todo caminho tem que passar
    // pelo aviso de fim, senão a execução só é encerrada nos ramos que por
    // acaso terminam no último bloco desenhado.
    const main = saidas.map(([, destinoId]) => {
      if (!destinoId) return paraFim;
      const nome = nomePorId.get(destinoId);
      return nome ? [{ node: nome, type: "main" as const, index: 0 }] : paraFim;
    });
    // Bloco sem saída nenhuma no catálogo (hoje só "Mudar fluxo"): liga direto.
    connections[nomePorId.get(p.id)!] = {
      main: main.length > 0 ? main : [paraFim],
    };
  }

  void porId;

  return {
    name: `[Chroma] ${plano.nome}`,
    nodes,
    connections,
    settings: { executionOrder: "v1" },
  };
}

/**
 * Manda o motor COMEÇAR uma execução. É o único ponto em que o CRM chama o
 * workflow publicado — a URL de produção do webhook é {BASE}/webhook/{caminho}.
 *
 * O segredo do fluxo vai no header. ⚠ Hoje nada do lado do motor o confere: o
 * Webhook node sem credencial aceita qualquer POST que acerte o caminho. O
 * caminho contém o uuid do fluxo, o que é uma barreira de adivinhação, não de
 * autenticação — ver docs/automacoes-n8n.md §5.
 */
export async function dispararWebhook(
  caminho: string,
  segredo: string,
  corpo: Record<string, unknown>,
) {
  if (!BASE) throw new Error("N8N_BASE_URL não definida");

  const res = await fetch(`${BASE}/webhook/${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-chroma-segredo": segredo },
    body: JSON.stringify(corpo),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    // 404 aqui quase sempre é workflow inativo: o n8n só registra a URL de
    // produção do webhook quando o workflow está ativo.
    throw new Error(
      res.status === 404
        ? "O motor não reconhece o webhook deste fluxo — publique de novo (ele precisa estar ativo)."
        : `motor ${res.status}: ${texto.slice(0, 200)}`,
    );
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

function conferirEnv() {
  if (!BASE) throw new Error("N8N_BASE_URL não definida");
  if (!CHAVE) throw new Error("N8N_API_KEY não definida");
}

async function chamar(caminho: string, init: RequestInit = {}) {
  conferirEnv();
  const res = await fetch(`${BASE}/api/v1${caminho}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": CHAVE!,
      "Content-Type": "application/json",
      ...init.headers,
    },
    // O n8n é externo: sem teto, uma instância lenta pendura a server action.
    signal: AbortSignal.timeout(20_000),
  });

  const texto = await res.text();
  if (!res.ok) {
    throw new Error(`n8n ${res.status}: ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : null;
}

export async function criarWorkflow(wf: WorkflowMotor): Promise<string> {
  // `active` não vai no POST: em várias versões a API pública rejeita o campo
  // na criação. Ativar é chamada própria.
  const criado = await chamar("/workflows", {
    method: "POST",
    body: JSON.stringify(wf),
  });
  return criado.id as string;
}

export async function atualizarWorkflow(id: string, wf: WorkflowMotor) {
  await chamar(`/workflows/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(wf),
  });
}

export async function ativarWorkflow(id: string) {
  await chamar(`/workflows/${encodeURIComponent(id)}/activate`, {
    method: "POST",
  });
}

export async function desativarWorkflow(id: string) {
  await chamar(`/workflows/${encodeURIComponent(id)}/deactivate`, {
    method: "POST",
  });
}

// Usado só para reconciliação (§2.5) — nunca para descobrir o que mexer.
export async function lerWorkflow(id: string) {
  return chamar(`/workflows/${encodeURIComponent(id)}`);
}
