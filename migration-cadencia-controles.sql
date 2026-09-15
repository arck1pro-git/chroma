-- Dois controles da cadência: de onde saiu cada mensagem, e quem a cadência
-- pega ao ser publicada.
--
-- Idempotente. Depende de schema.sql e schema-automacoes.sql.

-- ── 1. Como a mensagem saiu ─────────────────────────────────────────────────
--
-- `origem` já dizia o LADO ('contato' recebida, 'agente' enviada). O que não
-- existia era a mão: enviada pela automação, digitada no CRM, ou mandada do
-- celular do atendente. As três chegam hoje como 'agente' com autor_id nulo nas
-- duas primeiras — indistinguíveis.
--
-- É disso que a guarda de envio precisa. Antes de mandar a próxima mensagem da
-- cadência, o motor pergunta se ALGUÉM DE CARNE falou com o lead nesse meio
-- tempo; se falou, a sequência cala a boca. Sem esta coluna a pergunta não tem
-- resposta: a própria mensagem da automação contaria como "alguém falou".
--
--   automacao → a cadência mandou (nó de registro do workflow)
--   crm       → alguém digitou no chat do Chroma (tem autor_id)
--   aparelho  → saiu do celular, capturada pelo webhook da uazapi (fromMe)
--
-- NULL em mensagem recebida, e nas antigas que não dá para classificar.
ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS enviada_por TEXT;

ALTER TABLE mensagens DROP CONSTRAINT IF EXISTS mensagens_enviada_por_check;
ALTER TABLE mensagens ADD CONSTRAINT mensagens_enviada_por_check
  CHECK (enviada_por IS NULL
         OR enviada_por IN ('automacao', 'crm', 'aparelho'));

-- Backfill do que dá para afirmar: mensagem enviada COM autor é gente digitando
-- no CRM. As sem autor ficam nulas — podem ter vindo da automação ou do
-- celular, e chutar encheria a guarda de falso positivo justamente no histórico
-- antigo.
UPDATE mensagens SET enviada_por = 'crm'
WHERE origem = 'agente' AND autor_id IS NOT NULL AND enviada_por IS NULL;

-- A guarda pergunta "teve mensagem humana nesta conversa depois de tal
-- instante?" a cada envio da cadência. Sem índice é varredura por mensagem.
CREATE INDEX IF NOT EXISTS ix_mensagens_humanas
  ON mensagens (atendimento_id, data_criacao)
  WHERE enviada_por IN ('crm', 'aparelho');

-- ── 2. Quem a cadência pega ao publicar ─────────────────────────────────────
--
-- true  → publicar inscreve as oportunidades ABERTAS que já estão na etapa,
--         e as que entrarem depois entram sozinhas. "As atuais e as próximas."
-- false → publicar não inscreve ninguém; só quem ENTRAR na etapa daqui para a
--         frente. "Só as próximas."
--
-- O padrão é `true` porque é o que a tela já fazia antes de existir a opção:
-- uma cadência publicada hoje continua pegando quem está lá.
--
-- ⚠ A entrada automática (mover um card para a etapa, ou criar um ali) vale nos
-- DOIS modos — é o que dá sentido a "as próximas". Antes disto, card que
-- chegava depois só entrava no Publicar seguinte.
ALTER TABLE fluxos ADD COLUMN IF NOT EXISTS inscrever_atuais BOOLEAN NOT NULL
  DEFAULT true;
