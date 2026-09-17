// Leitura do módulo Webhooks. Só é importado por page.tsx.
//
// O `segredo` SAI daqui inteiro, ao contrário do token da uazapi — e é uma
// diferença deliberada, não um descuido: o segredo da webhook precisa ser
// copiado para dentro do sistema do outro lado, então a tela tem que conseguir
// mostrá-lo. É o mesmo raciocínio de uma chave de API em painel de provedor.
import { sql } from "@/lib/db";
import type {
  CampoDoCrm,
  Recebimento,
  Webhook,
  WebhookAcao,
  WebhookCampo,
} from "@/lib/webhooks";

/** Um dia da série do gráfico. `falha` junta recusado e erro — ver abaixo. */
export type RecebimentoNoDia = { dia: string; ok: number; falha: number };

/**
 * Os números da aba Métricas.
 *
 * Os totais são do HISTÓRICO INTEIRO e a série é de 14 dias, de propósito: o
 * total responde "quanto essa captação já trouxe" e a série responde "está
 * viva?". Uma janela só serviria mal às duas.
 *
 * `contatos` são contatos DISTINTOS: dez recebimentos do mesmo lead viram um
 * contato só (a recepção reaproveita — ver migration-webhooks.sql §2), e a
 * distância entre os dois números é o que denuncia formulário sendo reenviado.
 */
export type MetricasWebhook = {
  porDia: RecebimentoNoDia[];
  total: number;
  ok: number;
  recusado: number;
  erro: number;
  contatos: number;
  primeiro: string | null;
  ultimo: string | null;
};

export type DetalheWebhook = {
  campos: WebhookCampo[];
  acoes: WebhookAcao[];
  recebimentos: Recebimento[];
  metricas: MetricasWebhook;
};

/**
 * O que a configuração de uma webhook precisa escolher, em consultas paralelas:
 * os alvos das AÇÕES (tag, segmento, fluxo, funil, etapa) e os campos
 * personalizados do CRM, que são o destino possível de um CAMPO.
 *
 * Os dois vêm juntos porque são carregados no mesmo momento — quando a pessoa
 * abre uma webhook — e uma segunda ida ao banco para três colunas não se paga.
 */
export type Alvos = {
  tags: { id: string; nome: string }[];
  segmentos: { id: string; nome: string }[];
  fluxos: { id: string; nome: string; entidade_alvo: string }[];
  funis: { id: string; nome: string }[];
  etapas: { id: string; nome: string; funil_id: string }[];
  camposCrm: CampoDoCrm[];
};

export async function listarWebhooks(): Promise<Webhook[]> {
  return (await sql`
    SELECT w.id, w.nome, w.descricao, w.slug, w.segredo, w.ativo,
           to_char(w.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
           (SELECT count(*)::int FROM webhook_campos c WHERE c.webhook_id = w.id) AS total_campos,
           (SELECT count(*)::int FROM webhook_acoes a WHERE a.webhook_id = w.id) AS total_acoes,
           -- 7 dias é a janela que responde "está funcionando?". Mais que isso
           -- vira estatística, e para isso existe a lista de recebimentos.
           (SELECT count(*)::int FROM webhook_recebimentos r
             WHERE r.webhook_id = w.id
               AND r.data_criacao > now() - interval '7 days') AS recebidos_7d,
           (SELECT count(*)::int FROM webhook_recebimentos r
             WHERE r.webhook_id = w.id AND r.estado <> 'ok'
               AND r.data_criacao > now() - interval '7 days') AS erros_7d
    FROM webhooks w
    ORDER BY w.data_criacao DESC`) as unknown as Webhook[];
}

export async function buscarWebhook(id: string): Promise<Webhook | null> {
  const [w] = await sql`
    SELECT w.id, w.nome, w.descricao, w.slug, w.segredo, w.ativo,
           to_char(w.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
           0 AS total_campos, 0 AS total_acoes, 0 AS recebidos_7d, 0 AS erros_7d
    FROM webhooks w WHERE w.id = ${id}`;
  return (w ?? null) as Webhook | null;
}

export async function detalheDoWebhook(id: string): Promise<DetalheWebhook> {
  const [campos, acoes, recebimentos, porDia, totais] = await Promise.all([
    sql`
      SELECT id, chave, rotulo, tipo, obrigatorio, destino, destino_chave, ordem
      FROM webhook_campos WHERE webhook_id = ${id} ORDER BY ordem, chave`,
    // O nome do alvo vem no JOIN: a tela lista "tag Site", não um uuid. Qual
    // das três colunas está preenchida é o que o CHECK da tabela garante.
    sql`
      SELECT a.id, a.tipo, a.ordem, a.fluxo_id, a.segmento_id, a.tag_id,
             a.criar_oportunidade, a.funil_id, a.etapa_id,
             COALESCE(f.nome, s.nome, t.nome) AS alvo_nome,
             fu.nome AS funil_nome, et.nome AS etapa_nome
      FROM webhook_acoes a
      LEFT JOIN fluxos    f  ON f.id  = a.fluxo_id
      LEFT JOIN segmentos s  ON s.id  = a.segmento_id
      LEFT JOIN tags      t  ON t.id  = a.tag_id
      LEFT JOIN funis     fu ON fu.id = a.funil_id
      LEFT JOIN etapas    et ON et.id = a.etapa_id
      WHERE a.webhook_id = ${id}
      ORDER BY a.ordem, a.data_criacao`,
    // 30 últimos: é log de depuração ("mandei e não chegou"), não relatório.
    // Estes mesmos 30 payloads são o que a aba Métricas cruza com os campos
    // declarados para achar chave que chega e é descartada — o diagnóstico sai
    // de graça, sem uma segunda consulta.
    sql`
      SELECT r.id, r.estado, r.erro, r.resumo, r.payload, r.contato_id,
             c.nome AS contato_nome,
             to_char(r.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM webhook_recebimentos r
      LEFT JOIN contatos c ON c.id = r.contato_id
      WHERE r.webhook_id = ${id}
      ORDER BY r.data_criacao DESC LIMIT 30`,
    // Série de 14 dias, com os dias vazios preenchidos pelo generate_series —
    // sem ele o gráfico emendaria terça com sexta e esconderia justamente o
    // buraco que interessa. Mesma forma de execucoesPorDia, em
    // lib/automacoes/repositorio.ts.
    //
    // 'recusado' e 'erro' entram juntos como `falha`: no gráfico a pergunta é
    // "entrou ou não entrou". Qual dos dois foi está no total ao lado e, caso
    // a caso, no log.
    sql`
      SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
             COALESCE(SUM((r.estado = 'ok')::int), 0)::int  AS ok,
             COALESCE(SUM((r.estado <> 'ok')::int), 0)::int AS falha
      FROM generate_series(
             (now() AT TIME ZONE 'UTC')::date - 13,
             (now() AT TIME ZONE 'UTC')::date,
             '1 day') AS d(dia)
      LEFT JOIN webhook_recebimentos r
        ON r.webhook_id = ${id}
       -- Redundante com a igualdade abaixo, e é de propósito: só ESTE
       -- predicado é uma faixa sobre a coluna crua, que é o que deixa o índice
       -- (webhook_id, data_criacao DESC) cortar o histórico antigo. Sem ele, a
       -- comparação por ::date obrigaria a ler todos os recebimentos da
       -- webhook para responder sobre 14 dias — numa tabela que, por decisão
       -- registrada em migration-webhooks.sql, cresce para sempre.
       AND r.data_criacao >= (((now() AT TIME ZONE 'UTC')::date - 13)::timestamp AT TIME ZONE 'UTC')
       AND (r.data_criacao AT TIME ZONE 'UTC')::date = d.dia
      GROUP BY d.dia ORDER BY d.dia`,
    sql`
      SELECT count(*)::int AS total,
             COALESCE(SUM((estado = 'ok')::int), 0)::int       AS ok,
             COALESCE(SUM((estado = 'recusado')::int), 0)::int AS recusado,
             COALESCE(SUM((estado = 'erro')::int), 0)::int     AS erro,
             count(DISTINCT contato_id)::int AS contatos,
             to_char(min(data_criacao) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS primeiro,
             to_char(max(data_criacao) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ultimo
      FROM webhook_recebimentos WHERE webhook_id = ${id}`,
  ]);

  // Agregado sem GROUP BY sempre volta uma linha, inclusive na tabela vazia
  // (total 0, min/max nulos) — não há caso de lista vazia a tratar aqui.
  const t = totais[0] as unknown as Omit<MetricasWebhook, "porDia">;

  return {
    campos: campos as unknown as WebhookCampo[],
    acoes: acoes as unknown as WebhookAcao[],
    recebimentos: recebimentos as unknown as Recebimento[],
    metricas: { ...t, porDia: porDia as unknown as RecebimentoNoDia[] },
  };
}

export async function carregarAlvos(): Promise<Alvos> {
  const [tags, segmentos, fluxos, funis, etapas, camposCrm] = await Promise.all([
    sql`SELECT id, nome FROM tags ORDER BY nome`,
    sql`SELECT id, nome FROM segmentos ORDER BY nome`,
    // Só fluxo PUBLICADO entra na lista: inscrever num rascunho não tem
    // workflow no motor e só renderia erro no primeiro lead. Mesma regra de
    // fluxosParaInscricao, em lib/automacoes/repositorio.ts.
    sql`
      SELECT id, nome, entidade_alvo FROM fluxos
      WHERE estado = 'publicado' AND versao_publicada_id IS NOT NULL
        AND arquivado_em IS NULL AND etapa_id IS NULL
      ORDER BY nome`,
    sql`SELECT id, nome FROM funis ORDER BY data_criacao`,
    sql`SELECT id, nome, funil_id FROM etapas ORDER BY funil_id, ordem`,
    // Sem `opcoes` e sem `tipo`: o seletor de destino só precisa saber que o
    // campo existe, onde ele mora e como chamá-lo na tela. O TIPO do valor que
    // chega é do campo da webhook, e quem o escolhe é a pessoa, ao lado.
    sql`
      SELECT entidade, chave, rotulo FROM campos_personalizados
      ORDER BY entidade, ordem, rotulo`,
  ]);

  return {
    tags: tags as unknown as Alvos["tags"],
    segmentos: segmentos as unknown as Alvos["segmentos"],
    fluxos: fluxos as unknown as Alvos["fluxos"],
    funis: funis as unknown as Alvos["funis"],
    etapas: etapas as unknown as Alvos["etapas"],
    camposCrm: camposCrm as unknown as CampoDoCrm[],
  };
}
