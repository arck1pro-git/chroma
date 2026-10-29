-- ============================================================================
-- Migration: grupos do WhatsApp Web no chat e conversa fixada (2026-10-29).
-- Roda ANTES do deploy. Só cria e acrescenta: nada é apagado, e o código que
-- está no ar continua funcionando com ela aplicada.
--
-- Pedido dele: "captar quando for um grupo [...] os grupos vão aparecer
-- destacados e com possibilidade de fixar no chat". Decisões dele no mesmo dia:
-- o grupo tem TABELA PRÓPRIA (não vira contato) e FIXAR vale para toda a equipe.
--
-- Depois do deploy roda migration-grupos-whatsapp-indice.sql, que restringe a
-- trava de conversa por contato às conversas de contato (ver o cabeçalho dela).
-- ============================================================================

-- ── 1. O grupo ──────────────────────────────────────────────────────────────
-- jid: o id do grupo no WhatsApp ("120363…@g.us"), que é também o destino do
--      envio pela uazapi. Um grupo só, mesmo com dois números nossos dentro: a
--      conversa é por par (grupo, número nosso), em atendimentos, como a do
--      contato.
-- nome e foto_url: o que a uazapi informa (chat.name no evento, ou
--      POST /group/info). Renomear o grupo no WhatsApp atualiza aqui na
--      próxima mensagem.
CREATE TABLE IF NOT EXISTS grupos_whatsapp (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jid           text NOT NULL UNIQUE CHECK (jid LIKE '%@g.us'),
  nome          text NOT NULL DEFAULT '',
  foto_url      text,
  data_criacao  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. A conversa é do contato OU do grupo ──────────────────────────────────
-- contato_id deixa de ser obrigatório só para a conversa de grupo; o CHECK
-- garante que cada conversa tem exatamente um dos dois. Toda consulta que faz
-- JOIN contatos continua vendo só conversa de contato (IA, métricas, MCP,
-- campanhas): o grupo aparece só no chat, que lê com LEFT JOIN.
ALTER TABLE atendimentos ALTER COLUMN contato_id DROP NOT NULL;
ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES grupos_whatsapp (id) ON DELETE CASCADE;
ALTER TABLE atendimentos DROP CONSTRAINT IF EXISTS atendimentos_contato_ou_grupo;
ALTER TABLE atendimentos
  ADD CONSTRAINT atendimentos_contato_ou_grupo CHECK ((contato_id IS NULL) <> (grupo_id IS NULL));

-- Uma conversa por par (grupo, número nosso), como ux_atendimento_contato_numero
-- faz para o contato. É a trava que o ON CONFLICT do webhook da uazapi usa.
CREATE UNIQUE INDEX IF NOT EXISTS ux_atendimento_grupo_numero
  ON atendimentos (grupo_id, numero_instancia) NULLS NOT DISTINCT
  WHERE grupo_id IS NOT NULL;

-- ── 3. Conversa fixada ──────────────────────────────────────────────────────
-- Quando foi fixada (NULL = não está). Vale para toda a equipe: os fixados
-- ficam no topo da lista do chat.
ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS fixada_em timestamptz;

-- ── 4. Quem falou no grupo ──────────────────────────────────────────────────
-- O nome de quem mandou a mensagem num grupo (senderName da uazapi, ou o fim
-- do número quando ele não vem). NULL fora de grupo e no que saiu do nosso lado.
ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS remetente_nome text;
