-- Campanhas de WhatsApp em BLOCOS (2026-10-27, modelagem escolhida por ele:
-- colunas nas execuções). O fluxo mora em campanhas_whatsapp.definicao
-- (formato em lib/campanhas-fluxo.ts); aqui fica onde cada contato está nele e
-- qual saída a resposta dele tomou. O histórico de cada passo vai em
-- campanha_whatsapp_eventos (tipo 'bloco'), que já existe.
--
-- ORDEM: rodar ANTES do deploy do código das campanhas em blocos. O código
-- novo lê e grava bloco_atual, resposta_saida e resposta_id e os estados
-- 'em_andamento' e 'concluida'; sem a migration, o GET da lista diz qual falta
-- (app/api/meta/whatsapp/campanhas/route.ts) e o motor falha. O código de antes
-- convive com ela: as colunas são novas e os estados antigos continuam no CHECK.
-- Idempotente, numa transação: pode rodar de novo.
--
-- Estados novos:
--   em_andamento  parado num "Esperar", ou com a saída já escolhida esperando o
--                 motor continuar (prazo_resposta = quando retoma)
--   concluida     chegou ao fim do fluxo
-- 'respondeu' e 'expirou' continuam valendo para as execuções do formato antigo.

BEGIN;

ALTER TABLE campanha_whatsapp_execucoes
  ADD COLUMN IF NOT EXISTS bloco_atual    text,
  ADD COLUMN IF NOT EXISTS resposta_saida text,
  ADD COLUMN IF NOT EXISTS resposta_id    text;

COMMENT ON COLUMN campanha_whatsapp_execucoes.bloco_atual IS
  'Id do bloco do fluxo em que o contato está. Nas execuções do formato antigo fica null, e o motor as põe pelo estado (ID_ENVIO_ANTIGO / ID_AGUARDAR_ANTIGO), nunca no início, que reenviaria o template.';
COMMENT ON COLUMN campanha_whatsapp_execucoes.resposta_saida IS
  'A saída que a última resposta tomou (botao:<texto>, palavra:<i>, outra, sem_resposta, descadastro). O texto que a pessoa escreveu fica só na conversa do Chat.';
COMMENT ON COLUMN campanha_whatsapp_execucoes.resposta_id IS
  'O id (wamid) da mensagem consumida: a mesma resposta nunca anda o fluxo duas vezes (reentrega da Meta). Único quando preenchido.';

-- O CHECK de estado foi criado sem nome (na coluna): troca pelo que existir.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'campanha_whatsapp_execucoes'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE campanha_whatsapp_execucoes DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE campanha_whatsapp_execucoes
  ADD CONSTRAINT campanha_whatsapp_execucoes_estado_check
  CHECK (estado IN ('na_fila','enviando','aguardando_resposta','em_andamento',
                    'respondeu','expirou','concluida','falhou'));

-- Os eventos de UMA execução por tipo: o motor pergunta a cada bloco se o envio
-- já foi tentado ('enviando') e se o bloco já rodou ('bloco') — tentativaAnterior,
-- jaComecou, o último template antes do Aguardar e a resposta adiantada. Sem o
-- índice, cada pergunta varre os eventos da campanha inteira.
CREATE INDEX IF NOT EXISTS ix_campanha_whatsapp_eventos_execucao_tipo
  ON campanha_whatsapp_eventos (execucao_id, tipo);

-- A mesma mensagem nunca anda dois fluxos: o motor já confere com NOT EXISTS,
-- e o índice único segura a corrida de duas instruções ao mesmo tempo (webhook
-- e rodada; a segunda falha com 23505, que o motor trata como "não saiu").
-- Parcial: a maioria das execuções não tem resposta. Num banco com o código de
-- blocos já rodando, conferir antes se não há resposta_id repetida:
--   SELECT resposta_id, count(*) FROM campanha_whatsapp_execucoes
--    WHERE resposta_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_campanha_whatsapp_execucoes_resposta
  ON campanha_whatsapp_execucoes (resposta_id) WHERE resposta_id IS NOT NULL;

COMMIT;
