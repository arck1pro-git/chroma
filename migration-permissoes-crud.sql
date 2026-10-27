-- Mantém as operações dos módulos já liberados. Concessões novas começam em leitura.
ALTER TABLE departamento_modulos ADD COLUMN IF NOT EXISTS criar boolean NOT NULL DEFAULT true;
ALTER TABLE departamento_modulos ADD COLUMN IF NOT EXISTS editar boolean NOT NULL DEFAULT true;
ALTER TABLE departamento_modulos ADD COLUMN IF NOT EXISTS excluir boolean NOT NULL DEFAULT true;
ALTER TABLE departamento_modulos ALTER COLUMN criar SET DEFAULT false;
ALTER TABLE departamento_modulos ALTER COLUMN editar SET DEFAULT false;
ALTER TABLE departamento_modulos ALTER COLUMN excluir SET DEFAULT false;
