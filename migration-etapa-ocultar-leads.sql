-- ============================================================================
-- Etapa com os leads OCULTOS no quadro (pedido dele, 2026-10-16). A coluna
-- continua lá, com a contagem e o valor, e continua recebendo card arrastado;
-- só os cards não aparecem. Liga e desliga pelo olho no cabeçalho da coluna.
--
-- Nasce marcada na "sem interesse - sem perfil - sem capital" de cada funil.
--
-- Em PROD: ANTES do deploy do código que usa.
--   · migration sem o código novo: inofensivo, o código em produção não lê a
--     coluna.
--   · código novo sem o migration: QUEBRA o quadro (carregarFunil seleciona
--     etapas.ocultar_leads).
-- Pode rodar mais de uma vez.
-- ============================================================================

ALTER TABLE etapas ADD COLUMN IF NOT EXISTS ocultar_leads boolean NOT NULL DEFAULT false;

UPDATE etapas SET ocultar_leads = true
 WHERE nome ILIKE 'sem interesse%sem perfil%' AND NOT ocultar_leads;
