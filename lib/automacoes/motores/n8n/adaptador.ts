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

// O nó que carrega o lead. Todo bloco referencia ele por NOME para pegar
// nome/whatsapp — e é por isso que a string existe uma vez só.
const NOME_LEAD = "Carregar lead";

/**
 * Traduz o template do CRM (`{{primeiro_nome}}`) para expressão do n8n.
 *
 * As duas sintaxes usam `{{ }}`, e é exatamente daí que vinha o problema que
 * fazia o texto NÃO poder viajar até o motor: o n8n avaliava `{{primeiro_nome}}`
 * no contexto dele, onde a variável não existe, e mandava vazio. Traduzindo na
 * compilação, a mesma marca passa a apontar para a saída do nó que carregou o
 * lead — e aí o motor resolve certo.
 *
 * Campo desconhecido vira string vazia em vez de quebrar a expressão inteira:
 * uma mensagem com um buraco é melhor que um workflow que não roda.
 */
function textoParaExpressao(bruto: string): string {
  const escapado = bruto.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return escapado.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_, campo) => {
    return `{{ $('${NOME_LEAD}').first().json.${campo} ?? '' }}`;
  });
}

/** Parâmetro de expressão do n8n: o "=" na frente liga a avaliação. */
function expr(valor: string) {
  return "=" + valor;
}

export type CredenciaisMotor = {
  /** id da credencial Postgres no n8n (role chroma_n8n). */
  banco: string;
  /** id da credencial Header Auth com o token da uazapi. */
  uazapi: string;
  /** base_url da instância de WhatsApp, ex.: https://arckwpp.uazapi.com */
  uazapiBaseUrl: string;
};

function credPostgres(c: CredenciaisMotor) {
  return { postgres: { id: c.banco, name: "Chroma · Postgres" } };
}

/**
 * Traduz o plano neutro para o JSON do n8n.
 *
 * O n8n FAZ o trabalho: manda o WhatsApp pela uazapi e grava no mesmo Postgres
 * do CRM, pelos próprios nós. Antes cada ação era um HTTP Request de volta para
 * /api/automacoes/acao e quem executava era o CRM — o que exigia o CRM ser
 * alcançável pelo motor (túnel em desenvolvimento) e mantinha um executor de
 * 459 linhas do outro lado.
 *
 * O que se ganha: publicar passa a bastar. Sem túnel, sem CRM_BASE_URL, sem
 * token de serviço, sem callback.
 *
 * O que isso exige, e é o preço: credencial do banco DENTRO do n8n, que é uma
 * instância compartilhada. Por isso ela é do role `chroma_n8n`
 * (migration-role-n8n.sql), que grava mensagem e passo e não apaga nada.
 */
export function paraWorkflow(
  plano: PlanoCompilado,
  cred: CredenciaisMotor,
): WorkflowMotor {
  const nodes: NoN8n[] = [];
  const connections: WorkflowMotor["connections"] = {};
  // Nome do nó por onde a corrente SAI de cada bloco. Igual ao nome do bloco na
  // maioria; diferente quando um bloco vira mais de um nó (o WhatsApp vira o
  // envio + o registro), e é isso que mantém as ligações corretas.
  const saidaDoBloco = new Map<string, string>();

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

  // Carrega o lead UMA vez, no começo. Os blocos leem daqui em vez de receber
  // os dados no corpo do webhook — e a diferença importa: uma cadência espera
  // dias entre mensagens, e o número que vale é o de AGORA, não o de quando a
  // execução começou.
  //
  // COALESCE nas duas pontas porque a execução pode ser de contato OU de
  // oportunidade: a mesma consulta serve as duas, e o que não se aplica volta
  // nulo em vez de exigir dois workflows diferentes.
  const carregarLead: NoN8n = {
    id: "__lead__",
    name: NOME_LEAD,
    type: "n8n-nodes-base.postgres",
    typeVersion: 2.4,
    position: [plano.entrada.posicao.x, plano.entrada.posicao.y + 130],
    parameters: {
      operation: "executeQuery",
      query: `
        SELECT c.id            AS contato_id,
               c.nome          AS nome,
               split_part(c.nome, ' ', 1) AS primeiro_nome,
               c.whatsapp      AS whatsapp,
               regexp_replace(c.whatsapp, '\\D', '', 'g') AS numero,
               c.email         AS email,
               c.cidade        AS cidade,
               o.id            AS oportunidade_id,
               o.nome          AS oportunidade,
               o.valor         AS valor,
               u.nome          AS responsavel
        FROM fluxo_execucoes e
        LEFT JOIN oportunidades o ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
        LEFT JOIN contatos     c ON c.id = COALESCE(o.contato_id, e.entidade_id)
        LEFT JOIN usuarios     u ON u.id = o.responsavel_id
        WHERE e.id = $1`,
      options: { queryReplacement: expr(EXECUCAO_ID) },
    },
    credentials: credPostgres(cred),
  };
  nodes.push(carregarLead);

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

    if (passo.tipo === "enviar_whatsapp_web") {
      // DOIS nós: manda e registra. Separados porque o registro precisa do
      // RETORNO da uazapi (o messageid, que é como o webhook de entrega casa a
      // mensagem depois) — num nó só, ou se grava antes sem o id, ou se manda
      // sem deixar rastro.
      const envio = nomeDoNo(passo);
      const registro = `Registrar [${passo.id}]`;

      nodes.push({
        id: passo.id,
        name: envio,
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [passo.posicao.x, passo.posicao.y],
        parameters: {
          method: "POST",
          url: `${cred.uazapiBaseUrl}/send/text`,
          authentication: "genericCredentialType",
          genericAuthType: "httpHeaderAuth",
          sendBody: true,
          specifyBody: "json",
          jsonBody: expr(
            JSON.stringify({
              number: `{{ $('${NOME_LEAD}').first().json.numero }}`,
              text: textoParaExpressao(String(passo.config.texto ?? "")),
            }),
          ),
        },
        credentials: { httpHeaderAuth: { id: cred.uazapi, name: "Chroma · uazapi" } },
      });

      // O atendimento é resolvido no próprio INSERT: ON CONFLICT não serve
      // aqui (não há chave única de "conversa aberta"), então a subconsulta
      // pega a mais recente não encerrada. Sem ela, uma cadência de 18
      // mensagens criaria 18 conversas na tela do chat.
      nodes.push({
        id: `${passo.id}__reg`,
        name: registro,
        type: "n8n-nodes-base.postgres",
        typeVersion: 2.4,
        position: [passo.posicao.x + 190, passo.posicao.y],
        parameters: {
          operation: "executeQuery",
          query: `
            INSERT INTO mensagens
              (atendimento_id, origem, autor_id, texto, status, id_externo)
            SELECT a.id, 'agente', NULL, $2, 'enviado', $3
            FROM atendimentos a
            WHERE a.contato_id = $1::uuid AND a.status <> 'encerrado'
            ORDER BY a.data_criacao DESC
            LIMIT 1`,
          options: {
            queryReplacement: expr(
              [
                `{{ $('${NOME_LEAD}').first().json.contato_id }}`,
                `{{ $('${envio}').first().json.text ?? '' }}`,
                `{{ $('${envio}').first().json.messageid ?? '' }}`,
              ].join(","),
            ),
          },
        },
        credentials: credPostgres(cred),
      });

      saidaDoBloco.set(passo.id, registro);
      continue;
    }

    // Bloco de ação que ainda não tem nó nativo: um No-Op nomeado, para o
    // desenho continuar ligado e a falta ficar VISÍVEL no motor em vez de o
    // fluxo terminar calado no meio.
    nodes.push({
      id: passo.id,
      name: nomeDoNo(passo),
      type: "n8n-nodes-base.noOp",
      typeVersion: 1,
      position: [passo.posicao.x, passo.posicao.y],
      parameters: {},
    });
  }

  // Nó de fim: fecha a execução no banco. Sem ele a linha de fluxo_execucoes
  // fica 'pendente' para sempre, e o índice parcial ux_execucao_ativa_por_entidade
  // passa a recusar a mesma oportunidade no disparo seguinte — o fluxo travaria
  // sozinho na segunda vez.
  //
  // O UPDATE é condicionado ao estado: uma execução PAUSADA ou CANCELADA pela
  // ficha da oportunidade não pode ser marcada 'sucesso' por um ramo do motor
  // que acordou depois. Era o executor que garantia isso; agora é o WHERE.
  const fim: NoN8n = {
    id: "__fim__",
    name: NOME_FIM,
    type: "n8n-nodes-base.postgres",
    typeVersion: 2.4,
    // Uma linha abaixo do bloco mais fundo, para não cair em cima de ninguém.
    position: [0, Math.max(0, ...plano.passos.map((p) => p.posicao.y)) + 130],
    parameters: {
      operation: "executeQuery",
      query: `
        UPDATE fluxo_execucoes SET
          estado = 'sucesso',
          finalizado_em = now(),
          duracao_ms = EXTRACT(EPOCH FROM (now() - iniciado_em))::int * 1000,
          motor_execucao_id = $2
        WHERE id = $1::uuid
          AND estado IN ('pendente','rodando','esperando')`,
      options: {
        queryReplacement: expr(
          [EXECUCAO_ID, "{{ $execution.id }}"].join(","),
        ),
      },
    },
    credentials: credPostgres(cred),
  };
  nodes.push(fim);

  // Conexões: main[índiceDaSaída] = lista de destinos.
  const porId = new Map(plano.passos.map((p) => [p.id, p]));
  const nomePorId = new Map<string, string>([[plano.entrada.id, gatilho.name]]);
  for (const p of plano.passos) nomePorId.set(p.id, nomeDoNo(p));

  const paraFim = [{ node: NOME_FIM, type: "main" as const, index: 0 }];

  // O webhook vai para o nó que carrega o lead, SEMPRE — é dele que todo bloco
  // tira nome e número. Só depois a corrente começa.
  const inicioDaCorrente = plano.entrada.proximo
    ? (nomePorId.get(plano.entrada.proximo) ?? null)
    : null;
  connections[gatilho.name] = {
    main: [[{ node: NOME_LEAD, type: "main", index: 0 }]],
  };
  connections[NOME_LEAD] = {
    main: [
      inicioDaCorrente
        ? [{ node: inicioDaCorrente, type: "main", index: 0 }]
        : paraFim,
    ],
  };

  for (const p of plano.passos) {
    const saidas = Object.entries(p.destinos);
    // Saída sem destino é o FIM de um caminho — e todo caminho tem que passar
    // pelo nó de fim, senão a execução só é encerrada nos ramos que por acaso
    // terminam no último bloco desenhado.
    const main = saidas.map(([, destinoId]) => {
      if (!destinoId) return paraFim;
      const nome = nomePorId.get(destinoId);
      return nome ? [{ node: nome, type: "main" as const, index: 0 }] : paraFim;
    });

    // A corrente sai pelo ÚLTIMO nó do bloco. Para quase todos é o próprio;
    // para o WhatsApp é o "Registrar", e é isso que garante que a mensagem
    // seguinte só comece depois de a atual estar gravada.
    const entrada = nomePorId.get(p.id)!;
    const saida = saidaDoBloco.get(p.id) ?? entrada;
    if (saida !== entrada) {
      connections[entrada] = {
        main: [[{ node: saida, type: "main", index: 0 }]],
      };
    }

    // Bloco sem saída nenhuma no catálogo (hoje só "Mudar fluxo"): liga direto.
    connections[saida] = { main: main.length > 0 ? main : [paraFim] };
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
