-- ============================================================================
-- Migration: índice pro casamento de contato por WhatsApp no webhook.
-- Revise e rode você mesmo (psql, painel do Neon, etc.). Nada aqui apaga dado.
--
-- POR QUE: app/api/uazapi/webhook/route.ts casa contato assim:
--   WHERE regexp_replace(whatsapp, '\D', '', 'g') LIKE '%' || fim8
-- Sem índice, isso é varredura completa de `contatos` A CADA MENSAGEM
-- recebida. Com 1 contato (hoje) é instantâneo; com os ~30 mil leads que
-- entram em breve, cada mensagem do WhatsApp passa a escanear a tabela
-- inteira — de forma perceptível, e piorando conforme a base cresce.
--
-- POR QUE TRIGRAM (pg_trgm) E NÃO UM ÍNDICE COMUM: o padrão tem % NO INÍCIO
-- ("termina com estes 8 dígitos"), e um índice B-tree comum só acelera busca
-- por PREFIXO ("começa com"), não por sufixo. Trigram indexa pedaços de 3
-- caracteres e serve qualquer LIKE com %, então a query do webhook nem
-- precisa mudar — só ganha o índice por baixo.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX ix_contatos_whatsapp_trgm
  ON contatos
  USING gin (regexp_replace(whatsapp, '\D', '', 'g') gin_trgm_ops);
