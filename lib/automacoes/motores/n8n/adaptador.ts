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
  /**
   * Falso = nó que não devolveu linha nenhuma NÃO propaga item, e o ramo morre
   * ali. É esse o mecanismo do nó de guarda (ver GUARDA_INSCRITO). É o padrão
   * do n8n, mas vai escrito: a guarda inteira depende dele, e um default que
   * mude numa versão futura viraria mensagem indo para quem saiu da lista.
   */
  alwaysOutputData?: boolean;
};

// Nome do nó no n8n. Usa o id do CRM como sufixo para o callback de erro
// conseguir dizer QUAL bloco falhou no vocabulário do CRM, não no do n8n.
function nomeDoNo(p: { id: string; rotulo: string }) {
  return `${p.rotulo} [${p.id}]`;
}

// O nó de entrada é referenciado por NOME dentro das expressões (é de lá que
// sai o execucao_id de todo bloco), então a string tem que ser uma só.
// Prefixo do nome de todo workflow que o Chroma cria. É a marca que permite
// apagar com segurança numa instância compartilhada — ver apagarWorkflow.
const PREFIXO_NOME = "[Chroma]";

const NOME_ENTRADA = "Entrada do fluxo";
const NOME_FIM = "Fim da execução";
const NOME_MARCAR = "Marcar em execução";

/**
 * O workflow que recebe o erro de TODOS os fluxos do Chroma.
 *
 * Nome fixo porque é assim que ele é encontrado de novo: a API pública do n8n
 * não guarda "qual é o meu workflow de erro", então quem publica procura por
 * este nome antes de criar outro. Carrega o prefixo [Chroma] pela mesma razão
 * dos demais — é a marca que autoriza apagar.
 */
export const NOME_WORKFLOW_ERROS = `${PREFIXO_NOME} Erros`;

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

// ── A guarda de inscrição ───────────────────────────────────────────────────
//
// POR QUE ELA EXISTE: o workflow lia o lead uma vez, na entrada, e só voltava a
// tocar em fluxo_execucoes no nó final. Entre um passo e outro ele não
// perguntava mais nada ao CRM. Numa cadência que espera dias entre mensagens,
// isso significava que tirar alguém da automação NÃO parava o envio: a linha
// ficava 'cancelada' no banco e a mensagem saía do mesmo jeito, na arckwpp, que
// é compartilhada com a produção do SprintHub.
//
// COMO FUNCIONA: antes de cada bloco que manda algo para fora entra este
// SELECT. Achando linha, o ramo segue; não achando, o nó devolve zero itens e o
// n8n não executa o que vem depois — sem IF, sem ramo de erro, sem nó extra.
//
// O que ele barra, de uma vez:
//   · desinscrito       → estado 'cancelada'
//   · pausado           → estado 'pausada' (que também não parava nada)
//   · fluxo despublicado, pausado ou arquivado → o fluxo inteiro para
//
// A QUARTA CONDIÇÃO É A ÚLTIMA MENSAGEM DA CONVERSA. Ela só deixa passar se
// quem falou por último foi a própria cadência. Qualquer outra coisa encerra o
// assunto, e por dois motivos que dão no mesmo:
//
//   · foi o ATENDENTE (digitando no chat, 'crm', ou pelo celular, 'aparelho')
//     → alguém já está falando com essa pessoa;
//   · foi o LEAD ('contato') → ele já respondeu, e a sequência existe para
//     arrancar resposta. Continuar mandando é falar por cima de quem respondeu.
//
// Por isso a comparação é contra 'automacao', e não uma lista do que bloqueia:
// só a própria cadência libera a próxima; todo o resto para.
//
// COALESCE(enviada_por, origem) porque mensagem RECEBIDA tem `enviada_por`
// nulo — sem isso o NULL do lead viraria "ninguém falou" e a cadência
// continuaria por cima da resposta dele, que é o caso que mais importa.
//
// SÓ CONTA O QUE VEIO DEPOIS DA ENTRADA NO FLUXO (`> e.iniciado_em`), e o
// COALESCE de fora é o "não houve nada desde então" → libera. Sem esse recorte
// a PRIMEIRA mensagem nunca sairia para um lead que já tinha conversa: o
// histórico de quem chegou pelo WhatsApp termina numa mensagem dele, e a
// cadência morreria antes de começar.
//
// MENSAGEM ENVIADA SEM `enviada_por` É IGNORADA, e essa foi a decisão mais
// difícil daqui. São as anteriores à migration — e as que saírem de um workflow
// publicado antes dela, que é o caso de TODA cadência rodando hoje. Barrá-las
// (o lado "seguro") trava a cadência para sempre: a próxima mensagem não sai
// porque a anterior não tem etiqueta, e nunca vai ter. Ignorá-las custa o
// oposto e é um custo que acaba: uma mensagem que o atendente mandou pelo
// celular ANTES da migration não interrompe a sequência. Depois dela, tudo
// nasce etiquetado e a regra volta a ser exata.
//
// Recebida não precisa de etiqueta: `origem = 'contato'` já diz que foi o lead,
// inclusive no histórico antigo. Então a resposta dele para a cadência mesmo em
// conversa velha.
//
// O custo é uma consulta por mensagem, no mesmo Postgres em que o motor já
// grava cada mensagem enviada. É barato perto de uma mensagem indevida.
// Exportada para poder ser EXECUTADA num teste contra o banco. Redigitar a
// consulta no teste seria testar a cópia: as duas divergiriam, o teste passaria
// e a mensagem sairia mesmo assim.
export const GUARDA_INSCRITO = `
  SELECT 1
  FROM fluxo_execucoes e
  JOIN fluxos f ON f.id = e.fluxo_id
  LEFT JOIN oportunidades o
    ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
  WHERE e.id = $1::uuid
    AND e.estado IN ('pendente','rodando','esperando')
    AND f.estado = 'publicado'
    AND f.arquivado_em IS NULL
    AND COALESCE(
      (SELECT COALESCE(m.enviada_por, 'contato')
       FROM mensagens m
       JOIN atendimentos a ON a.id = m.atendimento_id
       WHERE a.contato_id = COALESCE(o.contato_id, e.entidade_id)
         AND m.data_criacao > e.iniciado_em
         -- Só o que dá para classificar: recebida é sempre do lead, e enviada
         -- só conta quando alguém marcou de onde saiu.
         AND (m.enviada_por IS NOT NULL OR m.origem = 'contato')
       ORDER BY m.data_criacao DESC, m.id DESC
       LIMIT 1),
      'automacao'
    ) = 'automacao'`;

/**
 * "Este lead está NESTE bloco agora."
 *
 * É a linha que a tela da cadência lê para desenhar o card na coluna certa
 * (posicaoNaCadencia, em lib/automacoes/repositorio.ts). Cada passo do fluxo é
 * um bloco no n8n, e cada bloco em que o lead PARA marca a passagem por aqui.
 *
 * A ordem sai do banco e não de um contador do workflow: com ramos e
 * reinscrições, o motor não tem esse número.
 */
export const MARCAR_PASSO = `
  INSERT INTO fluxo_execucao_passos
    (execucao_id, no_id, no_tipo, ordem, estado)
  SELECT $1::uuid, $2, $3,
         (SELECT count(*) + 1 FROM fluxo_execucao_passos p
           WHERE p.execucao_id = $1::uuid)::smallint,
         'sucesso'`;

// Blocos que mandam algo para FORA e por isso precisam da guarda na frente.
// Hoje só um tem nó de verdade; os outros de `comunicacao` ainda caem no No-Op
// e não enviam nada, então guardá-los seria consulta à toa. Ao implementar o
// próximo (whatsapp oficial, e-mail), acrescente aqui.
const BLOCOS_QUE_ENVIAM = new Set(["enviar_whatsapp_web"]);

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
  /** id da credencial Header Auth da instância PADRÃO da uazapi. */
  uazapi: string;
  /** base_url da instância padrão, ex.: https://arckwpp.uazapi.com */
  uazapiBaseUrl: string;
  /**
   * Uma credencial e uma base_url POR INSTÂNCIA de WhatsApp.
   *
   * É o que faz o número escolhido em cada mensagem valer: o nó de envio do
   * bloco usa a instância DELE, não a do fluxo. Quem monta este mapa (e cria a
   * credencial no cofre do n8n quando falta) é `credenciaisDaUazapi`, em
   * app/automacoes/acoes.ts.
   *
   * Opcional para não quebrar chamada antiga — sem ele tudo cai na padrão, que
   * é como era antes.
   */
  porInstancia?: Map<
    string,
    { credencialId: string; baseUrl: string; numero?: string | null }
  >;
  /**
   * Id do workflow que recolhe os erros (ver NOME_WORKFLOW_ERROS). Vai em
   * `settings.errorWorkflow`: sem ele, uma falha no motor morre no histórico do
   * n8n e a execução fica `pendente` no CRM para sempre.
   */
  erroWorkflowId?: string;
  /**
   * Endereço PÚBLICO do CRM, do ponto de vista do motor. Presente = o nó de
   * envio chama /api/automacoes/enviar em vez de falar com a uazapi.
   *
   * Vazio (localhost, sem túnel) = caminho antigo, direto na uazapi. Não é
   * preferência: é que o motor não alcança a sua máquina, e publicar um nó que
   * chama um endereço inalcançável seria publicar uma cadência quebrada.
   */
  crmBaseUrl?: string;
  /** Credencial Header Auth do n8n com o `Authorization: Bearer <token>`. */
  crmCredencialId?: string;
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
  // Os nós de cada bloco, EM ORDEM, para os blocos que viram mais de um: o
  // WhatsApp vira guarda → envio → registro. Quem chega no bloco entra pelo
  // primeiro; quem sai do bloco sai do último. É esta lista que mantém as
  // ligações corretas sem cada ponto do código recalcular a cadeia.
  const cadeiaDoBloco = new Map<string, string[]>();
  // Blocos que efetivamente ganharam a guarda. Existe para a conferência no fim
  // desta função, não para montar ligação.
  const comGuarda = new Set<string>();

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

  // PRIMEIRA COISA DEPOIS DO GATILHO: dizer que esta execução começou, e gravar
  // o id que o motor deu a ela.
  //
  // O id é o que costura os dois lados. Quando um nó falha lá na frente, quem
  // avisa é o workflow de erros (NOME_WORKFLOW_ERROS), e tudo que ele recebe do
  // n8n é o id DA EXECUÇÃO DO MOTOR — nada do nosso vocabulário. Sem esta
  // gravação no começo, não há como voltar dele até a linha em
  // `fluxo_execucoes`, e o erro fica sem dono.
  //
  // `estado = 'pendente'` no WHERE, e não uma lista: só a primeira passagem
  // marca. Reentrada e retomada não podem reescrever o id de outra execução.
  const marcar: NoN8n = {
    id: "__marcar__",
    name: NOME_MARCAR,
    type: "n8n-nodes-base.postgres",
    typeVersion: 2.4,
    position: [plano.entrada.posicao.x, plano.entrada.posicao.y + 65],
    parameters: {
      operation: "executeQuery",
      query: `
        UPDATE fluxo_execucoes
           SET estado = 'rodando', motor_execucao_id = $2
         WHERE id = $1::uuid AND estado = 'pendente'`,
      options: {
        queryReplacement: expr([EXECUCAO_ID, "{{ $execution.id }}"].join(",")),
      },
    },
    credentials: credPostgres(cred),
  };
  nodes.push(marcar);

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
      // DOIS nós: marca e espera.
      //
      // A espera é um passo da cadência como qualquer outro, e é o único em que
      // o lead FICA — os demais ele atravessa. Sem a marca, a tela não teria
      // como saber que ele está parado ali: o último passo registrado seria a
      // mensagem anterior, e o card apareceria nela por dias.
      //
      // A marca vem ANTES da espera, e é isso que a torna verdadeira: ela grava
      // "entrou no esperar" no instante em que entra, não quando sai.
      const espera = nomeDoNo(passo);
      const marca = `Marcar [${passo.id}]`;

      nodes.push({
        id: `${passo.id}__marca`,
        name: marca,
        type: "n8n-nodes-base.postgres",
        typeVersion: 2.4,
        // Uma coluna à esquerda: posição é cosmética no n8n, e à esquerda lê
        // como "antes" no desenho.
        position: [passo.posicao.x - 190, passo.posicao.y],
        parameters: {
          operation: "executeQuery",
          query: MARCAR_PASSO,
          options: {
            queryReplacement: expr(
              [EXECUCAO_ID, passo.id, passo.tipo].join(","),
            ),
          },
        },
        credentials: credPostgres(cred),
      });

      nodes.push({
        id: passo.id,
        name: espera,
        type: "n8n-nodes-base.wait",
        typeVersion: 1.1,
        position: [passo.posicao.x, passo.posicao.y],
        parameters: {
          resume: passo.tipo === "esperar" ? "timeInterval" : "webhook",
          amount: passo.config.minutos ?? 5,
          unit: "minutes",
        },
      });

      cadeiaDoBloco.set(passo.id, [marca, espera]);
      continue;
    }

    if (passo.tipo === "enviar_whatsapp_web") {
      // TRÊS nós: confere, manda e registra.
      //
      // A guarda vem primeiro e é o que faz "desinscrever" significar alguma
      // coisa — ver GUARDA_INSCRITO no topo do arquivo.
      //
      // Envio e registro são separados porque o registro precisa do RETORNO da
      // uazapi (o messageid, que é como o webhook de entrega casa a mensagem
      // depois) — num nó só, ou se grava antes sem o id, ou se manda sem deixar
      // rastro.
      const envio = nomeDoNo(passo);
      const guarda = `Ainda inscrito? [${passo.id}]`;
      const registro = `Registrar [${passo.id}]`;

      nodes.push({
        id: `${passo.id}__guarda`,
        name: guarda,
        type: "n8n-nodes-base.postgres",
        typeVersion: 2.4,
        // Uma coluna à esquerda do bloco: posição é cosmética no n8n, e à
        // esquerda lê como "antes" no desenho.
        position: [passo.posicao.x - 190, passo.posicao.y],
        parameters: {
          operation: "executeQuery",
          query: GUARDA_INSCRITO,
          options: { queryReplacement: expr(EXECUCAO_ID) },
        },
        // O ponto inteiro da guarda: sem linha, sem item, e o ramo morre aqui.
        alwaysOutputData: false,
        credentials: credPostgres(cred),
      });

      // DE QUAL NÚMERO ESTA mensagem sai. O bloco carrega `instancia_id`; sem
      // ele, a instância padrão. Antes esta linha não existia: toda mensagem
      // saía pela padrão e o seletor da tela era decorativo.
      const instanciaId =
        typeof passo.config.instancia_id === "string"
          ? passo.config.instancia_id
          : "";
      const daInstancia = instanciaId
        ? cred.porInstancia?.get(instanciaId)
        : undefined;

      // TODA MENSAGEM TEM QUE DIZER POR QUAL NÚMERO SAI. Não há "a padrão".
      //
      // Antes, bloco sem número caía na instância padrão e bloco apontando para
      // instância removida caía nela também — os dois em silêncio. O lead
      // recebia a mensagem de um remetente que ele não conhece, e não havia
      // como descobrir isso pelo CRM: só do outro lado, pelo cliente.
      //
      // Estourar aqui custa uma escolha na tela e uma republicação. É a troca
      // certa: a compilação é o último lugar onde isso ainda é barato.
      if (!instanciaId) {
        throw new Error(
          `A mensagem "${passo.rotulo}" está sem número de WhatsApp. Escolha por qual número ela sai.`,
        );
      }
      if (!daInstancia) {
        throw new Error(
          `A mensagem "${passo.rotulo}" está presa a um número de WhatsApp que não existe mais em Configurações. Escolha o número de novo nesta mensagem.`,
        );
      }
      if (!daInstancia.numero) {
        throw new Error(
          `O número escolhido na mensagem "${passo.rotulo}" ainda não foi pareado. Conecte o WhatsApp dele em Configurações antes de publicar.`,
        );
      }
      const baseUrl = daInstancia.baseUrl;
      const credencialUazapi = daInstancia.credencialId;
      // O que viaja no workflow publicado. Token muda, id de linha some — o
      // número, não: é ele que o CRM usa para achar a credencial na hora do
      // envio.
      const numeroDeOrigem = daInstancia.numero;

      // DUAS FORMAS DO MESMO NÓ. A primeira é a que vale:
      //
      // · PELO CRM (quando há endereço público): o motor manda texto e NÚMERO
      //   DE ORIGEM, e quem resolve a credencial da instância é o CRM, no
      //   instante do envio. Instância recriada, token trocado, sessão que caiu
      //   e voltou — nada disso exige republicar, porque o que viaja no
      //   workflow é o número, que não muda.
      //
      // · DIRETO NA UAZAPI (fallback de desenvolvimento): o token vai no cofre
      //   do n8n, copiado. É o caminho que produziu o "401 Invalid token"
      //   depois de a instância ser recriada — fica só porque em localhost o
      //   motor não alcança o CRM.
      const pelosCrm = Boolean(cred.crmBaseUrl && cred.crmCredencialId);

      nodes.push({
        id: passo.id,
        name: envio,
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [passo.posicao.x, passo.posicao.y],
        parameters: pelosCrm
          ? {
              method: "POST",
              url: `${cred.crmBaseUrl}/api/automacoes/enviar`,
              authentication: "genericCredentialType",
              genericAuthType: "httpHeaderAuth",
              sendBody: true,
              specifyBody: "json",
              jsonBody: expr(
                JSON.stringify({
                  execucao_id: EXECUCAO_ID,
                  no_id: passo.id,
                  // O número de origem, e não o id da instância: o id é da
                  // LINHA do CRM e morre quando alguém apaga e recadastra o
                  // número. O número sobrevive a isso.
                  numero_origem: numeroDeOrigem,
                  para: `{{ $('${NOME_LEAD}').first().json.numero }}`,
                  texto: textoParaExpressao(String(passo.config.texto ?? "")),
                }),
              ),
            }
          : {
              method: "POST",
              url: `${baseUrl}/send/text`,
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
        credentials: {
          httpHeaderAuth: pelosCrm
            ? { id: cred.crmCredencialId!, name: "Chroma · CRM" }
            : { id: credencialUazapi, name: "Chroma · uazapi" },
        },
      });

      // O atendimento é resolvido no próprio INSERT: ON CONFLICT não serve
      // aqui (não há chave única de "conversa aberta"), então a subconsulta
      // pega a mais recente não encerrada. Sem ela, uma cadência de 18
      // mensagens criaria 18 conversas na tela do chat.
      //
      // ESTE NÓ TAMBÉM MARCA O PASSO, e é o que conserta o card parado na
      // última coluna. A tela pergunta "qual foi o último bloco executado para
      // esta oportunidade?" a fluxo_execucao_passos; quem alimentava essa
      // tabela era o executor do CRM, que deixou de existir quando o n8n passou
      // a falar direto com a uazapi (ver lib/automacoes/servico.ts). Desde
      // então ninguém escrevia ali, a posição vinha vazia, e TODO card caía na
      // régua de dias — que, para uma oportunidade antiga, aponta sempre a
      // última mensagem. Daí "todo mundo na mensagem 5".
      //
      // Vai DEPOIS do envio, na mesma instrução, porque é o envio que faz o
      // passo existir: falhou o envio, o ramo morre aqui e nada é marcado.
      // `enviada_por` nasce 'automacao' — é o que distingue esta mensagem da
      // que o atendente manda pelo celular, e é o que a guarda lê.
      nodes.push({
        id: `${passo.id}__reg`,
        name: registro,
        type: "n8n-nodes-base.postgres",
        typeVersion: 2.4,
        position: [passo.posicao.x + 190, passo.posicao.y],
        parameters: {
          operation: "executeQuery",
          query: `
            WITH msg AS (
              INSERT INTO mensagens
                (atendimento_id, origem, autor_id, texto, status, id_externo,
                 enviada_por)
              SELECT a.id, 'agente', NULL, $2, 'enviado', $3, 'automacao'
              FROM atendimentos a
              WHERE a.contato_id = $1::uuid AND a.status <> 'encerrado'
              ORDER BY a.data_criacao DESC
              LIMIT 1
              RETURNING id
            )
            INSERT INTO fluxo_execucao_passos
              (execucao_id, no_id, no_tipo, ordem, estado)
            SELECT $4::uuid, $5, $6,
                   -- Ordem = quantos passos esta execução já tem + 1. Sai do
                   -- banco e não de um contador do workflow: com ramos e
                   -- reentradas, o motor não tem esse número.
                   (SELECT count(*) + 1 FROM fluxo_execucao_passos p
                     WHERE p.execucao_id = $4::uuid)::smallint,
                   'sucesso'`,
          options: {
            queryReplacement: expr(
              [
                `{{ $('${NOME_LEAD}').first().json.contato_id }}`,
                `{{ $('${envio}').first().json.text ?? '' }}`,
                `{{ $('${envio}').first().json.messageid ?? '' }}`,
                EXECUCAO_ID,
                passo.id,
                passo.tipo,
              ].join(","),
            ),
          },
        },
        credentials: credPostgres(cred),
      });

      cadeiaDoBloco.set(passo.id, [guarda, envio, registro]);
      comGuarda.add(passo.id);
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
  //
  // ELE TAMBÉM ESCREVE O HISTÓRICO DO LEAD, e é o único jeito: chegar ao fim do
  // fluxo é uma saída como qualquer outra, mas acontece DENTRO do motor — o CRM
  // não é avisado. Sem esta linha, a ficha mostraria "entrou na automação" e
  // nunca o "saiu", e quem lê a trilha concluiria que o lead está lá até hoje.
  //
  // A forma é um CTE: o UPDATE devolve o que precisa e o INSERT lê daí, numa
  // instrução só. Nada aqui pode derrubar o nó — se a entidade sumiu, o SELECT
  // não acha linha e o INSERT grava zero, sem erro. E o `fim` só produz linha
  // quando o UPDATE mexeu em alguma: execução já cancelada não vira "saiu" duas
  // vezes.
  //
  // ⚠ Vale para fluxo PUBLICADO DAQUI PARA A FRENTE. O workflow que está no n8n
  // é o que foi compilado na publicação — os antigos continuam fechando a
  // execução sem escrever histórico, e republicar é o que corrige. Mesma
  // ressalva da guarda de inscrito.
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
        WITH fim AS (
          UPDATE fluxo_execucoes SET
            estado = 'sucesso',
            finalizado_em = now(),
            duracao_ms = EXTRACT(EPOCH FROM (now() - iniciado_em))::int * 1000,
            motor_execucao_id = $2
          WHERE id = $1::uuid
            AND estado IN ('pendente','rodando','esperando')
          RETURNING fluxo_id, entidade_tipo, entidade_id
        )
        INSERT INTO historico (contato_id, oportunidade_id, descricao)
        SELECT coalesce(o.contato_id, c.id), o.id,
               'Saiu da automação "' || f.nome || '" — chegou ao fim'
        FROM fim
        JOIN fluxos f ON f.id = fim.fluxo_id
        LEFT JOIN oportunidades o
          ON fim.entidade_tipo = 'oportunidade' AND o.id = fim.entidade_id
        LEFT JOIN contatos c
          ON fim.entidade_tipo = 'contato' AND c.id = fim.entidade_id
        WHERE o.id IS NOT NULL OR c.id IS NOT NULL`,
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
  // Quem aponta para um bloco aponta para o PRIMEIRO nó dele — que no WhatsApp
  // é a guarda, não o envio. Apontar para o envio pularia a guarda e era
  // exatamente o furo que ela fecha.
  for (const p of plano.passos) {
    nomePorId.set(p.id, cadeiaDoBloco.get(p.id)?.[0] ?? nomeDoNo(p));
  }

  const paraFim = [{ node: NOME_FIM, type: "main" as const, index: 0 }];

  // O webhook vai para o nó que carrega o lead, SEMPRE — é dele que todo bloco
  // tira nome e número. Só depois a corrente começa.
  const inicioDaCorrente = plano.entrada.proximo
    ? (nomePorId.get(plano.entrada.proximo) ?? null)
    : null;
  connections[gatilho.name] = {
    main: [[{ node: NOME_MARCAR, type: "main", index: 0 }]],
  };
  connections[NOME_MARCAR] = {
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

    // Os nós internos do bloco em fila, cada um alimentando o próximo. Para
    // quase todos a cadeia tem um nó só e este laço não faz nada; para o
    // WhatsApp é guarda → envio → registro, e é o que garante que a mensagem
    // seguinte só comece depois de a atual estar gravada.
    const cadeia = cadeiaDoBloco.get(p.id) ?? [nomeDoNo(p)];
    for (let i = 0; i < cadeia.length - 1; i++) {
      connections[cadeia[i]] = {
        main: [[{ node: cadeia[i + 1], type: "main", index: 0 }]],
      };
    }

    // A corrente sai pelo ÚLTIMO nó do bloco. Bloco sem saída nenhuma no
    // catálogo (hoje só "Mudar fluxo"): liga direto no fim.
    const saida = cadeia[cadeia.length - 1];
    connections[saida] = { main: main.length > 0 ? main : [paraFim] };
  }

  void porId;

  // Rede de segurança para o próximo que mexer aqui: todo bloco que manda algo
  // para fora tem que entrar por uma guarda. Implementar o nó do e-mail e
  // esquecer a guarda não apareceria em teste nenhum — apareceria como mensagem
  // no WhatsApp de quem pediu para sair. Estourar na compilação é barato;
  // descobrir depois, não.
  for (const p of plano.passos) {
    if (BLOCOS_QUE_ENVIAM.has(p.tipo) && !comGuarda.has(p.id)) {
      throw new Error(
        `o bloco "${p.tipo}" envia mensagem e ficou sem guarda de inscrição`,
      );
    }
  }

  return {
    name: `${PREFIXO_NOME} ${plano.nome}`,
    nodes,
    connections,
    settings: {
      executionOrder: "v1",
      // Falhou qualquer nó, o n8n chama este workflow. É o que transforma "a
      // execução ficou pendente e ninguém soube" em um card vermelho com o
      // motivo escrito.
      ...(cred.erroWorkflowId ? { errorWorkflow: cred.erroWorkflowId } : {}),
    },
  };
}

/**
 * O workflow de erros: Error Trigger → um UPDATE.
 *
 * É um só para todos os fluxos, e por isso não conhece nenhum deles: ele acha a
 * execução pelo `motor_execucao_id` que o nó "Marcar em execução" gravou no
 * começo.
 *
 * O NOME DO NÓ CARREGA O ID DO BLOCO no vocabulário do CRM ("Enviar WhatsApp
 * (web) [msg1]"), e é daí que sai `erro_no` — o `substring` extrai o que está
 * entre colchetes. É o que deixa a tela dizer QUAL mensagem quebrou em vez de
 * mostrar o nome de um nó de n8n.
 *
 * VÍRGULA VIRA PONTO E VÍRGULA na mensagem de erro, e não é preciosismo: o nó
 * Postgres separa os parâmetros da consulta por vírgula, então uma mensagem com
 * vírgula desalinharia $2 e $3 e gravaria lixo na linha errada.
 *
 * NÃO É ATIVADO: workflow de Error Trigger não tem gatilho ativável no n8n —
 * quem o chama é o motor, por causa de `settings.errorWorkflow`.
 */
export function workflowDeErros(cred: CredenciaisMotor): WorkflowMotor {
  return {
    name: NOME_WORKFLOW_ERROS,
    nodes: [
      {
        id: "__erro_trigger__",
        name: "Erro no motor",
        type: "n8n-nodes-base.errorTrigger",
        typeVersion: 1,
        position: [0, 0],
        parameters: {},
      },
      {
        id: "__erro_update__",
        name: "Marcar execução com erro",
        type: "n8n-nodes-base.postgres",
        typeVersion: 2.4,
        position: [220, 0],
        parameters: {
          operation: "executeQuery",
          query: `
            UPDATE fluxo_execucoes SET
              estado        = 'erro',
              erro_msg      = left($2, 500),
              erro_no       = substring($3 from '\\[([^\\]]+)\\]$'),
              finalizado_em = now(),
              duracao_ms    = EXTRACT(EPOCH FROM (now() - iniciado_em))::int * 1000
            WHERE motor_execucao_id = $1
              AND estado IN ('pendente','rodando','esperando')`,
          options: {
            queryReplacement: expr(
              [
                "{{ $json.execution.id }}",
                "{{ String($json.execution.error?.message ?? 'falha no motor').replaceAll(',', ';').slice(0, 500) }}",
                "{{ String($json.execution.lastNodeExecuted ?? '').replaceAll(',', ';') }}",
              ].join(","),
            ),
          },
        },
        credentials: credPostgres(cred),
      },
    ],
    connections: {
      "Erro no motor": {
        main: [[{ node: "Marcar execução com erro", type: "main", index: 0 }]],
      },
    },
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

/**
 * Acha um workflow do Chroma pelo nome exato.
 *
 * Existe para não criar duplicata: a automação do RSS é ÚNICA (uma só cobre
 * todos os blogs), e clicar duas vezes em "criar" não pode deixar dois
 * agendamentos iguais rodando na segunda de manhã. A API pública não filtra por
 * nome, então a filtragem é aqui.
 */
export async function acharWorkflowPorNome(
  nome: string,
): Promise<{ id: string; active: boolean } | null> {
  const r = (await chamar("/workflows?limit=250")) as {
    data?: { id: string; name: string; active?: boolean }[];
  } | null;

  const achado = (r?.data ?? []).find((w) => w.name === nome);
  return achado ? { id: achado.id, active: achado.active === true } : null;
}

/**
 * Cria uma credencial DENTRO do n8n e devolve o id.
 *
 * O segredo vai para o cofre do n8n, não para o JSON do workflow. A diferença
 * importa: workflow é legível por qualquer um com acesso à instância — que aqui
 * é COMPARTILHADA com a produção do SprintHub —, credencial não é.
 *
 * A API pública não lista credenciais, então quem chama precisa guardar o id
 * (é o que `motor_credenciais` faz) para não criar uma nova a cada chamada.
 */
export async function criarCredencial(
  nome: string,
  tipo: string,
  dados: Record<string, unknown>,
): Promise<string> {
  const criada = await chamar("/credentials", {
    method: "POST",
    body: JSON.stringify({ name: nome, type: tipo, data: dados }),
  });
  return criada.id as string;
}

/**
 * Apaga o workflow no motor. É a única operação destrutiva deste arquivo, e ela
 * existe porque a alternativa é pior: excluir a automação no CRM sem apagar lá
 * deixa um workflow ATIVO, com webhook vivo, que o CRM não gerencia mais.
 *
 * Isso não é hipótese. Em 2026-09-09 encontramos um workflow "[Chroma] Novo
 * fluxo" ativo desde julho, órfão, apontando para uma URL relativa — publicado
 * por uma versão com bug e nunca mais alcançado por ninguém.
 *
 * A TRAVA: o nome é conferido ANTES. A instância é compartilhada com a produção
 * da empresa (§5.1), e um id errado — de um bug, de um copiar e colar — apagaria
 * automação da qual outra gente depende. Só apaga o que se chama "[Chroma] …",
 * que é o prefixo que só este adaptador escreve.
 */
export async function apagarWorkflow(id: string): Promise<void> {
  const atual = (await lerWorkflow(id)) as { name?: string } | null;
  const nome = String(atual?.name ?? "");

  if (!nome.startsWith(PREFIXO_NOME)) {
    throw new Error(
      `Recusado: o workflow ${id} chama-se "${nome}" e não foi criado pelo Chroma. Nada foi apagado.`,
    );
  }

  await chamar(`/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
}
