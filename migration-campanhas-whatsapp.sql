-- Histórico das campanhas enviadas pela API oficial do WhatsApp.
CREATE TABLE IF NOT EXISTS campanhas_whatsapp (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome              text NOT NULL,
  segmento_id       uuid REFERENCES segmentos (id) ON DELETE SET NULL,
  segmento_nome     text NOT NULL,
  template_nome     text NOT NULL,
  template_idioma   text NOT NULL DEFAULT 'pt_BR',
  waba_id            text NOT NULL,
  telefone_id        text NOT NULL,
  telefone_exibicao  text NOT NULL,
  status             text NOT NULL DEFAULT 'processando'
                     CHECK (status IN ('processando', 'concluida', 'parcial', 'falhou')),
  total              integer NOT NULL DEFAULT 0,
  enviados           integer NOT NULL DEFAULT 0,
  falhas              jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_por         uuid REFERENCES usuarios (id) ON DELETE SET NULL,
  data_criacao       timestamptz NOT NULL DEFAULT now(),
  data_conclusao     timestamptz
);

CREATE INDEX IF NOT EXISTS ix_campanhas_whatsapp_data
  ON campanhas_whatsapp (data_criacao DESC);
