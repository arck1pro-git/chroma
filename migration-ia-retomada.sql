-- ============================================================================
-- Migration: a IA retoma a conversa quando o contato não responde.
-- Idempotente. Roda DEPOIS de migration-ias.sql (precisa da tabela ias).
--
-- PEDIDO (2026-10-06): "se o contato não responder uma pergunta, posso
-- determinar que horas voltar a entrar em contato".
--
-- Decisões dele (2026-10-06):
--   · quando: um TEMPO de silêncio, mas só dentro de uma JANELA de horário;
--     caiu fora dela, sai na abertura da próxima;
--   · várias retomadas, cada uma com o seu tempo, configuradas na IA;
--   · quem escreve a retomada é a própria IA, lendo a conversa;
--   · sem resposta a nenhuma, avisa o responsável no WhatsApp.
--
-- Quem dispara é lib/ia/retomada.ts, chamado de 5 em 5 minutos pelo agendador
-- do n8n (/api/ia/retomar). Nenhuma tabela nova: o "em que ponto está" de cada
-- conversa sai das próprias mensagens.
-- ============================================================================

-- Os tempos de cada retomada, em MINUTOS e em ordem. Cada um conta da mensagem
-- anterior da IA: {180,1440,4320} = 3h depois da pergunta, 1 dia depois da
-- primeira retomada, 3 dias depois da segunda. Vazio = não retoma.
ALTER TABLE ias
  ADD COLUMN IF NOT EXISTS retomar_apos integer[] NOT NULL DEFAULT '{}';

-- A janela, em horas cheias de Brasília: retomada só sai entre `das` e `ate`
-- (9 e 19 = das 9h00 às 18h59), todos os dias.
ALTER TABLE ias
  ADD COLUMN IF NOT EXISTS retomar_das smallint NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS retomar_ate smallint NOT NULL DEFAULT 19;

ALTER TABLE ias DROP CONSTRAINT IF EXISTS ck_ias_retomar_janela;
ALTER TABLE ias ADD CONSTRAINT ck_ias_retomar_janela
  CHECK (retomar_das BETWEEN 0 AND 23 AND retomar_ate BETWEEN 1 AND 24 AND retomar_das < retomar_ate);

COMMENT ON COLUMN ias.retomar_apos IS
  'Minutos de silêncio antes de cada retomada, contados da mensagem anterior da IA. Vazio = não retoma (lib/ia/retomada.ts).';
COMMENT ON COLUMN ias.retomar_das IS 'Hora (Brasília) a partir da qual a retomada pode sair.';
COMMENT ON COLUMN ias.retomar_ate IS 'Hora (Brasília) até a qual a retomada pode sair (exclusiva).';

-- Qual retomada a mensagem foi (1ª, 2ª…). NULL em todas as outras. É o que diz
-- quantas já saíram desde a última mensagem do contato, e o que impede a mesma
-- retomada de sair duas vezes.
ALTER TABLE mensagens
  ADD COLUMN IF NOT EXISTS retomada smallint;

COMMENT ON COLUMN mensagens.retomada IS
  'Número da retomada da IA (1, 2…) quando a mensagem foi uma; NULL nas outras (lib/ia/retomada.ts).';
