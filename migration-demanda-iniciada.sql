-- "Em andamento" gravado na demanda (2026-10-09).
--
-- PARA QUE SERVE: até aqui "Em andamento" era calculado — a demanda a fazer
-- com algum passo do checklist marcado — e ninguém arrastava um cartão para
-- lá. Pedido dele de 2026-10-09: poder arrastar. Para o cartão ficar onde foi
-- solto, a demanda precisa guardar que começou.
--
-- Decisões dele (2026-10-09):
--   · duas colunas, como feita_em/feita_por: quando começou e quem pôs ali;
--   · arrastar para "Em andamento" preenche; arrastar de volta para uma coluna
--     de prazo limpa;
--   · marcar um passo do checklist também preenche, como já era — a diferença
--     é que agora fica gravado.
--
-- Em andamento = a fazer (feita_em nula) com iniciada_em preenchida. Dar o
-- check não apaga iniciada_em: desmarcar a demanda a devolve para "Em
-- andamento", que é onde ela estava.
--
-- Rodar ANTES do deploy que traz o arraste.

ALTER TABLE demandas
  ADD COLUMN iniciada_em  timestamptz,
  ADD COLUMN iniciada_por uuid REFERENCES usuarios (id) ON DELETE SET NULL;

-- Quem já tem passo marcado continua onde está: a demanda começou quando o
-- primeiro passo foi marcado, por quem o marcou. Vale também para as feitas,
-- para que desmarcar uma delas a devolva para "Em andamento", como hoje.
UPDATE demandas d
   SET iniciada_em = p.feito_em, iniciada_por = p.feito_por
  FROM (SELECT DISTINCT ON (demanda_id) demanda_id, feito_em, feito_por
          FROM demanda_itens
         WHERE feito_em IS NOT NULL
         ORDER BY demanda_id, feito_em) p
 WHERE p.demanda_id = d.id;
