-- ============================================================================
-- Migration: Google Calendar na Agenda.
-- Idempotente: só CREATE TABLE/INDEX IF NOT EXISTS.
--
-- PEDIDO (2026-10-02): a Agenda usa o Google Calendar de UMA conta da empresa —
-- mostra os compromissos, marca reunião pela ficha da oportunidade e deixa a IA
-- comercial agendar sozinha (ação agendar_reuniao). As duas tabelas abaixo são
-- as que ele aprovou; o resto (eventos, horários livres) é lido do Google na
-- hora e não fica no banco.
--
-- ⚠ PRODUÇÃO: rodar ANTES do deploy. A ficha da oportunidade, a tela /agenda e
-- a IA leem estas tabelas; sem elas, dão erro em vez de "não conectado".
-- ============================================================================

-- A conexão com o Google. UMA linha só: a chave é um boolean que só aceita true,
-- então um segundo INSERT colide em vez de criar uma segunda conta.
CREATE TABLE IF NOT EXISTS google_conexao (
  unica         boolean PRIMARY KEY DEFAULT true CHECK (unica),
  conta_email   text NOT NULL,
  -- Cifrado com AES-256-GCM (lib/google-oauth.ts), chave derivada da
  -- SESSION_SECRET. Trocar a SESSION_SECRET exige conectar o Google de novo.
  refresh_token text NOT NULL,
  calendario_id text NOT NULL DEFAULT 'primary',
  conectado_por uuid REFERENCES usuarios (id) ON DELETE SET NULL,
  conectado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE google_conexao IS
  'A conta Google da empresa que alimenta a Agenda (uma linha só). Ver lib/google-oauth.ts.';

-- O vínculo evento do Google ↔ CRM. Início e fim ficam guardados para a ficha e
-- a IA saberem da reunião sem perguntar ao Google; a tela /agenda corrige os
-- dois quando a reunião é remarcada direto no Google.
CREATE TABLE IF NOT EXISTS agenda_reunioes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_evento_id text NOT NULL UNIQUE,
  contato_id       uuid NOT NULL REFERENCES contatos (id) ON DELETE CASCADE,
  -- NULL quando a IA marca para um contato sem oportunidade aberta.
  oportunidade_id  uuid REFERENCES oportunidades (id) ON DELETE SET NULL,
  inicio           timestamptz NOT NULL,
  fim              timestamptz NOT NULL,
  -- NULL = marcada pela IA (mesma convenção de historico.autor_id).
  autor_id         uuid REFERENCES usuarios (id) ON DELETE SET NULL,
  data_criacao     timestamptz NOT NULL DEFAULT now(),

  CHECK (fim > inicio)
);

COMMENT ON TABLE agenda_reunioes IS
  'Reuniões criadas pelo Chroma no Google Calendar, ligadas ao contato e à oportunidade.';

CREATE INDEX IF NOT EXISTS ix_agenda_reunioes_contato ON agenda_reunioes (contato_id, inicio DESC);
CREATE INDEX IF NOT EXISTS ix_agenda_reunioes_op      ON agenda_reunioes (oportunidade_id, inicio DESC);
