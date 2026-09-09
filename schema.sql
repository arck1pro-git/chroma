-- ============================================================================
-- Chroma CRM — schema
-- PostgreSQL 13+ (gen_random_uuid() é nativo, não precisa de extensão)
--
-- Relações:
--   contato  1 ── N  oportunidades   (uma oportunidade tem um contato só)
--   funil    1 ── N  etapas          (uma etapa pertence a um funil só)
--   contato  N ── N  segmentos
--   contato  N ── N  tags
--   contato  1 ── N  anotacoes
--   contato  1 ── N  historico       (oportunidade também escreve aqui)
-- ============================================================================

CREATE TABLE contatos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  whatsapp     text,
  email        text,
  cidade       text,
  estado       text,
  pais         text,
  data_criacao timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE funis (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  data_criacao timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE etapas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  funil_id     uuid NOT NULL REFERENCES funis (id) ON DELETE CASCADE,
  data_criacao timestamptz NOT NULL DEFAULT now(),

  -- existe só para permitir a FK composta lá embaixo, em oportunidades
  UNIQUE (id, funil_id)
);

CREATE INDEX ix_etapas_funil ON etapas (funil_id);

CREATE TABLE oportunidades (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           text NOT NULL,
  contato_id     uuid NOT NULL REFERENCES contatos (id),
  valor          numeric(14,2) NOT NULL DEFAULT 0,
  responsavel_id uuid,
  status         text NOT NULL DEFAULT 'aberta',
  funil_id       uuid NOT NULL,
  etapa_id       uuid NOT NULL,
  data_criacao   timestamptz NOT NULL DEFAULT now(),

  -- garante que a etapa é do mesmo funil da oportunidade: sem isto, um bug no
  -- drag-and-drop consegue colar um card do funil A numa etapa do funil B
  FOREIGN KEY (etapa_id, funil_id) REFERENCES etapas (id, funil_id)
);

CREATE INDEX ix_oportunidades_contato ON oportunidades (contato_id);
CREATE INDEX ix_oportunidades_etapa   ON oportunidades (etapa_id);
CREATE INDEX ix_oportunidades_funil   ON oportunidades (funil_id);

CREATE TABLE segmentos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL UNIQUE,
  data_criacao timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL UNIQUE,
  data_criacao timestamptz NOT NULL DEFAULT now()
);

-- N:N. CASCADE dos dois lados: apagar a tag tira ela de todos os contatos,
-- apagar o contato limpa os vínculos dele. Nada além do vínculo se perde.
CREATE TABLE contato_segmentos (
  contato_id   uuid NOT NULL REFERENCES contatos (id)  ON DELETE CASCADE,
  segmento_id  uuid NOT NULL REFERENCES segmentos (id) ON DELETE CASCADE,
  data_criacao timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contato_id, segmento_id)
);

-- a PK já indexa (contato_id, segmento_id); este cobre o caminho inverso,
-- "quais contatos tem este segmento?"
CREATE INDEX ix_contato_segmentos_segmento ON contato_segmentos (segmento_id);

CREATE TABLE contato_tags (
  contato_id   uuid NOT NULL REFERENCES contatos (id) ON DELETE CASCADE,
  tag_id       uuid NOT NULL REFERENCES tags (id)     ON DELETE CASCADE,
  data_criacao timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contato_id, tag_id)
);

CREATE INDEX ix_contato_tags_tag ON contato_tags (tag_id);

-- ============================================================================
-- Histórico: uma linha por mudança, em texto pronto pra exibir.
--
-- A mudança pode ser no contato ("WhatsApp alterado") ou na oportunidade
-- ("Movida de Proposta para Negociação"), por isso os dois vínculos. Mudança de
-- oportunidade preenche os DOIS: assim a ficha do contato mostra tudo que
-- aconteceu com ele, inclusive nos negócios dele, sem precisar de UNION.
--
-- Linha de histórico não se edita nem se apaga: é o que aconteceu.
-- ============================================================================

CREATE TABLE historico (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id      uuid REFERENCES contatos (id)      ON DELETE CASCADE,
  oportunidade_id uuid REFERENCES oportunidades (id) ON DELETE CASCADE,
  descricao       text NOT NULL,
  autor_id        uuid,
  data_criacao    timestamptz NOT NULL DEFAULT now(),

  -- histórico solto, sem dono, não serve pra nada
  CHECK (contato_id IS NOT NULL OR oportunidade_id IS NOT NULL)
);

CREATE INDEX ix_historico_contato ON historico (contato_id, data_criacao DESC);
CREATE INDEX ix_historico_op      ON historico (oportunidade_id, data_criacao DESC);

-- ============================================================================
-- Anotações: texto escrito por gente, preso ao lead.
-- Diferente do histórico — anotação é opinião ("cliente pediu pra ligar depois
-- das 18h"), histórico é fato. Por isso esta se edita e apaga, aquela não.
-- ============================================================================

CREATE TABLE anotacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id      uuid NOT NULL REFERENCES contatos (id) ON DELETE CASCADE,
  texto           text NOT NULL,
  autor_id        uuid,
  data_criacao    timestamptz NOT NULL DEFAULT now(),
  data_atualizacao timestamptz
);

CREATE INDEX ix_anotacoes_contato ON anotacoes (contato_id, data_criacao DESC);

-- ============================================================================
-- Atendimentos + mensagens (chat).
--
-- Modelo pedido:
--   contato  1 ── N  atendimentos   (o atendimento é de um contato só)
--   atendimento 1 ── N  mensagens
--   atendimento.responsavel_id = agente dono; NULL = na fila, sem dono.
--   mensagem.atendimento_id     = a qual conversa a mensagem pertence.
--
-- responsavel_id e autor_id ficam sem FK de propósito: usuarios ainda não é
-- tabela (mesmo caso de oportunidades.responsavel_id). Vira FK quando existir.
-- ============================================================================

CREATE TABLE atendimentos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id       uuid NOT NULL REFERENCES contatos (id) ON DELETE CASCADE,
  responsavel_id   uuid,                       -- agente dono; NULL = na fila
  status           text NOT NULL DEFAULT 'na_fila'
                     CHECK (status IN ('na_fila', 'aberto', 'encerrado')),
  canal            text NOT NULL DEFAULT 'whatsapp'
                     CHECK (canal IN ('whatsapp', 'instagram', 'email')),

  -- Até quando o responsável leu. "Não lidas" = mensagens do contato mais novas
  -- que isto. É o jeito honesto de contar não lidas (um timestamp, não um número
  -- solto que qualquer clique reescreve).
  lido_em          timestamptz,

  data_criacao     timestamptz NOT NULL DEFAULT now(),
  -- Toca a cada mensagem nova; é por ela que a lista ordena (atividade recente
  -- no topo). Opcional — dá pra derivar de max(mensagens.data_criacao) —, mas
  -- barata de manter e evita o subselect na listagem.
  data_atualizacao timestamptz
);

CREATE INDEX ix_atendimentos_contato     ON atendimentos (contato_id);
CREATE INDEX ix_atendimentos_responsavel ON atendimentos (responsavel_id);
CREATE INDEX ix_atendimentos_status      ON atendimentos (status);

-- OPCIONAL: no máximo UM atendimento não-encerrado por contato (é o que a tela
-- de "novo atendimento" já assume ao abrir o existente em vez de duplicar).
-- Descomente se quiser o banco garantindo isso:
-- CREATE UNIQUE INDEX ux_atendimento_ativo_por_contato
--   ON atendimentos (contato_id) WHERE status <> 'encerrado';

-- ============================================================================
-- Mensagens do atendimento. origem 'contato' = recebida; 'agente' = enviada.
--
-- Envio: grava aqui primeiro com status 'pendente', dispara pela uazapi, e
-- então atualiza id_externo + status com o retorno. Se a uazapi falhar, a linha
-- fica 'erro' (com o motivo) — a mensagem não se perde por causa da rede.
-- id_externo é o id da mensagem na uazapi/WhatsApp: é por ele que os webhooks
-- de entrega/leitura (e as mensagens recebidas) casam com esta linha depois.
-- ============================================================================

CREATE TABLE mensagens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id uuid NOT NULL REFERENCES atendimentos (id) ON DELETE CASCADE,
  origem         text NOT NULL CHECK (origem IN ('contato', 'agente')),
  autor_id       uuid,                        -- usuario quando 'agente'; NULL quando 'contato'
  texto          text NOT NULL,
  status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente', 'enviado', 'entregue', 'lido', 'erro', 'recebido')),
  id_externo     text,                        -- id na uazapi; NULL até enviar/receber
  erro           text,                        -- motivo, quando status = 'erro'
  data_criacao   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_mensagens_atendimento ON mensagens (atendimento_id, data_criacao);
-- Busca pela id da uazapi ao processar webhook de status/recebimento.
CREATE INDEX ix_mensagens_externo ON mensagens (id_externo) WHERE id_externo IS NOT NULL;
