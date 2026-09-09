-- ============================================================================
-- Migration: a cadência de uma etapa É uma automação.
-- Revise e rode você mesmo (psql, painel do Supabase). Nada aqui apaga dado.
--
-- POR QUE: as "subetapas" do painel da raiz eram estado de tela em cima de um
-- JSON de mock (app/mock/subetapas.json). Agora cada etapa aponta para UM
-- fluxo de automação, e as colunas do kanban são a projeção desse fluxo
-- (lib/automacoes/cadencia.ts). Criar, editar por prompt, publicar e disparar
-- passam a mexer no mesmo lugar.
--
-- São TRÊS mexidas independentes; a 2 e a 3 são furos que apareceram ao ligar
-- o disparo de verdade, não invenção desta tela.
-- ============================================================================

-- ── 1. Amarra fluxo ↔ etapa ─────────────────────────────────────────────────
-- Nullable de propósito: fluxo comum (o de /automacoes) não tem etapa. Só o
-- que nasce pelo painel da etapa carrega este campo.
--
-- ON DELETE SET NULL e não CASCADE: apagar uma etapa não pode apagar junto o
-- histórico de execuções de um fluxo que já disparou mensagem para gente real.
ALTER TABLE fluxos
  ADD COLUMN etapa_id uuid REFERENCES etapas (id) ON DELETE SET NULL;

-- Uma cadência por etapa. Parcial porque a esmagadora maioria dos fluxos tem
-- etapa_id NULL, e NULL não colide com NULL — sem o WHERE, o índice ainda
-- funcionaria, mas indexaria à toa a tabela inteira.
CREATE UNIQUE INDEX ux_fluxos_etapa
  ON fluxos (etapa_id)
  WHERE etapa_id IS NOT NULL AND arquivado_em IS NULL;

-- ── 2. Partições de fluxo_execucao_passos ───────────────────────────────────
-- FURO NO schema-automacoes.sql: a tabela é PARTITION BY RANGE (iniciado_em) e
-- só existe a partição de julho/2026 ("criar as seguintes por job mensal" — o
-- job não existe). Hoje é setembro: o primeiro INSERT de passo estouraria com
-- "no partition of relation found for row", e o primeiro passo acontece no
-- primeiro disparo. Sem isto, a automação publica e falha na hora de gravar.
--
-- A DEFAULT é a rede de segurança para o mês que ninguém lembrou de criar.
-- Preço a saber: com linhas na DEFAULT, anexar a partição daquele mês depois
-- exige varrer a DEFAULT inteira (o Postgres precisa provar que não há linha
-- que deveria estar na nova). Com o volume desta tabela hoje, é barato.
CREATE TABLE IF NOT EXISTS fluxo_execucao_passos_2026_08 PARTITION OF fluxo_execucao_passos
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS fluxo_execucao_passos_2026_09 PARTITION OF fluxo_execucao_passos
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS fluxo_execucao_passos_2026_10 PARTITION OF fluxo_execucao_passos
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS fluxo_execucao_passos_2026_11 PARTITION OF fluxo_execucao_passos
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS fluxo_execucao_passos_2026_12 PARTITION OF fluxo_execucao_passos
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS fluxo_execucao_passos_default PARTITION OF fluxo_execucao_passos
  DEFAULT;

-- Índice que o rate limit consulta: "quantas mensagens saíram no último
-- minuto". Sem ele a checagem varre a partição do mês a cada disparo.
CREATE INDEX IF NOT EXISTS ix_passos_recentes
  ON fluxo_execucao_passos (no_tipo, iniciado_em DESC);

-- ── 3. motor_credenciais: NÃO precisa mexer ────────────────────────────────
-- Decisão de 2026-09-04: os nós publicados autenticam de volta no CRM com o
-- CRM_SERVICE_TOKEN escrito direto no header, montado pelo adaptador a partir
-- do .env. A tabela motor_credenciais continua no schema, e vazia.
--
-- O preço está escrito em docs/automacoes-n8n.md §3: o token fica visível no
-- JSON do workflow, numa instância compartilhada, e trocá-lo obriga a
-- republicar os fluxos.
