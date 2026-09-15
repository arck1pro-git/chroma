-- ============================================================================
-- Migration: módulo Webhooks (captação de lead).
-- Revise e rode você mesmo (psql, painel do Supabase, etc.). Nada aqui apaga dado.
--
-- POR QUE: hoje lead só entra no Chroma por duas portas — digitado à mão
-- (app/contatos/actions.ts) ou nascido de uma mensagem de WhatsApp
-- (app/api/uazapi/webhook). Formulário de site, landing page e ferramenta de
-- anúncio não têm por onde entrar. Esta migration cria a terceira porta: uma
-- URL por origem de captação, com os campos que ela recebe declarados e o que
-- fazer com o lead que chegou.
--
-- DECISÕES TOMADAS (2026-09-11), porque cada uma está gravada na forma da
-- tabela e não dá para ler de volta a partir das colunas:
--
--  1. O contato é SEMPRE criado/reaproveitado; a oportunidade é opcional, por
--     interruptor na ação (webhook_acoes.criar_oportunidade). Um formulário de
--     newsletter não deveria abrir card no kanban; um de orçamento, sim.
--
--  2. Contato repetido é REAPROVEITADO e só preenche o que estava vazio. O
--     casamento é pelos últimos 8 dígitos do whatsapp (o nono dígito brasileiro
--     — ver lib/telefone.ts) ou pelo e-mail. Sobrescrever dado bom com o que
--     veio de um formulário mal preenchido é pior que ignorar.
--
--  3. O segredo vai na QUERYSTRING, não em header — mesma forma do webhook da
--     uazapi. Ver o aviso no fim deste arquivo: isso tem consequência.
--
--  4. O alvo de cada ação é COLUNA COM FK, não id solto dentro de um jsonb.
--     Apagar uma tag em Configurações tem que levar junto a ação que aponta
--     para ela; com id em jsonb, sobraria ação apontando para o nada e o erro
--     só apareceria no próximo lead, em produção.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A webhook: uma por origem de captação ("Site institucional", "Anúncio Meta").
-- ----------------------------------------------------------------------------
CREATE TABLE webhooks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  descricao     text,

  -- O que vai na URL: POST /api/webhooks/<slug>?secret=<segredo>
  -- Legível de propósito (nasce do nome + sufixo aleatório): quem for
  -- implementar do outro lado precisa reconhecer qual é qual num log.
  slug          text NOT NULL UNIQUE,

  -- Gerado pelo CRM (32 bytes hex), nunca digitado. Pode ser rotacionado sem
  -- trocar a URL — é por isso que são duas colunas e não uma só.
  segredo       text NOT NULL,

  -- Desligada, a URL responde 404 e NÃO grava recebimento. 404 e não 403 de
  -- propósito: para quem está sondando, uma webhook desligada e uma que nunca
  -- existiu têm que ser indistinguíveis.
  ativo         boolean NOT NULL DEFAULT true,

  data_criacao     timestamptz NOT NULL DEFAULT now(),
  data_atualizacao timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Os campos que a webhook aceita. É esta lista que vira o prompt de
-- implementação copiável — e é ela que decide para ONDE cada valor vai.
--
-- Campo que chega no payload e não está declarado aqui é IGNORADO. O contrário
-- (declarado e não enviado) só é erro quando obrigatorio = true.
-- ----------------------------------------------------------------------------
CREATE TABLE webhook_campos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id   uuid NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,

  -- chave: o nome exato da propriedade no JSON recebido ("email", "utm_source").
  -- rotulo: como aparece na tela do CRM.
  chave        text NOT NULL,
  rotulo       text NOT NULL,

  tipo         text NOT NULL DEFAULT 'texto'
                 CHECK (tipo IN ('texto', 'numero', 'data', 'booleano')),

  -- Faltando, o lead é RECUSADO (422) e o recebimento fica gravado com o motivo.
  -- Recusar é melhor que criar contato sem nome: o implementador do outro lado
  -- vê o erro na hora, em vez de descobrir a base suja semanas depois.
  obrigatorio  boolean NOT NULL DEFAULT false,

  -- Para onde o valor vai. As colunas fixas são as de contatos/oportunidades;
  -- '*.campo' cai no jsonb `campos` (migration-campos-personalizados.sql), que
  -- é exatamente o lugar já feito para UTM, resposta de formulário e afins.
  destino      text NOT NULL DEFAULT 'contato.campo'
                 CHECK (destino IN (
                   'contato.nome', 'contato.whatsapp', 'contato.email',
                   'contato.cidade', 'contato.estado', 'contato.pais',
                   'oportunidade.nome', 'oportunidade.valor',
                   'contato.campo', 'oportunidade.campo',
                   'ignorar')),

  -- A chave dentro do jsonb, quando destino = '*.campo'. Não precisa existir em
  -- campos_personalizados: o valor é gravado de qualquer jeito, e cadastrar o
  -- campo lá só decide se ele APARECE na ficha. Guardar o dado nunca depende de
  -- alguém ter lembrado de declarar o campo antes.
  destino_chave text,

  ordem        int NOT NULL DEFAULT 0,
  data_criacao timestamptz NOT NULL DEFAULT now(),

  -- Duas declarações da mesma chave fariam a segunda sobrescrever a primeira em
  -- silêncio, e qual vence dependeria da ordem da leitura.
  UNIQUE (webhook_id, chave),

  CHECK (destino NOT LIKE '%.campo' OR destino_chave IS NOT NULL)
);

CREATE INDEX ix_webhook_campos_webhook ON webhook_campos (webhook_id, ordem);

-- ----------------------------------------------------------------------------
-- O que fazer com o lead que chegou. Lista ordenada.
--
-- 'criar_lead' é a primeira e é OBRIGATÓRIA (ux_webhook_criar_lead garante
-- uma, e a tela não deixa removê-la): as outras três agem SOBRE o contato, e
-- sem ele não há a quem pendurar tag, segmento ou automação.
--
-- Os alvos são três colunas anuláveis em vez de um `alvo_id` genérico porque
-- só assim cada uma tem FK de verdade. O CHECK abaixo é o que impede a linha
-- incoerente — 'adicionar_tag' apontando para um segmento, por exemplo.
-- ----------------------------------------------------------------------------
CREATE TABLE webhook_acoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id   uuid NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,
  ordem        int NOT NULL DEFAULT 0,

  tipo         text NOT NULL
                 CHECK (tipo IN ('criar_lead', 'inscrever_fluxo',
                                 'adicionar_segmento', 'adicionar_tag')),

  -- ON DELETE CASCADE nos três: apagar a tag/segmento/fluxo apaga a ação que
  -- dependia dele. O lead continua entrando, só sem aquele passo — melhor que
  -- a webhook inteira passar a falhar por causa de uma tag apagada.
  fluxo_id     uuid REFERENCES fluxos (id)     ON DELETE CASCADE,
  segmento_id  uuid REFERENCES segmentos (id)  ON DELETE CASCADE,
  tag_id       uuid REFERENCES tags (id)       ON DELETE CASCADE,

  -- Só para 'criar_lead'. Desligado, a captação alimenta a base de contatos e
  -- não polui o kanban.
  criar_oportunidade boolean NOT NULL DEFAULT false,
  funil_id     uuid REFERENCES funis (id),
  etapa_id     uuid,

  data_criacao timestamptz NOT NULL DEFAULT now(),

  -- Cada tipo com o seu alvo, e SÓ o seu.
  CHECK (
    (tipo = 'criar_lead'
       AND fluxo_id IS NULL AND segmento_id IS NULL AND tag_id IS NULL)
    OR (tipo = 'inscrever_fluxo'
       AND fluxo_id IS NOT NULL AND segmento_id IS NULL AND tag_id IS NULL)
    OR (tipo = 'adicionar_segmento'
       AND segmento_id IS NOT NULL AND fluxo_id IS NULL AND tag_id IS NULL)
    OR (tipo = 'adicionar_tag'
       AND tag_id IS NOT NULL AND fluxo_id IS NULL AND segmento_id IS NULL)
  ),

  -- Oportunidade sem destino não existe: se vai criar, tem que dizer onde.
  CHECK (NOT criar_oportunidade OR (funil_id IS NOT NULL AND etapa_id IS NOT NULL)),

  -- A etapa tem que ser DO funil escolhido. Mesma FK composta que
  -- oportunidades usa em schema.sql — sem ela, trocar o funil na tela e
  -- esquecer a etapa cria card órfão. Com as duas colunas NULL (o caso de
  -- criar_oportunidade = false) o MATCH SIMPLE do Postgres não cobra a FK.
  FOREIGN KEY (etapa_id, funil_id) REFERENCES etapas (id, funil_id)
);

CREATE INDEX ix_webhook_acoes_webhook ON webhook_acoes (webhook_id, ordem);

-- Exatamente uma 'criar_lead' por webhook.
CREATE UNIQUE INDEX ux_webhook_criar_lead
  ON webhook_acoes (webhook_id) WHERE tipo = 'criar_lead';

-- A mesma tag/segmento/fluxo duas vezes na mesma webhook é sempre engano de
-- clique: a segunda execução não faria nada (os vínculos são ON CONFLICT DO
-- NOTHING) e a lista mostraria a linha repetida para sempre.
CREATE UNIQUE INDEX ux_webhook_acao_tag
  ON webhook_acoes (webhook_id, tag_id) WHERE tag_id IS NOT NULL;
CREATE UNIQUE INDEX ux_webhook_acao_segmento
  ON webhook_acoes (webhook_id, segmento_id) WHERE segmento_id IS NOT NULL;
CREATE UNIQUE INDEX ux_webhook_acao_fluxo
  ON webhook_acoes (webhook_id, fluxo_id) WHERE fluxo_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Recebimentos: o log. Existe para responder "mandei e não chegou, por quê?",
-- que é a única pergunta que se faz sobre uma webhook.
--
-- Guarda o payload CRU, inclusive o que foi ignorado — quando o campo do outro
-- lado se chama "e-mail" e a gente declarou "email", é só olhando o payload
-- inteiro que isso aparece.
--
-- ⚠ RETENÇÃO: o payload carrega nome, telefone e e-mail. Não há expurgo
-- automático aqui. Ver a nota no fim do arquivo.
-- ----------------------------------------------------------------------------
CREATE TABLE webhook_recebimentos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id   uuid NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,

  payload      jsonb NOT NULL,

  --  ok       → lead entrou, ações executadas
  --  recusado → faltou campo obrigatório / corpo inválido (nada foi gravado)
  --  erro     → quebrou no meio (ação falhou); o que deu certo antes ficou
  estado       text NOT NULL CHECK (estado IN ('ok', 'recusado', 'erro')),
  erro         text,

  -- SET NULL e não CASCADE: apagar o contato não pode apagar a prova de que
  -- ele chegou por aqui.
  contato_id      uuid REFERENCES contatos (id)      ON DELETE SET NULL,
  oportunidade_id uuid REFERENCES oportunidades (id) ON DELETE SET NULL,

  -- Texto pronto para a tela ("contato criado · tag Site · fluxo Boas-vindas"),
  -- mesma escolha de `historico.descricao` no schema.sql.
  resumo       text,

  data_criacao timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_webhook_recebimentos
  ON webhook_recebimentos (webhook_id, data_criacao DESC);

-- ============================================================================
-- DOIS FUROS CONHECIDOS, de propósito e anotados:
--
-- 1. SEGREDO NA URL. Foi a escolha (formulário simples não configura header),
--    mas o segredo aparece em log de proxy, em Referer e no histórico de quem
--    chamar do navegador. Na prática: NÃO cole essa URL em JavaScript de
--    página pública — quem descobrir manda lead falso e, com a ação de
--    automação ligada, dispara WhatsApp pela arckwpp, que é compartilhada com
--    o SprintHub. Chame de um backend, do n8n ou do Zapier. Trocar para header
--    depois é trocar o `secret` da querystring por um header na rota e
--    regravar o prompt — o schema não muda.
--
-- 2. SEM RETENÇÃO NEM RATE LIMIT. webhook_recebimentos cresce para sempre e
--    guarda PII. Quando incomodar, um expurgo mensal resolve:
--       DELETE FROM webhook_recebimentos WHERE data_criacao < now() - interval '90 days';
--    E não há teto de chamadas por minuto: uma webhook vazada pode ser
--    inundada. O freio, quando precisar, é o mesmo lugar do rate limit que foi
--    removido de lib/automacoes/servico.ts.
-- ============================================================================

-- ============================================================================
-- ADENDO: de qual webhook veio a inscrição no fluxo.
--
-- `fluxo_execucoes.origem` já aceita 'api', mas 'api' não diz QUAL — é a mesma
-- crítica que migration-revisao-modulos.sql §3 fez a 'lista' quando criou
-- origem_segmento_id e origem_etapa_id. Sem esta coluna, "por que este contato
-- recebeu esta mensagem?" volta a ficar sem resposta quando a origem for uma
-- captação.
-- ============================================================================

ALTER TABLE fluxo_execucoes
  ADD COLUMN IF NOT EXISTS origem_webhook_id uuid
    REFERENCES webhooks (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_execucoes_origem_webhook
  ON fluxo_execucoes (origem_webhook_id)
  WHERE origem_webhook_id IS NOT NULL;

-- ============================================================================
-- ADENDO 2: índice para o casamento de contato por e-mail.
--
-- A deduplicação da captação (lib/webhooks-recepcao.ts) tenta o whatsapp e,
-- não achando, o e-mail:
--   WHERE lower(email) = lower($1)
--
-- O caminho do whatsapp JÁ tem índice — o trigram de
-- migration-indice-contato-whatsapp.sql. O do e-mail não tinha nenhum, porque
-- até agora ninguém buscava contato por e-mail: é uma consulta que ESTA
-- migration está introduzindo. Sem o índice, todo lead que chega sem whatsapp
-- varre as ~17,8 mil linhas de `contatos`.
--
-- Funcional em lower(email) porque é assim que a consulta compara — um índice
-- em `email` cru não seria usado. Parcial porque contato sem e-mail é a maioria
-- e não precisa ocupar o índice.
-- ============================================================================

CREATE INDEX IF NOT EXISTS ix_contatos_email_lower
  ON contatos (lower(email))
  WHERE email IS NOT NULL;
