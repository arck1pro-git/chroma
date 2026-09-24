-- Campanhas contínuas: vários segmentos e workflow executor próprio no n8n.
CREATE TABLE IF NOT EXISTS campanha_whatsapp_segmentos (
  campanha_id uuid NOT NULL REFERENCES campanhas_whatsapp(id) ON DELETE CASCADE,
  segmento_id uuid NOT NULL REFERENCES segmentos(id) ON DELETE CASCADE,
  PRIMARY KEY (campanha_id, segmento_id)
);

INSERT INTO campanha_whatsapp_segmentos (campanha_id, segmento_id)
SELECT id, segmento_id FROM campanhas_whatsapp WHERE segmento_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE campanhas_whatsapp
  ADD COLUMN IF NOT EXISTS motor_workflow_id text;

-- Toda entrada futura num segmento de campanha ativa vira uma inscrição. A
-- restrição UNIQUE(campanha_id, contato_id) mantém a operação idempotente caso
-- o mesmo contato pertença a mais de um dos segmentos escolhidos.
CREATE OR REPLACE FUNCTION inscrever_contato_em_campanhas_whatsapp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO campanha_whatsapp_execucoes (campanha_id, contato_id)
  SELECT cs.campanha_id, NEW.contato_id
    FROM campanha_whatsapp_segmentos cs
    JOIN campanhas_whatsapp c ON c.id = cs.campanha_id
    JOIN contatos contato ON contato.id = NEW.contato_id
   WHERE cs.segmento_id = NEW.segmento_id
     AND c.status = 'ativa'
     AND contato.whatsapp IS NOT NULL
  ON CONFLICT (campanha_id, contato_id) DO NOTHING;

  UPDATE campanhas_whatsapp c SET total = (
    SELECT count(*)::int FROM campanha_whatsapp_execucoes e
     WHERE e.campanha_id = c.id
  ) WHERE c.id IN (
    SELECT campanha_id FROM campanha_whatsapp_segmentos
     WHERE segmento_id = NEW.segmento_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contato_segmento_campanha_whatsapp ON contato_segmentos;
CREATE TRIGGER trg_contato_segmento_campanha_whatsapp
AFTER INSERT ON contato_segmentos
FOR EACH ROW EXECUTE FUNCTION inscrever_contato_em_campanhas_whatsapp();

-- Também cobre importações que primeiro criam o contato/segmento e só depois
-- completam o WhatsApp.
CREATE OR REPLACE FUNCTION inscrever_contato_atualizado_em_campanhas_whatsapp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.whatsapp IS NULL OR NEW.whatsapp IS NOT DISTINCT FROM OLD.whatsapp THEN
    RETURN NEW;
  END IF;
  INSERT INTO campanha_whatsapp_execucoes (campanha_id, contato_id)
  SELECT DISTINCT cws.campanha_id, NEW.id
    FROM contato_segmentos cs
    JOIN campanha_whatsapp_segmentos cws ON cws.segmento_id=cs.segmento_id
    JOIN campanhas_whatsapp campanha ON campanha.id=cws.campanha_id
   WHERE cs.contato_id=NEW.id AND campanha.status='ativa'
  ON CONFLICT (campanha_id, contato_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contato_whatsapp_campanha ON contatos;
CREATE TRIGGER trg_contato_whatsapp_campanha
AFTER UPDATE OF whatsapp ON contatos
FOR EACH ROW EXECUTE FUNCTION inscrever_contato_atualizado_em_campanhas_whatsapp();
