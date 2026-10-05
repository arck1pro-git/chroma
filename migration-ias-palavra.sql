-- ============================================================================
-- Migration: palavra que liga e desliga a IA pelo celular.
-- Idempotente. Roda DEPOIS de migration-ias.sql (precisa da tabela ias).
--
-- PEDIDO (2026-10-01): "uma mensagem que seja do telefone ativa ou desativa a
-- IA; preciso poder definir essa palavra na IA, nas configs dela".
--
-- Como funciona (lib/ia/contato-ia.ts, alternarIaPelaPalavra):
--   · o atendente manda, do celular, uma mensagem que é EXATAMENTE a palavra
--     (sem diferença de maiúscula e de espaço nas pontas);
--   · se essa IA está atendendo o contato, ela desliga (contatos.ia = false);
--     se não está, liga — volta a seguir a etapa quando a IA da etapa é ela,
--     senão fica ligada à mão (contatos.ia = true, ia_id = ela).
--   · a mensagem da palavra é o ponto de passagem: o que a equipe escreveu
--     ANTES dela deixa de calar a IA pela regra da última hora
--     (lib/ia/atendente.ts, humano_recente).
--
-- ⚠ PRODUÇÃO: lib/ia/atendente.ts lê ias.palavra_chave em toda mensagem.
-- Rodar esta migration ANTES do deploy, senão a IA para de responder.
-- ============================================================================

ALTER TABLE ias
  ADD COLUMN IF NOT EXISTS palavra_chave text;

COMMENT ON COLUMN ias.palavra_chave IS
  'Mensagem enviada pelo celular (inteira, sem diferença de maiúscula) que liga ou desliga esta IA para o contato. NULL = sem palavra.';

-- Uma palavra, uma IA: com duas IAs na mesma palavra não haveria como saber
-- qual ligar. Sem diferença de maiúscula, como a comparação.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ias_palavra_chave
  ON ias (lower(palavra_chave))
  WHERE palavra_chave IS NOT NULL;
