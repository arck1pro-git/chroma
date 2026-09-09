-- ============================================================================
-- Chroma CRM — Automações
-- PostgreSQL 13+ (gen_random_uuid() nativo)
--
-- Revisão do que estava em docs/automacoes-arquitetura.md §4.4. O modelo mudou:
-- o fluxo NÃO reage a evento, ele recebe INSCRIÇÕES — um contato ou uma
-- oportunidade é adicionado ao fluxo e a execução começa no nó de entrada.
--
-- O que isso apaga do desenho anterior:
--   · fluxo_gatilhos   — não existe gatilho para projetar
--   · eventos_dominio  — não há evento para casar com fluxo; o que restou de
--                        "reagir a algo" é só retomar espera (fluxo_esperas)
--
-- O que isso acrescenta:
--   · regra de reentrada (a mesma entidade pode entrar duas vezes?)
--   · origem da inscrição (manual, lista, outro fluxo)
--   · webhook por fluxo, que é como o CRM manda o motor começar
--
-- Relações:
--   fluxo     1 ── N  fluxo_versoes       (versão é imutável)
--   fluxo     1 ── N  fluxo_publicacoes   (tentativa de levar versão ao motor)
--   fluxo     1 ── N  fluxo_execucoes     (uma por inscrição)
--   execucao  1 ── N  fluxo_execucao_passos
--   execucao  1 ── N  fluxo_esperas
-- ============================================================================

CREATE TABLE fluxos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  descricao     text,

  estado        text NOT NULL DEFAULT 'rascunho'
                  CHECK (estado IN ('rascunho','publicado','pausado','arquivado')),

  -- Ponteiros, não cópias: a definição vive só em fluxo_versoes. Ter o JSON
  -- nos dois lugares garante que as duas cópias divergem com o tempo.
  versao_rascunho_id  uuid,
  versao_publicada_id uuid,

  -- Que entidade este fluxo aceita. Um fluxo de oportunidade não sabe o que
  -- fazer se alguém inscrever um contato solto, então isto é validado na
  -- inscrição, não descoberto no meio da execução.
  entidade_alvo text NOT NULL DEFAULT 'oportunidade'
                  CHECK (entidade_alvo IN ('contato','oportunidade')),

  -- A mesma entidade pode entrar de novo enquanto já está dentro? Falso é o
  -- padrão seguro: sem isto, reinscrever em massa duplica disparo de WhatsApp
  -- para quem já está no meio do fluxo. Ver ux_execucao_ativa_por_entidade.
  permite_reentrada boolean NOT NULL DEFAULT false,

  -- Qual motor executa. Existe desde já para a troca futura não virar migração.
  motor              text NOT NULL DEFAULT 'n8n',
  motor_workflow_id  text,

  -- Como o CRM manda o motor começar. O caminho é gerado pelo compilador
  -- (determinístico a partir do id do fluxo); o segredo vai no header e é
  -- conferido pelo Webhook node — sem ele, qualquer um que descubra a URL
  -- dispara o fluxo.
  motor_webhook_caminho text,
  motor_webhook_segredo text,

  data_criacao     timestamptz NOT NULL DEFAULT now(),
  data_atualizacao timestamptz NOT NULL DEFAULT now(),
  arquivado_em     timestamptz
);

-- Barra publicação duplicada por clique repetido. Parcial porque
-- motor_workflow_id é NULL até a primeira publicação dar certo.
CREATE UNIQUE INDEX ux_fluxos_motor_workflow
  ON fluxos (motor, motor_workflow_id)
  WHERE motor_workflow_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Versões: imutáveis. Nunca UPDATE em definicao — restaurar a v2 cria a v5 com
-- o conteúdo da v2, e o histórico não perde um passo.
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_versoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fluxo_id     uuid NOT NULL REFERENCES fluxos (id) ON DELETE CASCADE,
  numero       integer NOT NULL,

  -- Formato "chroma.flow/v1" (lib/automacoes/tipos.ts): { schema, nos,
  -- arestas, layout }. Sem `gatilho` — a raiz é o nó __entrada__.
  definicao    jsonb NOT NULL,

  -- sha256 do definicao canonicalizado. Evita gravar versão nova quando o
  -- autosave reenvia conteúdo idêntico, e serve de chave de comparação.
  hash         text NOT NULL,

  origem_versao_id uuid REFERENCES fluxo_versoes (id),
  notas        text,
  criado_por   uuid,
  data_criacao timestamptz NOT NULL DEFAULT now(),

  UNIQUE (fluxo_id, numero)
);

CREATE INDEX ix_fluxo_versoes_fluxo ON fluxo_versoes (fluxo_id, numero DESC);

ALTER TABLE fluxos
  ADD CONSTRAINT fk_fluxos_versao_rascunho
    FOREIGN KEY (versao_rascunho_id)  REFERENCES fluxo_versoes (id),
  ADD CONSTRAINT fk_fluxos_versao_publicada
    FOREIGN KEY (versao_publicada_id) REFERENCES fluxo_versoes (id);

-- ----------------------------------------------------------------------------
-- Publicações: auditoria de cada tentativa de levar uma versão ao motor.
-- compilado_hash é o que detecta alguém editando o workflow direto no n8n.
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_publicacoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fluxo_id          uuid NOT NULL REFERENCES fluxos (id) ON DELETE CASCADE,
  versao_id         uuid NOT NULL REFERENCES fluxo_versoes (id),
  motor             text NOT NULL,
  motor_workflow_id text,
  compilador_versao text NOT NULL,
  compilado_hash    text NOT NULL,
  estado            text NOT NULL DEFAULT 'pendente'
                      CHECK (estado IN ('pendente','sucesso','erro')),
  erro              text,
  data_criacao      timestamptz NOT NULL DEFAULT now(),
  concluido_em      timestamptz
);

CREATE INDEX ix_fluxo_publicacoes_fluxo
  ON fluxo_publicacoes (fluxo_id, data_criacao DESC);

-- ----------------------------------------------------------------------------
-- Execuções. Uma por inscrição — inscrever É criar a execução, por isso não há
-- tabela separada de inscrições.
--
-- A linha nasce ANTES de chamar o motor: se o motor não responder, sobra uma
-- linha 'perdida' para reconciliar, em vez de silêncio.
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_execucoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fluxo_id      uuid NOT NULL REFERENCES fluxos (id) ON DELETE CASCADE,
  versao_id     uuid NOT NULL REFERENCES fluxo_versoes (id),

  -- Quem foi inscrito. Sem FK porque o tipo é polimórfico — mesmo motivo pelo
  -- qual historico.autor_id vive sem FK no schema.sql.
  entidade_tipo text NOT NULL CHECK (entidade_tipo IN ('contato','oportunidade')),
  entidade_id   uuid NOT NULL,

  -- De onde veio a inscrição. 'fluxo' = bloco "Mudar fluxo" de outro fluxo, e é
  -- o que o guarda de profundidade abaixo vigia.
  origem        text NOT NULL DEFAULT 'manual'
                  CHECK (origem IN ('manual','lista','fluxo','api')),
  inscrito_por  uuid,
  origem_fluxo_id uuid REFERENCES fluxos (id),

  motor              text NOT NULL,
  motor_execucao_id  text,

  estado        text NOT NULL DEFAULT 'pendente'
                  CHECK (estado IN ('pendente','rodando','esperando','sucesso',
                                    'erro','cancelada','perdida')),
  erro_no       text,     -- id do nó no JSON do CRM, não do n8n
  erro_msg      text,

  -- Guarda contra cadeia infinita de "Mudar fluxo": A manda para B, B manda de
  -- volta para A. profundidade cresce a cada salto; a raiz identifica a cadeia.
  profundidade      smallint NOT NULL DEFAULT 0,
  raiz_execucao_id  uuid,

  iniciado_em   timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  duracao_ms    integer
);

-- Regra de reentrada, no banco e não só na aplicação: com permite_reentrada
-- falso, a mesma entidade não pode ter duas execuções vivas no mesmo fluxo.
-- Índice parcial porque só execução VIVA bloqueia — quem já terminou pode
-- entrar de novo.
CREATE UNIQUE INDEX ux_execucao_ativa_por_entidade
  ON fluxo_execucoes (fluxo_id, entidade_tipo, entidade_id)
  WHERE estado IN ('pendente','rodando','esperando');

CREATE INDEX ix_execucoes_fluxo    ON fluxo_execucoes (fluxo_id, iniciado_em DESC);
CREATE INDEX ix_execucoes_entidade ON fluxo_execucoes (entidade_tipo, entidade_id, iniciado_em DESC);
CREATE INDEX ix_execucoes_abertas  ON fluxo_execucoes (estado)
  WHERE estado IN ('pendente','rodando','esperando');

-- ----------------------------------------------------------------------------
-- Passos: um por nó executado. É a tabela que cresce — particionada por mês,
-- com retenção. Os payloads carregam telefone, e-mail e texto de conversa:
-- truncar e redigir PII antes de gravar não é opcional.
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_execucao_passos (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  execucao_id  uuid NOT NULL,
  no_id        text NOT NULL,     -- id do nó no JSON do CRM
  no_tipo      text NOT NULL,
  ordem        smallint NOT NULL,
  estado       text NOT NULL CHECK (estado IN ('sucesso','erro','pulado')),
  entrada      jsonb,
  saida        jsonb,
  erro         text,
  iniciado_em  timestamptz NOT NULL DEFAULT now(),
  duracao_ms   integer,

  PRIMARY KEY (id, iniciado_em)
) PARTITION BY RANGE (iniciado_em);

CREATE INDEX ix_passos_execucao ON fluxo_execucao_passos (execucao_id, ordem);

-- É desta tabela que sai o "quantos passaram por cada bloco" e o "quem passou
-- aqui" da tela de Visão geral:
--   SELECT no_id, count(*) FROM fluxo_execucao_passos
--    WHERE execucao_id IN (SELECT id FROM fluxo_execucoes WHERE fluxo_id = $1)
--    GROUP BY no_id;

-- Primeira partição; criar as seguintes por job mensal.
CREATE TABLE fluxo_execucao_passos_2026_07 PARTITION OF fluxo_execucao_passos
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- ----------------------------------------------------------------------------
-- Esperas ativas: o "Esperar" e o "Verificar resposta".
--
-- Mesmo com o n8n segurando a execução, o CRM precisa da linha: é o que mostra
-- "parado em Esperar 2 dias, retoma dia 26" na tela, e é o que permite retomar
-- sozinho no dia em que o motor mudar.
--
-- Também é o que substituiu o barramento de eventos: nada dispara fluxo, mas
-- mensagem recebida precisa acordar quem está em 'Verificar resposta'. O
-- webhook da uazapi consulta AQUI, direto, em vez de publicar um evento
-- genérico que ninguém mais consome.
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_esperas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id    uuid NOT NULL REFERENCES fluxo_execucoes (id) ON DELETE CASCADE,
  no_id          text NOT NULL,

  tipo           text NOT NULL CHECK (tipo IN ('tempo','resposta')),
  retomar_em     timestamptz,   -- 'tempo': quando; 'resposta': prazo limite

  -- Denormalizado do contato para o webhook de mensagem casar sem JOIN: o
  -- caminho quente é "chegou mensagem deste número, alguém espera por ela?".
  contato_id     uuid,

  estado         text NOT NULL DEFAULT 'ativa'
                   CHECK (estado IN ('ativa','retomada','expirada','cancelada')),
  retomado_em    timestamptz,
  data_criacao   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_esperas_vencendo ON fluxo_esperas (retomar_em)
  WHERE estado = 'ativa';
CREATE INDEX ix_esperas_resposta ON fluxo_esperas (contato_id)
  WHERE estado = 'ativa' AND tipo = 'resposta';

-- ----------------------------------------------------------------------------
-- Credenciais do motor: MAPA, não cofre.
--
-- O segredo NUNCA fica aqui nem viaja no JSON compilado — ele é cadastrado
-- dentro do n8n, e o CRM guarda só o apelido que o compilador usa e o id
-- correspondente no motor. Trocar de motor troca as linhas, não os fluxos.
--
-- Com a decisão de o n8n chamar o CRM de volta em vez de falar direto com a
-- uazapi, isto tende a ter UMA linha: o token de serviço que o n8n usa para
-- voltar aqui.
-- ----------------------------------------------------------------------------
CREATE TABLE motor_credenciais (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave           text NOT NULL,   -- apelido usado no compilador: 'crm_callback'
  motor           text NOT NULL,
  motor_cred_id   text NOT NULL,   -- id da credencial DENTRO do n8n
  motor_cred_tipo text NOT NULL,   -- ex.: 'httpHeaderAuth'
  descricao       text,
  data_criacao    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (motor, chave)
);
