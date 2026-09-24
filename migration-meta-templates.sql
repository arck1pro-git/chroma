-- Libera o novo módulo Templates para Admin e TI. Idempotente.
INSERT INTO departamento_modulos (departamento_id, modulo, escopo)
SELECT id, 'templates', 'todos'
  FROM departamentos
 WHERE slug IN ('admin', 'ti')
ON CONFLICT (departamento_id, modulo) DO NOTHING;
