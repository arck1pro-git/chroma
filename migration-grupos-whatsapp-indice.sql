-- ============================================================================
-- Migration: a trava de conversa por contato passa a valer só para conversa de
-- contato (2026-10-29). Roda DEPOIS do deploy que traz os grupos do WhatsApp
-- (migration-grupos-whatsapp.sql roda antes).
--
-- POR QUÊ: ux_atendimento_contato_numero é NULLS NOT DISTINCT, e a conversa de
-- grupo tem contato_id NULL. Duas conversas de grupo no mesmo número nosso
-- seriam "o mesmo par (NULL, número)" e a segunda bateria na trava.
--
-- POR QUE DEPOIS DO DEPLOY: com a trava parcial, o ON CONFLICT
-- (contato_id, numero_instancia) só a reconhece com o predicado
-- `WHERE contato_id IS NOT NULL`, que o código novo já manda (webhook da uazapi,
-- chat, Meta, Instagram, cadência). O código antigo não manda: aplicada antes
-- do deploy, toda mensagem nova falharia até o código novo entrar.
--
-- A nova nasce antes de a velha sair (e depois toma o nome dela): em nenhum
-- momento a tabela fica sem a trava. Sem BEGIN/COMMIT porque o runner
-- (scripts/rodar-sql.ts) manda o arquivo pelo protocolo simples, que já roda
-- os comandos de uma ida numa transação só.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS ux_atendimento_contato_numero_parcial
  ON atendimentos (contato_id, numero_instancia) NULLS NOT DISTINCT
  WHERE contato_id IS NOT NULL;
DROP INDEX IF EXISTS ux_atendimento_contato_numero;
ALTER INDEX ux_atendimento_contato_numero_parcial RENAME TO ux_atendimento_contato_numero;
