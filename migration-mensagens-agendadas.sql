-- ============================================================================
-- Migration: mensagens agendadas nos grupos do WhatsApp (2026-10-29).
-- Roda ANTES do deploy. Só cria: nada existente muda.
--
-- Pedido dele: "dentro de um grupo tenha um botão de mensagens agendadas. ali
-- defino dia e hora que uma mensagem vai ser mandada nesse grupo". Decisões
-- dele no mesmo dia: tabela própria, texto ou arquivo da biblioteca, e o
-- disparo por um agendador do n8n a cada minuto (lib/mensagens-agendadas.ts).
-- ============================================================================

CREATE TABLE IF NOT EXISTS mensagens_agendadas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A conversa onde a mensagem sai (hoje, só conversa de grupo).
  atendimento_id uuid NOT NULL REFERENCES atendimentos (id) ON DELETE CASCADE,
  -- O texto; com arquivo, é a legenda dele (até 1.024 caracteres no WhatsApp).
  texto         text NOT NULL DEFAULT '',
  -- O arquivo da biblioteca de Documentos, opcional. Apagado da biblioteca, a
  -- agendada perde o arquivo e o envio dela vira erro (a conferência é na hora).
  documento_id  uuid REFERENCES documentos (id) ON DELETE SET NULL,
  enviar_em     timestamptz NOT NULL,
  -- agendada → enviando (reservada pela rodada, para duas rodadas não mandarem
  -- a mesma) → enviada ou erro. cancelada: alguém tirou antes da hora.
  estado        text NOT NULL DEFAULT 'agendada'
                  CHECK (estado IN ('agendada', 'enviando', 'enviada', 'erro', 'cancelada')),
  criado_por    uuid REFERENCES usuarios (id) ON DELETE SET NULL,
  -- A linha em mensagens que o envio gravou (para achar na conversa).
  mensagem_id   uuid REFERENCES mensagens (id) ON DELETE SET NULL,
  erro          text,
  data_criacao  timestamptz NOT NULL DEFAULT now(),
  -- Quando a rodada pegou a mensagem para enviar. Reservada há mais de 10 min
  -- sem terminar vira erro, e NÃO é reenviada: pode ter saído.
  enviada_em    timestamptz
  -- Sem CHECK de "texto ou arquivo": com ele, apagar da biblioteca um arquivo
  -- usado numa agendada sem texto falharia (o SET NULL violaria a trava). A
  -- regra é conferida ao agendar e, de novo, na hora do envio.
);

-- A rodada de cada minuto: só as que ainda vão sair, pela hora.
CREATE INDEX IF NOT EXISTS ix_mensagens_agendadas_fila
  ON mensagens_agendadas (enviar_em) WHERE estado = 'agendada';
-- A lista dentro da conversa.
CREATE INDEX IF NOT EXISTS ix_mensagens_agendadas_conversa
  ON mensagens_agendadas (atendimento_id, enviar_em);
