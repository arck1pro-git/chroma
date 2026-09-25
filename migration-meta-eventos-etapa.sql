-- ============================================================================
-- Evento da Meta (Conversions API) disparado quando a oportunidade ENTRA numa
-- etapa. A etapa diz qual evento; o envio sai uma vez por oportunidade.
--
-- Aplicado no DEV em 2026-09-25. Em PROD: ANTES do deploy do código que usa.
--   · migration sem o código novo: inofensivo — a coluna é nullable e a tabela
--     fica vazia; o código em produção não enxerga nenhuma das duas.
--   · código novo sem o migration: QUEBRA Configurações → Funis (carregarFunis
--     seleciona etapas.meta_evento), e o disparo do evento falha em silêncio.
-- Pode rodar mais de uma vez: tudo é IF NOT EXISTS, e o GRANT se repete sem
-- efeito. Não altera nenhuma linha existente (as etapas ficam com NULL = não
-- enviam nada até alguém escolher um evento).
-- ============================================================================

-- Nome do evento que a etapa envia. NULL = não envia. Padrão da Meta (Lead,
-- Schedule, Purchase…) ou personalizado; o formato é conferido na action de
-- Configurações, não aqui, para a mensagem de erro sair em português.
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS meta_evento text;

-- Um registro por evento tentado. Serve a três coisas:
--   · UNICIDADE: UNIQUE (oportunidade_id, evento) é o que impede o reenvio
--     quando o card sai da etapa e volta.
--   · AUDITORIA: o que foi, quando, e o que a Meta respondeu.
--   · NOVA TENTATIVA: status 'erro' pode ser retomado; 'enviado' nunca.
--
-- 'pendente' existe para o envio ser reservado ANTES de ir à Meta. Sem ele,
-- dois arrastes simultâneos (ou o reenvio de um webhook) passariam os dois pela
-- conferência "ainda não foi" e mandariam o evento duas vezes.
--
-- 'sem_pixel': o lead entrou na etapa, mas não deu para saber o pixel dele
-- (nem pixel_id no lead, nem conjunto de anúncio que diga). Nada é enviado — o
-- pixel é do LEAD, e mandar para um pixel "de palpite" poluiria a otimização de
-- outra campanha. O motivo fica em `erro`. Como 'erro', pode ser retomado se o
-- card entrar de novo depois de o pixel aparecer.
CREATE TABLE IF NOT EXISTS meta_eventos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oportunidade_id uuid NOT NULL REFERENCES oportunidades (id) ON DELETE CASCADE,
  -- SET NULL: apagar a etapa não apaga a prova de que o evento foi enviado.
  etapa_id        uuid REFERENCES etapas (id) ON DELETE SET NULL,
  evento          text NOT NULL,
  -- Vai para a Meta como event_id: é o que ela usa para descartar duplicata
  -- se o mesmo evento chegar também pelo pixel do navegador.
  event_id        uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status          text NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente', 'enviado', 'erro', 'sem_pixel')),
  -- Para ONDE foi: o pixel muda de lead para lead, então "para qual pixel este
  -- evento foi?" deixa de ser óbvio. E de onde ele saiu:
  --   'lead'     → pixel_id que a landing page mandou no formulário
  --   'conjunto' → promoted_object.pixel_id do conjunto do anúncio (adset_id)
  pixel_id        text,
  pixel_origem    text CHECK (pixel_origem IN ('lead', 'conjunto')),
  erro            text,
  resposta        jsonb,
  data_criacao    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oportunidade_id, evento)
);

CREATE INDEX IF NOT EXISTS ix_meta_eventos_etapa ON meta_eventos (etapa_id);

-- A IA lê todas as tabelas do CRM (mesmo grant das vizinhas).
GRANT SELECT ON meta_eventos TO chroma_ia;
