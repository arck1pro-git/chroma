-- ============================================================================
-- Migration: leitura de `documentos` para o role do motor (chroma_n8n).
-- Nada aqui apaga dado.
--
-- POR QUE: o nó "Registrar [msg]" dos workflows de cadência faz LEFT JOIN em
-- documentos (o anexo da mensagem). Quando o anexo entrou na cadência, este
-- GRANT ficou de fora, e o nó passou a falhar em TODA mensagem:
--
--   permission denied for table documentos
--
-- Conferido nas execuções do n8n em 2026-10-15. Desde ~2026-09-18 nenhuma
-- mensagem de cadência era registrada e o workflow parava ali, logo depois de
-- enviar a 1ª mensagem — as seguintes nunca saíam.
--
-- Desde 2026-10-15 quem grava a mensagem é o CRM (app/api/automacoes/enviar)
-- e o nó das cadências republicadas só marca o passo. Este GRANT é o que
-- destrava as cadências JÁ publicadas, que ainda têm o nó antigo.
-- ============================================================================

GRANT SELECT ON documentos TO chroma_n8n;  -- o anexo, no nó de registro das cadências
