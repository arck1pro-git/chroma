-- Candidatos ainda não avaliados: sobrevive a timeout do webhook/agendador.
-- Default false preserva o histórico sem respostas retroativas.
ALTER TABLE instagram_comentarios ADD COLUMN IF NOT EXISTS automacao_pendente boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ix_ig_automacao_pendente ON instagram_comentarios (data_criacao)
  WHERE automacao_pendente;
