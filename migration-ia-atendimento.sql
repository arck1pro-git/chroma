-- ============================================================================
-- Migration: IA atendendo os contatos pelo WhatsApp.
-- Idempotente. Nada aqui apaga dado.
--
-- PEDIDO: "definir na etapa se quem está ali será atendido por uma IA nos
-- canais que ele interagir (responder); na gaveta do contato vincular,
-- desvincular ou removê-lo da IA da etapa; oportunidade com IA atendendo tem
-- um robô na cor do funil".
--
-- Decisões dele (2026-09-28):
--   · o liga/desliga mora na ETAPA;
--   · a exceção mora no CONTATO e vale sempre (não zera ao mudar de etapa);
--   · a mensagem da IA ganha marca própria em enviada_por.
-- ============================================================================

-- 1. A etapa atende com IA? Quem tem oportunidade aberta nela é respondido
--    pela IA — a menos que o contato diga o contrário (abaixo).
ALTER TABLE etapas
  ADD COLUMN IF NOT EXISTS ia_atende boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN etapas.ia_atende IS
  'Contatos com oportunidade aberta nesta etapa são respondidos pela IA no WhatsApp (salvo contatos.ia = false).';

-- 2. A exceção do contato, com três estados:
--      NULL  → segue a etapa (o normal)
--      true  → vinculado: a IA atende mesmo sem etapa com IA
--      false → removido: a IA nunca atende, mesmo em etapa com IA
--    É também o que a IA grava quando passa a conversa para uma pessoa.
ALTER TABLE contatos
  ADD COLUMN IF NOT EXISTS ia boolean;

COMMENT ON COLUMN contatos.ia IS
  'Atendimento por IA: NULL segue a etapa; true = vinculado à IA; false = removido da IA.';

-- 3. A marca da mensagem que a IA mandou. Não é 'automacao' de propósito: a
--    guarda da cadência (lib/automacoes/motores/n8n/adaptador.ts) só segue
--    quando a última mensagem é dela mesma ('automacao'). Resposta da IA
--    precisa contar como "alguém respondeu o lead", senão a cadência voltava
--    a mandar mensagem para quem já estava conversando.
ALTER TABLE mensagens DROP CONSTRAINT IF EXISTS mensagens_enviada_por_check;
ALTER TABLE mensagens
  ADD CONSTRAINT mensagens_enviada_por_check CHECK (
    enviada_por IS NULL OR enviada_por IN ('automacao', 'crm', 'aparelho', 'ia')
  );
