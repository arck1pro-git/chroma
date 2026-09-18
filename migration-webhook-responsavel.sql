-- QUEM RECEBE O LEAD que a captação cria.
--
-- Até aqui a oportunidade nascia sem responsável, e ficar sem dono deixou de
-- ser detalhe: com o Dashboard no escopo 'proprio' (lib/auth/modulos.ts), é o
-- responsável que diz QUEM ENXERGA a oportunidade. Lead sem dono é lead que o
-- comercial não vê.
--
-- São duas formas, e a segunda é o que o time chama de rodízio:
--
--   · UM responsável fixo  → `responsavel_id` preenchido, `alternado` nulo;
--   · DOIS em alternância  → os dois preenchidos, e cada lead vai para quem NÃO
--     recebeu o anterior.
--
-- `ultimo_responsavel_id` é o estado do rodízio. Fica na própria linha da ação,
-- e não numa tabela à parte, porque ele só existe para responder "de quem foi a
-- vez passada?" — uma pergunta por captação, respondida no mesmo UPDATE que
-- grava a resposta nova (ver lib/webhooks-recepcao.ts).
--
-- SEM FK para `usuarios`, seguindo o que já existe em `oportunidades`: aquela
-- coluna também é uuid solto. Conta apagada deixa o id órfão aqui, e a leitura
-- trata isso como "sem responsável" em vez de estourar — mesmo desenho do resto
-- do app.

ALTER TABLE webhook_acoes
  ADD COLUMN IF NOT EXISTS responsavel_id        uuid,
  ADD COLUMN IF NOT EXISTS responsavel_alternado_id uuid,
  ADD COLUMN IF NOT EXISTS ultimo_responsavel_id uuid;

-- Alternar exige alguém com quem alternar: sem o primeiro, o segundo é lixo que
-- nenhuma tela sabe ler.
ALTER TABLE webhook_acoes
  DROP CONSTRAINT IF EXISTS ck_webhook_acao_alternancia;
ALTER TABLE webhook_acoes
  ADD CONSTRAINT ck_webhook_acao_alternancia
  CHECK (responsavel_alternado_id IS NULL OR responsavel_id IS NOT NULL);

-- Os três campos são da ação 'criar_lead' — é ela que cria a oportunidade. Nas
-- outras (tag, segmento, fluxo) não há o que atribuir.
ALTER TABLE webhook_acoes
  DROP CONSTRAINT IF EXISTS ck_webhook_acao_responsavel_so_no_lead;
ALTER TABLE webhook_acoes
  ADD CONSTRAINT ck_webhook_acao_responsavel_so_no_lead
  CHECK (tipo = 'criar_lead' OR responsavel_id IS NULL);

COMMENT ON COLUMN webhook_acoes.responsavel_id IS
  'Dono do lead criado por esta captação. Com responsavel_alternado_id, é o primeiro do rodízio.';
COMMENT ON COLUMN webhook_acoes.responsavel_alternado_id IS
  'Segundo do rodízio. Nulo = sem alternância, todo lead vai para responsavel_id.';
COMMENT ON COLUMN webhook_acoes.ultimo_responsavel_id IS
  'Quem recebeu o lead anterior. É o estado do rodízio, escrito no mesmo UPDATE que escolhe o próximo.';
