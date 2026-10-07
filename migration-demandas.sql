-- Demandas e chamados para o TI (2026-10-07).
--
-- PARA QUE SERVE: cada pessoa vê as demandas que são dela e dá o check quando
-- fez. Admin e TI criam demandas para uma pessoa ou para todos. Qualquer
-- pessoa logada abre um CHAMADO pelo botão do Dashboard, e ele vira uma
-- demanda do departamento TI.
--
-- UMA TABELA SÓ. Chamado não tem tabela própria: é uma demanda cujo destino é
-- o departamento TI em vez de uma pessoa. Pelo mesmo motivo não há coluna
-- `tipo` — quem diz se é chamado é `departamento_id` estar preenchido.
--
-- "PARA TODOS" NÃO É UMA LINHA: vira UMA DEMANDA POR PESSOA, e cada um marca a
-- sua. Uma linha só com vários donos fecharia para todo mundo no primeiro
-- check.
--
-- Rodar ANTES do deploy que traz a tela /demandas.

CREATE TABLE demandas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          text NOT NULL CHECK (btrim(titulo) <> ''),
  descricao       text,
  -- Só a data, sem hora: "até sexta". Atrasada é prazo antes de hoje e ainda
  -- sem check.
  prazo           date,
  prioridade      text NOT NULL DEFAULT 'normal'
                    CHECK (prioridade IN ('baixa', 'normal', 'alta')),

  -- PARA QUEM: uma pessoa OU um departamento, nunca os dois e nunca nenhum.
  --   responsavel_id   → demanda criada pelo Admin/TI para alguém
  --   departamento_id  → chamado: vai para o TI, qualquer um de lá vê e o
  --                      primeiro check fecha
  responsavel_id  uuid REFERENCES usuarios (id),
  departamento_id uuid REFERENCES departamentos (id),
  CONSTRAINT demandas_um_destino
    CHECK (num_nonnulls(responsavel_id, departamento_id) = 1),

  -- Quem criou. É o que alimenta "Abertos por mim" (o chamado que a pessoa
  -- abriu e quer acompanhar).
  criado_por      uuid REFERENCES usuarios (id) ON DELETE SET NULL,
  data_criacao    timestamptz NOT NULL DEFAULT now(),

  -- O CHECK: nulo = pendente. Desmarcar volta os dois para nulo.
  feita_em        timestamptz,
  feita_por       uuid REFERENCES usuarios (id) ON DELETE SET NULL
);

CREATE INDEX ix_demandas_responsavel
  ON demandas (responsavel_id, data_criacao DESC) WHERE responsavel_id IS NOT NULL;
CREATE INDEX ix_demandas_departamento
  ON demandas (departamento_id, data_criacao DESC) WHERE departamento_id IS NOT NULL;
CREATE INDEX ix_demandas_criado_por
  ON demandas (criado_por, data_criacao DESC);

-- O MÓDULO "demandas" nasce sem ninguém, como todo módulo novo
-- (lib/auth/modulos.ts): marque os três departamentos em
-- /configuracoes/acessos. O TI PRECISA tê-lo — é por ele que os chamados
-- aparecem.
