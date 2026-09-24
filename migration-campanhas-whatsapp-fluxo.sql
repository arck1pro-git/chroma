-- Campanha oficial como fluxo: envio → espera → respondeu/não respondeu → ações.
ALTER TABLE campanhas_whatsapp DROP CONSTRAINT IF EXISTS campanhas_whatsapp_status_check;
ALTER TABLE campanhas_whatsapp ALTER COLUMN status SET DEFAULT 'rascunho';
ALTER TABLE campanhas_whatsapp ADD COLUMN IF NOT EXISTS definicao jsonb NOT NULL DEFAULT '{"espera_minutos":1440,"ao_responder":[],"ao_expirar":[]}'::jsonb;
ALTER TABLE campanhas_whatsapp ADD COLUMN IF NOT EXISTS ativada_em timestamptz;
ALTER TABLE campanhas_whatsapp ADD CONSTRAINT campanhas_whatsapp_status_check
  CHECK (status IN ('rascunho','ativa','processando','concluida','parcial','falhou','pausada'));

CREATE TABLE IF NOT EXISTS campanha_whatsapp_execucoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id       uuid NOT NULL REFERENCES campanhas_whatsapp(id) ON DELETE CASCADE,
  contato_id        uuid NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
  estado            text NOT NULL DEFAULT 'na_fila'
                    CHECK (estado IN ('na_fila','enviando','aguardando_resposta','respondeu','expirou','falhou')),
  mensagem_id_meta  text,
  erro              text,
  enviado_em        timestamptz,
  prazo_resposta    timestamptz,
  respondeu_em      timestamptz,
  finalizado_em     timestamptz,
  conversao         boolean NOT NULL DEFAULT false,
  data_criacao      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, contato_id)
);

CREATE INDEX IF NOT EXISTS ix_campanha_wpp_exec_estado_prazo
  ON campanha_whatsapp_execucoes (estado, prazo_resposta);
CREATE INDEX IF NOT EXISTS ix_campanha_wpp_exec_contato
  ON campanha_whatsapp_execucoes (contato_id, estado);

CREATE TABLE IF NOT EXISTS campanha_whatsapp_eventos (
  id            bigserial PRIMARY KEY,
  campanha_id   uuid NOT NULL REFERENCES campanhas_whatsapp(id) ON DELETE CASCADE,
  execucao_id   uuid REFERENCES campanha_whatsapp_execucoes(id) ON DELETE CASCADE,
  tipo          text NOT NULL,
  detalhe       jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_criacao  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_campanha_wpp_eventos_campanha
  ON campanha_whatsapp_eventos (campanha_id, data_criacao DESC);
