-- ============================================================================
-- Migration: várias IAs de atendimento.
-- Idempotente. Roda DEPOIS de migration-ia-atendimento.sql (precisa de
-- contatos.ia e do 'ia' em mensagens.enviada_por).
--
-- PEDIDO (2026-09-28): "preciso poder escolher a IA que vai fazer o
-- atendimento"; botão de IA no topo, ao lado do de contatos, com as IAs
-- criadas e o de criar. Criar uma IA = dar um prompt e marcar o que ela pode
-- fazer — por ora, mover a oportunidade entre etapas.
--
-- Decisões dele (2026-09-28):
--   · a escolha mora na ETAPA (etapas.ia_id, que substitui ia_atende);
--   · o CONTATO continua com a exceção (contatos.ia) e, ligado à mão, diz QUAL
--     IA (contatos.ia_id);
--   · o prompt vai POR CIMA das regras fixas (estilo, só o que está em
--     Contextos, avisar a equipe, passar para humano) — lib/ia/atendente.ts;
--   · "mover entre etapas" = qualquer etapa do funil da oportunidade.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ias (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  prompt       text NOT NULL,
  -- O que ela pode fazer além de conversar. Os valores válidos estão em
  -- lib/ia/catalogo.ts ('mover_etapa'); sem CHECK aqui para que uma ação nova
  -- não exija migration.
  acoes        text[] NOT NULL DEFAULT '{}',
  data_criacao timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ias IS
  'IAs de atendimento no WhatsApp: prompt próprio por cima das regras fixas de lib/ia/atendente.ts.';

-- A IA da etapa: quem tem oportunidade ABERTA aqui é atendido por ela.
-- Excluir a IA desliga as etapas que a usavam (SET NULL), sem apagar a etapa.
ALTER TABLE etapas
  ADD COLUMN IF NOT EXISTS ia_id uuid REFERENCES ias (id) ON DELETE SET NULL;

COMMENT ON COLUMN etapas.ia_id IS
  'IA que atende no WhatsApp quem tem oportunidade aberta nesta etapa (NULL = nenhuma), salvo exceção em contatos.ia.';

-- A IA do contato ligado à mão (contatos.ia = true). Com contatos.ia NULL ou
-- false, fica NULL: quem manda é a etapa, ou ninguém.
ALTER TABLE contatos
  ADD COLUMN IF NOT EXISTS ia_id uuid REFERENCES ias (id) ON DELETE SET NULL;

COMMENT ON COLUMN contatos.ia_id IS
  'IA escolhida quando contatos.ia = true (ligada à mão). NULL nos outros casos.';

-- Parcial: quase nenhum contato tem IA própria, e o índice existe só para o
-- SET NULL de excluir uma IA não varrer a tabela inteira de contatos.
CREATE INDEX IF NOT EXISTS ix_contatos_ia ON contatos (ia_id) WHERE ia_id IS NOT NULL;

-- ── Conversão do ia_atende ──────────────────────────────────────────────────
-- Onde já havia IA ligada (etapa com ia_atende, ou contato ligado à mão), a
-- conversa continua sendo atendida: nasce a IA "Atendente comercial" com o
-- papel que o prompt fixo tinha até aqui, e ela assume esses lugares. Sem
-- nenhum uso, nada é criado. Depois disso ia_atende sai — quem responde agora
-- é etapas.ia_id.
DO $$
DECLARE
  convertida uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'etapas' AND column_name = 'ia_atende'
  ) THEN
    IF EXISTS (SELECT 1 FROM etapas WHERE ia_atende) OR EXISTS (SELECT 1 FROM contatos WHERE ia) THEN
      INSERT INTO ias (nome, prompt, acoes)
      VALUES (
        'Atendente comercial',
        E'Você é o assistente virtual da equipe comercial.\n\n'
        'Seu papel é CONDUZIR a conversa, não só repassar:\n'
        '- Responda você mesmo com o que a base de conhecimento diz: o que é o empreendimento, onde fica, para quem é, diferenciais.\n'
        '- Faça UMA pergunta por vez para entender o que a pessoa busca (investir ou morar, tipo de unidade, prazo) e mantenha a conversa andando.',
        -- Passar para uma pessoa virou ação da IA (lib/ia/catalogo.ts); a
        -- convertida mantém o que o atendimento fazia antes.
        '{passar_para_humano}'
      )
      RETURNING id INTO convertida;

      UPDATE etapas SET ia_id = convertida WHERE ia_atende AND ia_id IS NULL;
      UPDATE contatos SET ia_id = convertida WHERE ia AND ia_id IS NULL;
    END IF;

    ALTER TABLE etapas DROP COLUMN ia_atende;
  END IF;
END $$;
