-- Configuração da automação já existente por conta/publicação.
-- Compatível com regras antigas: JSON vazio mantém o atendimento por IA.
ALTER TABLE instagram_ia_regras ADD COLUMN IF NOT EXISTS automacao jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Mensagem pronta não precisa de IA; IA e continuação são validadas no servidor.
ALTER TABLE instagram_ia_regras ALTER COLUMN ia_id DROP NOT NULL;
COMMENT ON COLUMN instagram_ia_regras.automacao IS
  'Modo IA ou mensagem pronta, palavras alternativas, mensagem no Direct, resposta pública opcional e continuação por IA.';
