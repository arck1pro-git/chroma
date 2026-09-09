// Leitura/escrita das Automações. Só SQL — nada de regra de negócio, que vive
// nas server actions. Timestamps em ISO "…Z" como o resto do projeto.

import { createHash } from "node:crypto";
import { listaUuid, sql } from "@/lib/db";
import { NO_ENTRADA, type DefinicaoFluxo } from "./tipos";

export type EstadoFluxo = "rascunho" | "publicado" | "pausado" | "arquivado";

export type Fluxo = {
  id: string;
  nome: string;
  descricao: string | null;
  estado: EstadoFluxo;
  entidade_alvo: "contato" | "oportunidade";
  permite_reentrada: boolean;
  motor_workflow_id: string | null;
  versao_rascunho_id: string | null;
  versao_publicada_id: string | null;
  numero_versao: number | null;
  data_atualizacao: string;
  // Agregados da lista. Subquery e nao JOIN: com JOIN o GROUP BY teria que
  // repetir todas as colunas do fluxo.
  execucoes_14d: number;
  erros_14d: number;
  no_fluxo: number;
};

const CAMPOS = `
  f.id, f.nome, f.descricao, f.estado, f.entidade_alvo, f.permite_reentrada,
  f.motor_workflow_id, f.versao_rascunho_id, f.versao_publicada_id,
  v.numero AS numero_versao,
  to_char(f.data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_atualizacao,
  (SELECT count(*)::int FROM fluxo_execucoes e
    WHERE e.fluxo_id = f.id AND e.iniciado_em > now() - interval '14 days') AS execucoes_14d,
  (SELECT count(*)::int FROM fluxo_execucoes e
    WHERE e.fluxo_id = f.id AND e.estado = 'erro'
      AND e.iniciado_em > now() - interval '14 days') AS erros_14d,
  (SELECT count(*)::int FROM fluxo_execucoes e
    -- 'pausada' conta como "no fluxo": o lead continua inscrito, só parado.
    -- Fora daqui, pausar faria a contagem cair e pareceria que ele saiu.
    WHERE e.fluxo_id = f.id
      AND e.estado IN ('pendente','rodando','esperando','pausada')) AS no_fluxo`;

export async function listarFluxos(): Promise<Fluxo[]> {
  const linhas = await sql`
    SELECT ${sql.unsafe(CAMPOS)}
    FROM fluxos f
    LEFT JOIN fluxo_versoes v ON v.id = COALESCE(f.versao_publicada_id, f.versao_rascunho_id)
    WHERE f.arquivado_em IS NULL
    ORDER BY f.data_atualizacao DESC`;
  return linhas as Fluxo[];
}

export async function buscarFluxo(id: string): Promise<Fluxo | null> {
  const [linha] = await sql`
    SELECT ${sql.unsafe(CAMPOS)}
    FROM fluxos f
    LEFT JOIN fluxo_versoes v ON v.id = COALESCE(f.versao_rascunho_id, f.versao_publicada_id)
    WHERE f.id = ${id}`;
  return (linha as Fluxo) ?? null;
}

// Definição que o builder abre: rascunho se existir, senão a publicada, senão
// um fluxo vazio só com a entrada.
export async function definicaoDoFluxo(id: string): Promise<DefinicaoFluxo> {
  const [linha] = await sql`
    SELECT v.definicao
    FROM fluxos f
    JOIN fluxo_versoes v ON v.id = COALESCE(f.versao_rascunho_id, f.versao_publicada_id)
    WHERE f.id = ${id}`;

  return (
    (linha?.definicao as DefinicaoFluxo) ?? {
      schema: "chroma.flow/v1",
      nos: {},
      arestas: [],
      layout: { [NO_ENTRADA]: { x: 0, y: 0 } },
    }
  );
}

// Hash canônico: chaves ordenadas, para que reordenar propriedades no JSON não
// produza versão nova. É o que evita o autosave gravar uma versão por tecla.
/**
 * Hash do conteúdo da definição. É ele que responde "mudou alguma coisa?" —
 * `salvarRascunho` não grava versão nova quando o hash bate.
 *
 * A versão anterior era `JSON.stringify(d, Object.keys(d).sort())`, escrita
 * para ordenar as chaves. Não é isso que o segundo argumento faz: array ali é
 * uma LISTA DE PERMISSÃO de nomes de propriedade, aplicada em TODOS os níveis.
 * Como a lista era ["arestas","layout","nos","schema"], tudo que estava dentro
 * de `nos` (as chaves são ids de bloco: "msg1"…) e dentro de cada aresta
 * ("de", "para") era descartado antes do hash. Na prática o hash enxergava só
 * a QUANTIDADE de arestas.
 *
 * O estrago: mudar o texto de uma mensagem, o canal ou a instância não mudava
 * o hash, então `salvarRascunho` achava que nada tinha mudado e voltava sem
 * gravar. A edição sumia em silêncio — a tela dizia "salvo (v2)" e o banco
 * continuava com a v2 antiga. Só acrescentar ou remover bloco (que mexe no
 * número de arestas) escapava.
 *
 * Agora a canonização é de verdade: chaves ordenadas em profundidade, arrays
 * na ordem em que estão. `layout` entra no hash de propósito — deixá-lo de
 * fora repetiria o mesmo defeito em menor escala, com posição de bloco sumindo
 * sem aviso ao salvar.
 */
function canonizar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonizar);
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, canonizar(obj[k])]),
    );
  }
  return v;
}

export function hashDefinicao(d: DefinicaoFluxo): string {
  return createHash("sha256").update(JSON.stringify(canonizar(d))).digest("hex");
}

export async function criarFluxo(nome: string, entidade: "contato" | "oportunidade") {
  const [novo] = await sql`
    INSERT INTO fluxos (nome, entidade_alvo)
    VALUES (${nome}, ${entidade})
    RETURNING id`;
  return novo.id as string;
}

// ── Cadências de etapa ──────────────────────────────────────────────────────
//
// Um fluxo com etapa_id é a cadência daquela etapa: é o que o painel de
// subetapas da raiz abre. Sem etapa_id é fluxo comum, o de /automacoes.
// Ver migration-cadencia-etapa.sql.

export type FluxoDeEtapa = {
  id: string;
  etapa_id: string;
  nome: string;
  estado: EstadoFluxo;
  numero_versao: number | null;
  definicao: DefinicaoFluxo | null;
  // Há rascunho ainda não levado ao motor? É o que acende o "publicar".
  rascunho_pendente: boolean;
  publicado_alguma_vez: boolean;
  no_fluxo: number;
  erros_14d: number;
};

export async function fluxosDeEtapas(): Promise<FluxoDeEtapa[]> {
  const linhas = await sql`
    SELECT f.id, f.etapa_id, f.nome, f.estado,
           v.numero AS numero_versao, v.definicao,
           (f.versao_rascunho_id IS NOT NULL
             AND f.versao_rascunho_id IS DISTINCT FROM f.versao_publicada_id) AS rascunho_pendente,
           (f.versao_publicada_id IS NOT NULL) AS publicado_alguma_vez,
           (SELECT count(*)::int FROM fluxo_execucoes e
             WHERE e.fluxo_id = f.id
               AND e.estado IN ('pendente','rodando','esperando','pausada')) AS no_fluxo,
           (SELECT count(*)::int FROM fluxo_execucoes e
             WHERE e.fluxo_id = f.id AND e.estado = 'erro'
               AND e.iniciado_em > now() - interval '14 days') AS erros_14d
    FROM fluxos f
    LEFT JOIN fluxo_versoes v ON v.id = COALESCE(f.versao_rascunho_id, f.versao_publicada_id)
    WHERE f.etapa_id IS NOT NULL AND f.arquivado_em IS NULL`;
  return linhas as FluxoDeEtapa[];
}

export async function criarFluxoDaEtapa(nome: string, etapaId: string) {
  // entidade_alvo fixo em 'oportunidade': a cadência de uma etapa corre sobre
  // os negócios que estão nela, não sobre contatos soltos.
  const [novo] = await sql`
    INSERT INTO fluxos (nome, entidade_alvo, etapa_id)
    VALUES (${nome}, 'oportunidade', ${etapaId})
    RETURNING id`;
  return novo.id as string;
}

/**
 * ONDE cada oportunidade está na cadência: o último bloco que o motor de fato
 * executou para ela. É o que a coluna do painel passa a mostrar.
 *
 * Antes a coluna saía só da idade da oportunidade contra os dias da cadência —
 * previsão, e boa enquanto ninguém podia mover ninguém. Com o arraste movendo
 * a inscrição de verdade, a régua de dias mentiria no instante seguinte ao
 * arraste: a oportunidade de 40 dias que foi levada para a 2ª mensagem
 * continuaria desenhada na última. Fato na frente, previsão só onde não há
 * fato (ver `distribuir` em app/inicio/subetapas.ts).
 *
 * Execução cancelada CONTA: a mensagem saiu antes de alguém tirar aquela
 * oportunidade da cadência, e o card continuar onde parou diz a verdade — some
 * o botão de sair, não o histórico. Se ela for reinscrita depois, os passos da
 * execução nova são mais recentes e ganham do mesmo jeito.
 */
export async function posicaoNaCadencia() {
  return (await sql`
    SELECT DISTINCT ON (e.fluxo_id, e.entidade_id)
           e.fluxo_id, e.entidade_id, p.no_id
    FROM fluxo_execucao_passos p
    JOIN fluxo_execucoes e ON e.id = p.execucao_id
    JOIN fluxos f ON f.id = e.fluxo_id
    WHERE f.etapa_id IS NOT NULL
      AND e.entidade_tipo = 'oportunidade'
      AND p.estado IN ('sucesso', 'pulado')
    ORDER BY e.fluxo_id, e.entidade_id, p.iniciado_em DESC, p.ordem DESC`) as unknown as {
    fluxo_id: string;
    entidade_id: string;
    no_id: string;
  }[];
}

// Quem está dentro de alguma cadência agora. Marca o cartão no quadro.
export async function oportunidadesEmCadencia() {
  return (await sql`
    SELECT e.fluxo_id, e.entidade_id
    FROM fluxo_execucoes e
    JOIN fluxos f ON f.id = e.fluxo_id
    WHERE f.etapa_id IS NOT NULL
      AND e.entidade_tipo = 'oportunidade'
      -- 'pausada' inclusa: ela ocupa a vaga no índice de reentrada, então se
      -- não aparecesse aqui a tela ofereceria "Disparar" para quem o banco vai
      -- recusar, e o resultado seria "ninguém novo" sem explicação.
      AND e.estado IN ('pendente','rodando','esperando','pausada')`) as unknown as {
    fluxo_id: string;
    entidade_id: string;
  }[];
}

/**
 * Inscreve as oportunidades ABERTAS de uma etapa no fluxo. Uma linha por
 * inscrição — é a inscrição, não há tabela separada (schema-automacoes.sql).
 *
 * O ON CONFLICT repete o predicado do índice parcial
 * ux_execucao_ativa_por_entidade: sem o WHERE, o Postgres não infere qual
 * índice usar e a query estoura. Quem já está dentro do fluxo não entra de
 * novo — é a regra de reentrada, e é ela que impede o segundo clique em
 * "Disparar" de mandar a boas-vindas duas vezes.
 */
export async function inscreverEtapa(
  fluxoId: string,
  versaoId: string,
  etapaId: string,
) {
  // `motor` vem da linha do fluxo, e não de um literal aqui: fluxos.motor tem
  // DEFAULT, fluxo_execucoes.motor é NOT NULL SEM default (schema-automacoes.sql)
  // — omitir a coluna estoura. Copiar do fluxo também mantém este arquivo sem
  // saber o nome de motor nenhum.
  return (await sql`
    INSERT INTO fluxo_execucoes (
      fluxo_id, versao_id, entidade_tipo, entidade_id,
      origem, origem_etapa_id, motor)
    -- origem 'etapa' + origem_etapa_id desde migration-revisao-modulos.sql §3.
    -- Antes gravava 'lista', que não dizia QUAL — e "por que este contato
    -- recebeu esta mensagem?" ficava sem resposta.
    SELECT f.id, ${versaoId}, 'oportunidade', o.id,
           'etapa', ${etapaId}, f.motor
    FROM oportunidades o
    CROSS JOIN fluxos f
    WHERE f.id = ${fluxoId}
      AND o.etapa_id = ${etapaId}
      AND o.status = 'aberta'
    -- O predicado tem que ser IGUAL ao do índice parcial
    -- (ux_execucao_ativa_por_entidade), senão o Postgres não infere qual índice
    -- usar. 'pausada' entrou nele: lead pausado continua ocupando a vaga, e é o
    -- que impede o próximo Disparar de reinscrevê-lo e duplicar o WhatsApp.
    ON CONFLICT (fluxo_id, entidade_tipo, entidade_id)
      WHERE estado IN ('pendente','rodando','esperando','pausada')
      DO NOTHING
    RETURNING id, entidade_id`) as unknown as {
    id: string;
    entidade_id: string;
  }[];
}

/**
 * Tira a oportunidade da cadência: a inscrição viva é CANCELADA e a espera
 * pendurada nela também.
 *
 * Do lado do motor, a execução continua parada num Wait e um dia acorda — quem
 * barra o efeito dela é o executor, que recusa bloco de execução que não está
 * mais viva (lib/automacoes/executor.ts). Sem as duas pontas, "removi da
 * cadência" duraria até o próximo despertar do motor.
 *
 * Devolve quantas foram canceladas: zero é o caso normal de quem ainda não
 * tinha entrado no fluxo, e não é erro.
 */
export async function cancelarNaCadencia(
  fluxoId: string,
  oportunidadeId: string,
  motivo: string,
) {
  // As esperas primeiro, com a execução ainda viva: é o predicado dela que
  // seleciona quais cancelar. Depois do UPDATE de baixo, "viva" já não existe.
  await sql`
    UPDATE fluxo_esperas es SET estado = 'cancelada'
    FROM fluxo_execucoes e
    WHERE es.execucao_id = e.id
      AND es.estado IN ('ativa','pausada')
      AND e.fluxo_id = ${fluxoId}
      AND e.entidade_tipo = 'oportunidade'
      AND e.entidade_id = ${oportunidadeId}
      -- inclui 'pausada': sem isto, "remover da cadência" depois de pausar não
      -- faria nada, em silêncio, e a oportunidade seguiria segurando a vaga.
      AND e.estado IN ('pendente','rodando','esperando','pausada')`;

  const linhas = await sql`
    UPDATE fluxo_execucoes SET
      estado = 'cancelada',
      erro_msg = ${motivo.slice(0, 500)},
      finalizado_em = now(),
      duracao_ms = EXTRACT(EPOCH FROM (now() - iniciado_em))::int * 1000
    WHERE fluxo_id = ${fluxoId}
      AND entidade_tipo = 'oportunidade'
      AND entidade_id = ${oportunidadeId}
      AND estado IN ('pendente','rodando','esperando','pausada')
    RETURNING id`;

  return linhas.length;
}

// ── Automações vivas de UMA entidade ────────────────────────────────────────
//
// É o que a ficha da oportunidade mostra: "em quais automações este lead está".
// Usa ix_execucoes_vivas_da_entidade (migration-revisao-modulos.sql §2), que
// existe justamente porque o índice antigo não filtrava por estado e a pergunta
// varria também tudo que já terminou.

export type AutomacaoDaEntidade = {
  execucao_id: string;
  fluxo_id: string;
  fluxo_nome: string;
  // Cadência de etapa ou fluxo comum — a ficha rotula diferente.
  etapa_id: string | null;
  estado: string;
  // Onde parou, quando está esperando ou pausada.
  no_id: string | null;
  retomar_em: string | null;
  iniciado_em: string;
  pausa_motivo: string | null;
};

export async function automacoesDaEntidade(
  tipo: "contato" | "oportunidade",
  entidadeId: string,
): Promise<AutomacaoDaEntidade[]> {
  return (await sql`
    SELECT e.id AS execucao_id, e.fluxo_id, f.nome AS fluxo_nome, f.etapa_id,
           e.estado, e.pausa_motivo,
           es.no_id,
           to_char(es.retomar_em  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS retomar_em,
           to_char(e.iniciado_em  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS iniciado_em
    FROM fluxo_execucoes e
    JOIN fluxos f ON f.id = e.fluxo_id
    -- LEFT: execução 'rodando' não tem espera pendurada, e some com JOIN comum.
    LEFT JOIN fluxo_esperas es
      ON es.execucao_id = e.id AND es.estado IN ('ativa','pausada')
    WHERE e.entidade_tipo = ${tipo}
      AND e.entidade_id = ${entidadeId}
      AND e.estado IN ('pendente','rodando','esperando','pausada')
    ORDER BY e.iniciado_em DESC`) as unknown as AutomacaoDaEntidade[];
}

/**
 * Pausa ESTA inscrição — não o fluxo, não as outras oportunidades.
 *
 * Quem faz a mensagem não sair é o executor: ele recusa bloco cuja execução não
 * esteja em ('pendente','rodando','esperando'), e 'pausada' está fora dessa
 * lista (lib/automacoes/executor.ts). Do lado do motor a execução continua
 * parada num Wait e um dia acorda; ao acordar, o executor recusa.
 *
 * A espera também congela: sem isso o motor acorda no dia marcado, o bloco é
 * recusado e a linha fica 'ativa' para sempre, mostrando na tela "retoma dia X"
 * de algo que não retoma.
 *
 * Devolve quantas foram pausadas — zero quando alguém clica duas vezes, e isso
 * não é erro.
 */
export async function pausarExecucao(
  execucaoId: string,
  motivo: string,
): Promise<number> {
  // A espera primeiro, com a execução ainda viva: é o predicado dela que
  // seleciona qual congelar. Mesma ordem de cancelarNaCadencia, pelo mesmo
  // motivo.
  await sql`
    UPDATE fluxo_esperas es SET estado = 'pausada'
    FROM fluxo_execucoes e
    WHERE es.execucao_id = e.id
      AND es.estado = 'ativa'
      AND e.id = ${execucaoId}
      AND e.estado IN ('pendente','rodando','esperando')`;

  const linhas = await sql`
    UPDATE fluxo_execucoes SET
      estado        = 'pausada',
      pausada_em    = now(),
      pausa_motivo  = ${motivo.slice(0, 500)},
      -- De onde retomar. Sem isto, retomar recomeçaria do início e reenviaria
      -- mensagem que o lead já leu.
      pausada_no_no = (
        SELECT es.no_id FROM fluxo_esperas es
        WHERE es.execucao_id = ${execucaoId} AND es.estado = 'pausada'
        ORDER BY es.data_criacao DESC LIMIT 1)
    WHERE id = ${execucaoId}
      AND estado IN ('pendente','rodando','esperando')
    RETURNING id`;

  return linhas.length;
}

/**
 * O contrário. A execução volta para 'esperando' quando havia espera congelada,
 * e para 'pendente' quando não havia — que é o estado de quem ainda não deu o
 * primeiro passo.
 *
 * NÃO reagenda nada no motor: a execução lá continua onde estava. Retomar aqui
 * é remover a recusa, não empurrar o fluxo para a frente.
 */
export async function retomarExecucao(execucaoId: string): Promise<number> {
  const congeladas = await sql`
    UPDATE fluxo_esperas es SET estado = 'ativa'
    FROM fluxo_execucoes e
    WHERE es.execucao_id = e.id
      AND es.estado = 'pausada'
      AND e.id = ${execucaoId}
      AND e.estado = 'pausada'
    RETURNING es.id`;

  const linhas = await sql`
    UPDATE fluxo_execucoes SET
      estado       = ${congeladas.length > 0 ? "esperando" : "pendente"},
      pausada_em   = NULL,
      pausa_motivo = NULL
    WHERE id = ${execucaoId} AND estado = 'pausada'
    RETURNING id`;

  return linhas.length;
}

// ── Inscrever um SEGMENTO inteiro ───────────────────────────────────────────

/**
 * Inscreve uma LISTA explícita de oportunidades — o "adicionar em um fluxo de
 * automação" da seleção do kanban.
 *
 * origem 'manual' e não 'lista': quem escolheu foi uma pessoa, cartão a cartão.
 * A diferença importa na hora de explicar por que alguém recebeu a mensagem.
 */
export async function inscreverOportunidades(
  fluxoId: string,
  versaoId: string,
  oportunidadeIds: string[],
) {
  if (oportunidadeIds.length === 0) return [];
  return (await sql`
    INSERT INTO fluxo_execucoes (
      fluxo_id, versao_id, entidade_tipo, entidade_id, origem, motor)
    SELECT f.id, ${versaoId}, 'oportunidade', o.id, 'manual', f.motor
    FROM oportunidades o
    CROSS JOIN fluxos f
    WHERE f.id = ${fluxoId}
      AND o.id = ANY(string_to_array(${listaUuid(oportunidadeIds)}, ',')::uuid[])
    ON CONFLICT (fluxo_id, entidade_tipo, entidade_id)
      WHERE estado IN ('pendente','rodando','esperando','pausada')
      DO NOTHING
    RETURNING id, entidade_id`) as unknown as {
    id: string;
    entidade_id: string;
  }[];
}

/**
 * Fluxos que a seleção do kanban pode usar: de oportunidade, publicados e não
 * pausados. Fluxo sem versão publicada não tem workflow no motor, e oferecê-lo
 * na lista só renderia um erro depois do clique.
 */
export async function fluxosParaInscricao(): Promise<
  { id: string; nome: string }[]
> {
  return (await sql`
    SELECT id, nome FROM fluxos
    WHERE entidade_alvo = 'oportunidade'
      AND estado = 'publicado'
      AND versao_publicada_id IS NOT NULL
      AND arquivado_em IS NULL
      -- Cadência de etapa fica de fora: ela pertence à etapa e é disparada
      -- pelo painel dela, não escolhida a dedo numa seleção de cartões.
      AND etapa_id IS NULL
    ORDER BY nome`) as unknown as { id: string; nome: string }[];
}

export type SegmentoParaDisparo = {
  id: string;
  nome: string;
  contatos: number;
};

/**
 * Os segmentos com quantos contatos cada um tem — é o que o seletor de disparo
 * mostra. A contagem vem junto de propósito: "disparar para 12 mil pessoas"
 * precisa dizer 12 mil ANTES do clique, não depois.
 */
export async function segmentosParaDisparo(): Promise<SegmentoParaDisparo[]> {
  return (await sql`
    SELECT s.id, s.nome,
           (SELECT count(*)::int FROM contato_segmentos cs
             WHERE cs.segmento_id = s.id) AS contatos
    FROM segmentos s
    ORDER BY s.nome`) as unknown as SegmentoParaDisparo[];
}


/**
 * Irmã de `inscreverEtapa`, para o "disparar para um determinado segmento".
 *
 * Inscreve os CONTATOS do segmento; fluxo de oportunidade não cabe aqui, porque
 * segmento é do contato e um contato pode ter zero ou várias oportunidades —
 * escolher uma por ele seria inventar. Quem valida isso é quem chama.
 *
 * origem_segmento_id é gravado junto: sem ele, 'segmento' não diz QUAL, e a
 * primeira pergunta depois de um disparo errado é exatamente essa.
 */
export async function inscreverSegmento(
  fluxoId: string,
  versaoId: string,
  segmentoId: string,
) {
  return (await sql`
    INSERT INTO fluxo_execucoes (
      fluxo_id, versao_id, entidade_tipo, entidade_id,
      origem, origem_segmento_id, motor)
    SELECT f.id, ${versaoId}, 'contato', cs.contato_id,
           'segmento', ${segmentoId}, f.motor
    FROM contato_segmentos cs
    CROSS JOIN fluxos f
    WHERE f.id = ${fluxoId}
      AND cs.segmento_id = ${segmentoId}
    ON CONFLICT (fluxo_id, entidade_tipo, entidade_id)
      WHERE estado IN ('pendente','rodando','esperando','pausada')
      DO NOTHING
    RETURNING id, entidade_id`) as unknown as {
    id: string;
    entidade_id: string;
  }[];
}

/**
 * Execuções que entraram no motor e nunca deram sinal: 'pendente', sem UM passo
 * sequer. Quase sempre significa que o motor não conseguiu voltar ao CRM.
 *
 * Elas seguram a oportunidade pelo índice de reentrada, então o próximo
 * "Disparar" diz "ninguém novo" sem explicar por quê. É só CONTAGEM — nada é
 * mexido aqui: uma cadência que começa com espera também fica sem passo por
 * dias, e marcá-la como perdida automaticamente reinscreveria a oportunidade e
 * duplicaria mensagem lá na frente.
 */
export async function execucoesPresas(fluxoId: string) {
  const [linha] = await sql`
    SELECT count(*)::int AS n,
           to_char(min(e.iniciado_em) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS mais_antiga
    FROM fluxo_execucoes e
    WHERE e.fluxo_id = ${fluxoId}
      AND e.estado = 'pendente'
      AND NOT EXISTS (
        SELECT 1 FROM fluxo_execucao_passos p WHERE p.execucao_id = e.id)`;
  return {
    n: (linha?.n as number) ?? 0,
    maisAntiga: (linha?.mais_antiga as string | null) ?? null,
  };
}

// A execução não chegou ao motor. 'perdida' é o estado que o schema reserva
// para isso — some da contagem de "no fluxo" e sobra para reconciliar, em vez
// de ficar 'pendente' bloqueando a reentrada da oportunidade para sempre.
export async function marcarPerdida(execucaoId: string, erro: string) {
  await sql`
    UPDATE fluxo_execucoes
    SET estado = 'perdida', erro_msg = ${erro.slice(0, 500)}, finalizado_em = now()
    WHERE id = ${execucaoId}`;
}

export async function dadosDeDisparo(fluxoId: string) {
  const [f] = await sql`
    SELECT id, nome, estado, etapa_id, entidade_alvo,
           motor_webhook_caminho, motor_webhook_segredo,
           versao_publicada_id
    FROM fluxos WHERE id = ${fluxoId}`;
  return (f ?? null) as {
    id: string;
    nome: string;
    estado: EstadoFluxo;
    etapa_id: string | null;
    // Que entidade o fluxo aceita. O disparo por segmento inscreve CONTATOS,
    // então precisa conferir isto antes — inscrever contato num fluxo de
    // oportunidade só falharia lá dentro, no primeiro bloco que pede o negócio.
    entidade_alvo: "contato" | "oportunidade";
    motor_webhook_caminho: string | null;
    motor_webhook_segredo: string | null;
    versao_publicada_id: string | null;
  } | null;
}

/**
 * Grava uma versão nova SE o conteúdo mudou, e aponta o rascunho para ela.
 * Devolve o número da versão vigente.
 *
 * Versão é imutável: editar nunca faz UPDATE em `definicao` — cria a próxima.
 */
export async function salvarRascunho(
  fluxoId: string,
  definicao: DefinicaoFluxo,
  autorId: string | null,
): Promise<number> {
  const hash = hashDefinicao(definicao);

  const [atual] = await sql`
    SELECT v.id, v.numero, v.hash
    FROM fluxos f
    LEFT JOIN fluxo_versoes v ON v.id = f.versao_rascunho_id
    WHERE f.id = ${fluxoId}`;

  if (atual?.hash === hash) return atual.numero as number;

  const [{ proximo }] = await sql`
    SELECT COALESCE(MAX(numero), 0) + 1 AS proximo
    FROM fluxo_versoes WHERE fluxo_id = ${fluxoId}`;

  const [versao] = await sql`
    INSERT INTO fluxo_versoes (fluxo_id, numero, definicao, hash, origem_versao_id, criado_por)
    VALUES (${fluxoId}, ${proximo}, ${sql.json(definicao as never)}, ${hash},
            ${atual?.id ?? null}, ${autorId})
    RETURNING id, numero`;

  await sql`
    UPDATE fluxos
    SET versao_rascunho_id = ${versao.id}, data_atualizacao = now()
    WHERE id = ${fluxoId}`;

  return versao.numero as number;
}

export async function registrarPublicacao(dados: {
  fluxoId: string;
  versaoId: string;
  motor: string;
  compiladorVersao: string;
  compiladoHash: string;
}) {
  const [p] = await sql`
    INSERT INTO fluxo_publicacoes
      (fluxo_id, versao_id, motor, compilador_versao, compilado_hash)
    VALUES (${dados.fluxoId}, ${dados.versaoId}, ${dados.motor},
            ${dados.compiladorVersao}, ${dados.compiladoHash})
    RETURNING id`;
  return p.id as string;
}

export async function concluirPublicacao(
  publicacaoId: string,
  resultado: { ok: true; workflowId: string } | { ok: false; erro: string },
) {
  if (resultado.ok) {
    await sql`
      UPDATE fluxo_publicacoes
      SET estado = 'sucesso', motor_workflow_id = ${resultado.workflowId},
          concluido_em = now()
      WHERE id = ${publicacaoId}`;
  } else {
    await sql`
      UPDATE fluxo_publicacoes
      SET estado = 'erro', erro = ${resultado.erro}, concluido_em = now()
      WHERE id = ${publicacaoId}`;
  }
}

/**
 * `ativo` é o que separa "publicado" de "pausado", e os dois são publicação: o
 * workflow existe no motor nos dois casos. A cadência nasce pausada — o
 * interruptor da tela é que a põe para rodar —, e salvar de novo não pode
 * ligar sozinha uma cadência que estava parada.
 */
export async function marcarPublicado(
  fluxoId: string,
  versaoId: string,
  workflowId: string,
  webhookCaminho: string,
  webhookSegredo: string,
  ativo = true,
) {
  await sql`
    UPDATE fluxos SET
      estado = ${ativo ? "publicado" : "pausado"},
      versao_publicada_id = ${versaoId},
      motor_workflow_id = ${workflowId},
      motor_webhook_caminho = ${webhookCaminho},
      motor_webhook_segredo = ${webhookSegredo},
      data_atualizacao = now()
    WHERE id = ${fluxoId}`;
}

export async function credencialDoMotor(motor: string, chave: string) {
  const [c] = await sql`
    SELECT motor_cred_id, motor_cred_tipo
    FROM motor_credenciais
    WHERE motor = ${motor} AND chave = ${chave}`;
  return c ? { id: c.motor_cred_id as string, nome: chave } : null;
}

// ── Métricas das telas ──────────────────────────────────────────────────────

export async function execucoesPorDia(fluxoId: string, dias = 14) {
  return (await sql`
    SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
           COALESCE(SUM((e.estado = 'sucesso')::int), 0)::int AS sucesso,
           COALESCE(SUM((e.estado = 'erro')::int), 0)::int    AS erro
    FROM generate_series(
           (now() AT TIME ZONE 'UTC')::date - (${dias - 1}::int),
           (now() AT TIME ZONE 'UTC')::date,
           '1 day') AS d(dia)
    LEFT JOIN fluxo_execucoes e
      ON e.fluxo_id = ${fluxoId}
     AND (e.iniciado_em AT TIME ZONE 'UTC')::date = d.dia
    GROUP BY d.dia ORDER BY d.dia`) as unknown as {
    dia: string;
    sucesso: number;
    erro: number;
  }[];
}

export async function passosPorBloco(fluxoId: string) {
  return (await sql`
    SELECT p.no_id, p.no_tipo,
           count(*)::int AS passaram,
           COALESCE(SUM((p.estado = 'erro')::int), 0)::int AS erros
    FROM fluxo_execucao_passos p
    JOIN fluxo_execucoes e ON e.id = p.execucao_id
    WHERE e.fluxo_id = ${fluxoId}
    GROUP BY p.no_id, p.no_tipo`) as unknown as {
    no_id: string;
    no_tipo: string;
    passaram: number;
    erros: number;
  }[];
}

export async function execucoesRecentes(fluxoId: string, limite = 50) {
  return (await sql`
    SELECT e.id, e.estado, e.erro_no, e.erro_msg, e.duracao_ms,
           to_char(e.iniciado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS iniciado_em,
           COALESCE(c.nome, o.nome, '—') AS entidade_nome
    FROM fluxo_execucoes e
    LEFT JOIN contatos c       ON e.entidade_tipo = 'contato'      AND c.id = e.entidade_id
    LEFT JOIN oportunidades o  ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
    WHERE e.fluxo_id = ${fluxoId}
    ORDER BY e.iniciado_em DESC
    LIMIT ${limite}`) as unknown as {
    id: string;
    estado: string;
    erro_no: string | null;
    erro_msg: string | null;
    duracao_ms: number | null;
    iniciado_em: string;
    entidade_nome: string;
  }[];
}

export async function leadsNoFluxo(fluxoId: string) {
  return (await sql`
    SELECT e.id AS execucao_id, es.no_id,
           COALESCE(c.nome, o.nome, '—') AS entidade_nome,
           to_char(es.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS parado_desde,
           to_char(es.retomar_em  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS retomar_em
    FROM fluxo_esperas es
    JOIN fluxo_execucoes e ON e.id = es.execucao_id
    LEFT JOIN contatos c       ON e.entidade_tipo = 'contato'      AND c.id = e.entidade_id
    LEFT JOIN oportunidades o  ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
    WHERE e.fluxo_id = ${fluxoId} AND es.estado = 'ativa'
    ORDER BY es.retomar_em NULLS LAST`) as unknown as {
    execucao_id: string;
    no_id: string;
    entidade_nome: string;
    parado_desde: string;
    retomar_em: string | null;
  }[];
}
