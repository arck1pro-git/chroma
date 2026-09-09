-- ============================================================================
-- Migration: campos personalizados (definição + valores).
-- Revise e rode você mesmo (psql, painel do Neon, etc.). Nada aqui apaga dado.
--
-- POR QUE: o export do SprintHub traz ~30 colunas que não são do nosso schema e
-- variam de contato para contato (perguntas do formulário, UTMs, profissão,
-- resumo do SDR…). Elas não cabem em coluna fixa — e inventar uma coluna por
-- pergunta engessaria o CRM na primeira pergunta nova.
--
-- MODELO (decidido em 2026-09-03): a DEFINIÇÃO de cada campo vira linha em
-- campos_personalizados (é essa lista que a aba de Configurações edita); o
-- VALOR mora num jsonb na própria linha do contato/oportunidade.
--
-- Por que jsonb e não tabela de valores (EAV): as telas já carregam a base
-- inteira a cada render (hoje / leva ~5,7s com 17,8 mil contatos). Um EAV
-- somaria ~42 mil linhas e mais um JOIN nesse mesmo caminho quente. No jsonb
-- o valor vem de carona na linha que já está sendo lida — consulta zero a mais.
-- O custo é filtrar por campo exigir operador jsonb; o índice GIN abaixo cobre.
-- ============================================================================

CREATE TABLE campos_personalizados (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- a que ficha o campo pertence. Um mesmo `chave` pode existir nos dois
  -- (ex.: profissao no contato E na oportunidade) — daí o UNIQUE composto.
  entidade     text NOT NULL CHECK (entidade IN ('contato', 'oportunidade')),

  -- chave: como o valor é gravado no jsonb. rotulo: como aparece na tela.
  chave        text NOT NULL,
  rotulo       text NOT NULL,

  tipo         text NOT NULL DEFAULT 'texto'
                 CHECK (tipo IN ('texto', 'numero', 'data', 'opcao')),
  -- só quando tipo = 'opcao'; a UI vira select em vez de campo livre
  opcoes       text[],

  ordem        int NOT NULL DEFAULT 0,
  data_criacao timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entidade, chave)
);

CREATE INDEX ix_campos_personalizados_entidade
  ON campos_personalizados (entidade, ordem);

-- DEFAULT '{}': contato sem nenhum campo preenchido não vira NULL a ser tratado
-- em toda leitura — é um objeto vazio, e o código lê igual.
ALTER TABLE contatos
  ADD COLUMN campos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE oportunidades
  ADD COLUMN campos jsonb NOT NULL DEFAULT '{}'::jsonb;

-- GIN: é o que faz `campos @> '{"utm_source":"google"}'` usar índice em vez de
-- varrer as 17,8 mil linhas.
CREATE INDEX ix_contatos_campos      ON contatos      USING gin (campos);
CREATE INDEX ix_oportunidades_campos ON oportunidades USING gin (campos);
