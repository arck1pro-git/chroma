-- ============================================================================
-- Migration: anexar um atendimento a uma oportunidade.
-- Revise e rode você mesmo (psql, painel do Neon, etc.). Nada aqui apaga dado.
--
-- POR QUE: a ficha da oportunidade passa a listar os atendimentos do contato
-- (canal + número) com um botão "anexar" — associa a CONVERSA à oportunidade
-- em vista, pra depois a IA (lib/ia/ferramentas.ts) conseguir puxar as
-- mensagens quando perguntarem sobre o negócio. Sem esta coluna não há onde
-- guardar esse vínculo.
--
-- NULLABLE de propósito: a imensa maioria dos atendimentos nasce solta (só do
-- contato) e o vínculo é um passo manual, não automático.
-- ============================================================================

ALTER TABLE atendimentos
  ADD COLUMN oportunidade_id uuid REFERENCES oportunidades (id);

CREATE INDEX ix_atendimentos_oportunidade
  ON atendimentos (oportunidade_id)
  WHERE oportunidade_id IS NOT NULL;
