-- Checklist dentro da demanda (2026-10-07).
--
-- PARA QUE SERVE: quebrar uma demanda nos passos do que precisa ser feito, e
-- marcar cada passo.
--
-- Decisões dele (2026-10-07):
--   · quem CRIOU a demanda monta o checklist (põe, renomeia e tira itens);
--     quem RECEBE só marca — a mesma pessoa que dá o check na demanda;
--   · o check da demanda continua manual: o checklist mostra o progresso e,
--     com o último item marcado, a tela sugere fechar a demanda;
--   · na demanda "para todos" (uma linha por pessoa, ver migration-demandas.sql)
--     cada cópia tem os SEUS itens, e cada pessoa marca os dela. O que quem
--     criou muda no checklist vale para todas as cópias, pela posição do item
--     (lib/demandas.ts);
--   · cada item guarda quem marcou e quando.
--
-- Rodar ANTES do deploy que traz o checklist.

CREATE TABLE demanda_itens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: o item não existe sem a demanda; excluir a demanda leva o checklist.
  demanda_id   uuid NOT NULL REFERENCES demandas (id) ON DELETE CASCADE,
  texto        text NOT NULL CHECK (btrim(texto) <> ''),
  -- A posição na lista. Também é ela que diz qual item é "o mesmo" nas cópias
  -- de uma demanda para todos: renomear o 3º item renomeia o 3º de cada cópia.
  -- Tirar um item deixa um buraco na sequência, e tudo bem — só a ordem importa.
  ordem        integer NOT NULL,
  -- O check do item: nulo = pendente. Desmarcar volta os dois para nulo.
  feito_em     timestamptz,
  feito_por    uuid REFERENCES usuarios (id) ON DELETE SET NULL,
  data_criacao timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_demanda_itens_demanda ON demanda_itens (demanda_id, ordem);
