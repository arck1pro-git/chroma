-- A folha do pessoal, para o módulo Financeiro (pedido dele, 2026-11-03).
--
-- DUAS TABELAS, pelo que muda e pelo que não muda:
--   · financeiro_colaboradores: o cadastro de pagamento de cada pessoa (setor,
--     atividade principal, tipo, valor hora, valor mês e PIX). Vale para todos
--     os meses.
--   · financeiro_lancamentos: o adicional (deslocamento ou ajuda de custo) e os
--     descontos de cada pessoa EM CADA MÊS. Decisão dele: lançados por mês, para
--     mexer em novembro não mudar outubro. Mês sem linha é zero.
--
-- O COLABORADOR mora em outra base, a do app de ponto (lib/ponto-db.ts), que o
-- CRM só lê. Por isso a ligação é pelo id do cadastro de lá (users.id, texto) e
-- não há FK: a outra base não está aqui.
--
-- O QUE NÃO SE GRAVA, porque é conta (lib/financeiro-tipos.ts): a referência
-- (as horas do mês, vindas do ponto), o total do profissional (por hora: horas
-- × valor hora; fixo: valor mês; mais adicional, menos descontos), o total do
-- setor e o total dos pagamentos.
--
-- PIX E VALORES SÃO DADO PESSOAL: a IA das telas (papel chroma_ia, que lê toda
-- tabela nova por DEFAULT PRIVILEGES) perde a leitura das duas. Quem vê é quem
-- tem o módulo Financeiro.
--
-- Rodar ANTES do deploy que traz a aba Folha (sem as tabelas, a tela avisa e
-- não quebra). Pode rodar de novo: tudo é IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS financeiro_colaboradores (
  pessoa_id  text PRIMARY KEY,
  setor      text CHECK (length(setor) <= 80),
  atividade  text CHECK (length(atividade) <= 120),
  tipo       text NOT NULL CHECK (tipo IN ('hora', 'fixo')),
  valor_hora numeric(12, 2) CHECK (valor_hora >= 0),
  valor_mes  numeric(12, 2) CHECK (valor_mes >= 0),
  pix        text CHECK (length(pix) <= 140),
  CONSTRAINT financeiro_colaboradores_valor_do_tipo CHECK (
    (tipo = 'hora' AND valor_hora IS NOT NULL) OR (tipo = 'fixo' AND valor_mes IS NOT NULL)
  )
);

-- Para o banco em que a tabela nasceu antes do setor e da atividade (o DEV, no mesmo dia).
ALTER TABLE financeiro_colaboradores ADD COLUMN IF NOT EXISTS setor text CHECK (length(setor) <= 80);
ALTER TABLE financeiro_colaboradores ADD COLUMN IF NOT EXISTS atividade text CHECK (length(atividade) <= 120);

CREATE TABLE IF NOT EXISTS financeiro_lancamentos (
  pessoa_id text NOT NULL,
  -- AAAA-MM, o mesmo formato do ?mes= da tela.
  mes       text NOT NULL CHECK (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  adicional numeric(12, 2) NOT NULL DEFAULT 0 CHECK (adicional >= 0),
  descontos numeric(12, 2) NOT NULL DEFAULT 0 CHECK (descontos >= 0),
  PRIMARY KEY (pessoa_id, mes)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chroma_ia') THEN
    REVOKE ALL ON financeiro_colaboradores FROM chroma_ia;
    REVOKE ALL ON financeiro_lancamentos FROM chroma_ia;
  END IF;
END $$;
