-- Aplicar depois de publicar o código que deixa de consultar este módulo.
-- Não usa CASCADE: dependência inesperada deve impedir a exclusão.
DO $$
BEGIN
  DELETE FROM departamento_modulos WHERE modulo = 'contextos';
  ALTER TABLE blog DROP COLUMN IF EXISTS auditoria_id;
  DROP TABLE IF EXISTS ia_conversa_contextos;
  DROP TABLE IF EXISTS contexto_versoes;
  DROP TABLE IF EXISTS contextos;
END $$;
