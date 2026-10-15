-- ============================================================================
-- Migration: índices da busca de contatos (lib/contatos-busca.ts).
-- Nada aqui apaga dado. CONCURRENTLY: o índice é montado sem travar as
-- gravações em `contatos` (rodar uma instrução por vez, fora de transação).
--
-- POR QUE: desde 2026-10-15 contato só aparece quando é pesquisado (pedido
-- dele, com os ~27 mil leads do SprintHub). Sem índice, cada busca por nome ou
-- e-mail varre a tabela inteira (~100 ms com 27 mil linhas, e piora com a base).
-- O telefone já tinha o seu (migration-indice-contato-whatsapp.sql).
--
-- A EXPRESSÃO DO NOME TEM QUE SER IGUAL À DA CONSULTA, caractere por
-- caractere — é assim que o Postgres reconhece que o índice serve. Mudou lá,
-- muda aqui (e recria o índice).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Nome sem acento: "joao" acha "João"; serve ao LIKE '%…%' e ao parecido (%).
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_contatos_nome_busca_trgm
  ON contatos
  USING gin (translate(lower(nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') gin_trgm_ops);

-- E-mail em qualquer parte ("@gmail", "joao.silva"). O ix_contatos_email_lower
-- (btree) só atende igualdade, não o LIKE com % no começo.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_contatos_email_trgm
  ON contatos
  USING gin (lower(email) gin_trgm_ops);
