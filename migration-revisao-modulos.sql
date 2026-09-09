-- ============================================================================
-- Migration: os furos de schema que a revisão dos seis módulos encontrou.
-- Revise e rode você mesmo (psql, painel do Neon/Supabase). NADA aqui apaga
-- dado: só ADD COLUMN, CREATE TABLE, troca de CHECK por versão mais larga e
-- recriação de índice parcial com predicado maior.
--
-- Cada bloco fecha UMA necessidade que estava no pedido e não tinha onde morar
-- no banco. O que a revisão achou e NÃO está aqui é o que falta de tela e de
-- serviço, não de schema — está listado no rodapé do arquivo.
--
-- ⚠ ONDE RODAR: a DATABASE_URL do .env aponta para o NEON
-- (ep-noisy-pond-…neon.tech), não para o Supabase de NEXT_PUBLIC_SUPABASE_URL.
-- É no Neon que o app lê e escreve hoje, então é lá que isto vale. Se a base
-- voltar para o Supabase, rode este arquivo lá também.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1. ATENDIMENTO: mídia (imagem, áudio, documento)
-- ════════════════════════════════════════════════════════════════════════════
-- PEDIDO: "devemos poder ver e ter acesso a imagens, audios e documentos
-- enviados, sendo eles salvos no sistema para visualizarmos".
--
-- HOJE: `mensagens` só tem `texto text NOT NULL`. O webhook desiste explícito
-- do que não é texto (app/api/uazapi/webhook/route.ts: "Só trata mensagem de
-- texto por enquanto — mídia vira outro passo"). Ou seja: áudio e foto de
-- cliente chegam e são descartados — o oposto de "auditável".
--
-- MODELO: a mensagem continua sendo UMA linha. Mídia não vira tabela separada
-- porque não existe mensagem com duas mídias no WhatsApp, e uma tabela filha
-- só somaria JOIN no caminho mais quente do app (a lista de mensagens já é o
-- SELECT mais numeroso de app/chat/dados.ts).
--
-- `texto` CONTINUA NOT NULL, agora com DEFAULT ''. Deixá-lo nulo obrigaria a
-- tratar null em toda leitura já escrita; string vazia é a legenda ausente de
-- uma foto, e o front não muda de contrato. A legenda da imagem vai em `texto`,
-- que é onde ela já estaria se fosse texto puro.
ALTER TABLE mensagens
  ALTER COLUMN texto SET DEFAULT '';

ALTER TABLE mensagens
  -- Que espécie de mensagem é. 'texto' de default mantém as linhas que já
  -- existem corretas sem UPDATE nenhum.
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'texto'
    CHECK (tipo IN ('texto','imagem','audio','video','documento',
                    'sticker','localizacao','contato','desconhecido')),

  -- Caminho DEFINITIVO do arquivo depois de baixado para o nosso storage
  -- (bucket do Supabase Storage / S3). É o que faz "salvo no sistema" ser
  -- verdade: a URL da uazapi expira, e link morto não é registro.
  ADD COLUMN IF NOT EXISTS midia_caminho text,

  -- A URL como chegou no webhook, ANTES de baixarmos. Guardada porque é o que
  -- permite tentar de novo quando o download falha — sem ela, uma falha de rede
  -- perde a mídia para sempre.
  ADD COLUMN IF NOT EXISTS midia_url_origem text,

  ADD COLUMN IF NOT EXISTS midia_mime text,
  ADD COLUMN IF NOT EXISTS midia_nome text,        -- nome do arquivo, em documento
  ADD COLUMN IF NOT EXISTS midia_tamanho bigint,   -- bytes
  ADD COLUMN IF NOT EXISTS midia_duracao integer,  -- segundos, áudio/vídeo

  -- A fila de download, no próprio registro. 'ausente' = mensagem de texto.
  -- 'pendente' = chegou, ainda não baixamos. 'erro' = tentamos e falhou, com o
  -- motivo em midia_erro — é o que separa "não tinha mídia" de "perdemos a
  -- mídia", distinção que um caminho nulo sozinho não faz.
  ADD COLUMN IF NOT EXISTS midia_estado text NOT NULL DEFAULT 'ausente'
    CHECK (midia_estado IN ('ausente','pendente','salva','erro')),
  ADD COLUMN IF NOT EXISTS midia_erro text;

-- Coerência: mensagem que não é de texto tem que ter mídia de algum jeito
-- (baixada, ou ao menos a origem para tentar). NOT VALID: vale para tudo que
-- entrar de agora em diante sem varrer a tabela — e as linhas de hoje são
-- todas 'texto', então não há o que validar.
ALTER TABLE mensagens DROP CONSTRAINT IF EXISTS ck_mensagens_midia;
ALTER TABLE mensagens
  ADD CONSTRAINT ck_mensagens_midia CHECK (
    tipo = 'texto'
    OR midia_caminho IS NOT NULL
    OR midia_url_origem IS NOT NULL
    OR midia_estado = 'erro'
  ) NOT VALID;

-- A fila de download: "o que chegou e ainda não está no nosso storage".
-- Parcial porque a esmagadora maioria das linhas é texto e nunca entra aqui.
CREATE INDEX IF NOT EXISTS ix_mensagens_midia_pendente
  ON mensagens (data_criacao)
  WHERE midia_estado IN ('pendente','erro');


-- ── 1b. De qual conexão veio o atendimento ──────────────────────────────────
-- PEDIDO: "mensagens dos clientes enviadas aos números do wpp web e wpp api".
-- São dois canais com regras diferentes (a oficial tem janela de 24h e exige
-- template fora dela; a web não tem). `atendimentos.canal` hoje só distingue
-- whatsapp / instagram / email — não dá para saber por qual das duas a conversa
-- entrou, e é essa distinção que decide se responder é sequer permitido.
ALTER TABLE atendimentos DROP CONSTRAINT IF EXISTS atendimentos_canal_check;
ALTER TABLE atendimentos
  ADD CONSTRAINT atendimentos_canal_check
    CHECK (canal IN ('whatsapp','whatsapp_oficial','instagram','email'));

-- Idem em instancias_uazapi: qual conexão aquele número é. 'web' de default
-- porque é o que as instâncias cadastradas hoje são (uazapi não-oficial).
ALTER TABLE instancias_uazapi
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'web'
    CHECK (tipo IN ('web','oficial'));


-- ════════════════════════════════════════════════════════════════════════════
-- 2. FUNIL: pausar o lead numa automação, sem tirá-lo dela
-- ════════════════════════════════════════════════════════════════════════════
-- PEDIDO: "deve ser possível ver na oportunidade em quais automações o lead
-- está e poder pausar por ali ao clicar em um botão".
--
-- HOJE existem duas pausas, e nenhuma é essa:
--   · fluxos.estado = 'pausado'  → para o fluxo INTEIRO, para todo mundo.
--   · cancelarNaCadencia()       → tira o lead de vez ('cancelada'), sem volta.
-- Falta o meio-termo: ESTE lead para, os outros seguem, e dá para retomar.
--
-- 'pausada' entra no enum de fluxo_execucoes.estado. O executor já barra de
-- graça: lib/automacoes/executor.ts recusa qualquer bloco cuja execução não
-- esteja em ('pendente','rodando','esperando') — 'pausada' cai fora dessa lista
-- e nenhuma mensagem sai. O que muda de comportamento é só o índice de
-- reentrada, tratado logo abaixo.
ALTER TABLE fluxo_execucoes DROP CONSTRAINT IF EXISTS fluxo_execucoes_estado_check;
ALTER TABLE fluxo_execucoes
  ADD CONSTRAINT fluxo_execucoes_estado_check
    CHECK (estado IN ('pendente','rodando','esperando','pausada',
                      'sucesso','erro','cancelada','perdida'));

ALTER TABLE fluxo_execucoes
  ADD COLUMN IF NOT EXISTS pausada_em    timestamptz,
  ADD COLUMN IF NOT EXISTS pausada_por   uuid,
  ADD COLUMN IF NOT EXISTS pausa_motivo  text,
  -- Onde a execução estava quando pausou. Sem isto, retomar não sabe de onde
  -- continuar e recomeçaria do início — reenviando mensagem que o lead já leu.
  ADD COLUMN IF NOT EXISTS pausada_no_no text;

-- A espera pendurada na execução pausada também congela. Sem isso o motor
-- acorda no dia marcado, o executor recusa o bloco e a espera fica 'ativa' para
-- sempre, aparecendo na tela como "retoma dia X" de algo que não retoma.
ALTER TABLE fluxo_esperas DROP CONSTRAINT IF EXISTS fluxo_esperas_estado_check;
ALTER TABLE fluxo_esperas
  ADD CONSTRAINT fluxo_esperas_estado_check
    CHECK (estado IN ('ativa','pausada','retomada','expirada','cancelada'));

-- ── Os dois índices parciais que precisam enxergar 'pausada' ────────────────
-- ux_execucao_ativa_por_entidade é a regra de reentrada. Se 'pausada' ficar de
-- fora do predicado, o lead pausado deixa de "ocupar vaga" e o próximo Disparar
-- o INSCREVE DE NOVO — duas execuções vivas do mesmo lead no mesmo fluxo, que é
-- exatamente a duplicata de WhatsApp que o índice existe para impedir.
DROP INDEX IF EXISTS ux_execucao_ativa_por_entidade;
CREATE UNIQUE INDEX ux_execucao_ativa_por_entidade
  ON fluxo_execucoes (fluxo_id, entidade_tipo, entidade_id)
  WHERE estado IN ('pendente','rodando','esperando','pausada');

DROP INDEX IF EXISTS ix_execucoes_abertas;
CREATE INDEX ix_execucoes_abertas
  ON fluxo_execucoes (estado)
  WHERE estado IN ('pendente','rodando','esperando','pausada');

-- A consulta da ficha da oportunidade: "em quais automações ESTE lead está".
-- Hoje o único índice por entidade (ix_execucoes_entidade) não filtra por
-- estado, então a pergunta varre também tudo que já terminou.
CREATE INDEX IF NOT EXISTS ix_execucoes_vivas_da_entidade
  ON fluxo_execucoes (entidade_tipo, entidade_id)
  WHERE estado IN ('pendente','rodando','esperando','pausada');


-- ════════════════════════════════════════════════════════════════════════════
-- 3. AUTOMAÇÕES: disparar para um segmento
-- ════════════════════════════════════════════════════════════════════════════
-- PEDIDO: "devemos poder criar automações e disparar elas para um determinado
-- segmento".
--
-- HOJE só existe inscrição por ETAPA (inscreverEtapa, em
-- lib/automacoes/repositorio.ts). `origem` já aceita 'lista', mas 'lista' não
-- diz QUAL lista — e sem isso ninguém responde depois "por que este contato
-- recebeu esta mensagem?", que é a primeira pergunta quando um disparo em massa
-- sai errado.
ALTER TABLE fluxo_execucoes DROP CONSTRAINT IF EXISTS fluxo_execucoes_origem_check;
ALTER TABLE fluxo_execucoes
  ADD CONSTRAINT fluxo_execucoes_origem_check
    CHECK (origem IN ('manual','lista','segmento','etapa','fluxo','api'));

-- ON DELETE SET NULL, não CASCADE: apagar o segmento não pode apagar o registro
-- de que uma mensagem foi disparada para gente real. Perde-se o nome do
-- segmento, nunca a execução.
ALTER TABLE fluxo_execucoes
  ADD COLUMN IF NOT EXISTS origem_segmento_id uuid
    REFERENCES segmentos (id) ON DELETE SET NULL,
  -- Idem para o disparo por etapa, que hoje grava 'lista' e perde de qual.
  ADD COLUMN IF NOT EXISTS origem_etapa_id uuid
    REFERENCES etapas (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_execucoes_origem_segmento
  ON fluxo_execucoes (origem_segmento_id)
  WHERE origem_segmento_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. CONTEXTO: os blocos de prompt do projeto
-- ════════════════════════════════════════════════════════════════════════════
-- PEDIDO: "vamos utilizar os contextos como blocos de prompt que setamos no
-- projeto para auditar coisas com ia, ou gerar conteudos".
--
-- HOJE não existe nada: os prompts do sistema são constantes hard-coded em
-- app/api/ia/route.ts e lib/ia/automacoes.ts. Não há como um usuário escrever
-- um bloco de contexto, nem como reaproveitá-lo entre módulos.
--
-- POR QUE COM VERSÃO: mudar um prompt muda o que a IA responde. Sem guardar a
-- versão usada, uma auditoria feita mês passado não é reproduzível — e
-- "auditar" é literalmente o uso pedido.
CREATE TABLE IF NOT EXISTS contextos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  descricao    text,

  -- O bloco de prompt em si.
  conteudo     text NOT NULL,

  -- Onde este bloco pode ser usado. 'analise' é o painel de IA que lê o CRM;
  -- 'conteudo' é geração de texto; 'automacao' é o editor de fluxo;
  -- 'atendimento' é o que descreve tom e regras de resposta no chat.
  escopo       text NOT NULL DEFAULT 'analise'
                 CHECK (escopo IN ('analise','conteudo','automacao','atendimento')),

  -- Bloco desligado some das opções sem perder o histórico de quem o usou.
  ativo        boolean NOT NULL DEFAULT true,
  ordem        integer NOT NULL DEFAULT 0,

  -- Sobe a cada edição do conteúdo. É o número que a execução carimba.
  versao       integer NOT NULL DEFAULT 1,

  criado_por       uuid,
  data_criacao     timestamptz NOT NULL DEFAULT now(),
  data_atualizacao timestamptz NOT NULL DEFAULT now()
);

-- Nome é como a pessoa escolhe o bloco na tela; dois "Auditoria de proposta"
-- tornam a escolha um chute. lower() para não passar por maiúscula.
CREATE UNIQUE INDEX IF NOT EXISTS ux_contextos_nome ON contextos (lower(nome));
CREATE INDEX IF NOT EXISTS ix_contextos_escopo ON contextos (escopo, ordem)
  WHERE ativo;

-- Histórico do conteúdo. Linha imutável, mesmo contrato de fluxo_versoes:
-- editar o contexto GRAVA uma versão nova, nunca reescreve a anterior.
CREATE TABLE IF NOT EXISTS contexto_versoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contexto_id  uuid NOT NULL REFERENCES contextos (id) ON DELETE CASCADE,
  versao       integer NOT NULL,
  conteudo     text NOT NULL,
  criado_por   uuid,
  data_criacao timestamptz NOT NULL DEFAULT now(),

  UNIQUE (contexto_id, versao)
);

-- Qual contexto foi usado em qual conversa de IA, com a versão exata do texto.
-- É esta linha que torna uma auditoria repetível seis meses depois.
--
-- ON DELETE RESTRICT no contexto: apagar um bloco de prompt que já auditou
-- alguma coisa apagaria a explicação do resultado. Desative (ativo = false).
CREATE TABLE IF NOT EXISTS ia_conversa_contextos (
  conversa_id  uuid NOT NULL REFERENCES ia_conversas (id) ON DELETE CASCADE,
  contexto_id  uuid NOT NULL REFERENCES contextos (id)    ON DELETE RESTRICT,
  versao       integer NOT NULL,
  data_criacao timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversa_id, contexto_id)
);

CREATE INDEX IF NOT EXISTS ix_ia_conversa_contextos_contexto
  ON ia_conversa_contextos (contexto_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 5. ANÁLISE: o "não pode deletar" garantido pelo BANCO, não pelo prompt
-- ════════════════════════════════════════════════════════════════════════════
-- PEDIDO: "o backend deve ser configurado a impedir injeção de prompt, não deve
-- ser nunca possivel deletar dados… apenas poder criar estruturas de automação,
-- ou criar um segmento e agrupar pessoas, mas nunca remover elas de tags,
-- segmentos ou deletar quaisquer dados".
--
-- HOJE a garantia é só de intenção: as ferramentas em lib/ia/ferramentas.ts por
-- acaso não têm DELETE escrito, e o system prompt pede para não fazer. As duas
-- coisas são texto — a primeira muda quando alguém adiciona uma ferramenta, a
-- segunda muda quando um cliente escreve "ignore as instruções acima" numa
-- mensagem de WhatsApp que a IA vai ler.
--
-- O QUE ISTO FAZ: um ROLE do Postgres que fisicamente não tem o privilégio. Com
-- a IA conectando por ele, "deletar" deixa de ser proibido e passa a ser
-- IMPOSSÍVEL — um DELETE volta "permission denied" independentemente do que o
-- prompt disser. É a única forma de a promessa não depender de um texto.
--
-- A permissão é desenhada rente ao pedido:
--   SELECT em tudo                            → analisar
--   INSERT em segmentos, contato_segmentos    → "criar um segmento e agrupar"
--   INSERT em fluxos, fluxo_versoes, contextos → "criar estruturas"
--   UPDATE só em colunas de ponteiro de rascunho
--   nada de DELETE, em lugar nenhum
--   nada em fluxo_execucoes → não existe inscrever, logo não existe DISPARAR
--   nada em contato_tags    → não existe remover de tag
--
-- ⚠ A SENHA: gerada na aplicação desta migration e escrita no .env como
-- DATABASE_URL_IA. Se rodar este arquivo à mão, troque o literal abaixo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chroma_ia') THEN
    CREATE ROLE chroma_ia LOGIN PASSWORD 'TROQUE_ESTA_SENHA';
  END IF;
END $$;

-- Ponto de partida: nada. Depois concede-se só o que o pedido autoriza.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM chroma_ia;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM chroma_ia;
REVOKE ALL ON SCHEMA public FROM chroma_ia;
GRANT USAGE ON SCHEMA public TO chroma_ia;

-- Ler tudo.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO chroma_ia;
-- Tabela criada depois desta migration também nasce legível para a IA — sem
-- isto, todo módulo novo ficaria invisível para a análise até alguém lembrar.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO chroma_ia;

-- Escrever só o que foi autorizado, e só INSERT.
GRANT INSERT ON segmentos             TO chroma_ia;  -- criar segmento
GRANT INSERT ON contato_segmentos     TO chroma_ia;  -- agrupar pessoas nele
GRANT INSERT ON fluxos                TO chroma_ia;  -- criar a estrutura
GRANT INSERT ON fluxo_versoes         TO chroma_ia;  -- gravar o rascunho
GRANT INSERT ON contextos             TO chroma_ia;
GRANT INSERT ON contexto_versoes      TO chroma_ia;
GRANT INSERT ON ia_conversas          TO chroma_ia;  -- a própria conversa
GRANT INSERT ON ia_conversa_contextos TO chroma_ia;

-- UPDATE por COLUNA, o mínimo para o rascunho apontar para a versão nova. A IA
-- não alcança nome, estado, motor nem webhook do fluxo — e "publicar", que é o
-- que fala com o n8n de produção, mexe em colunas fora desta lista.
GRANT UPDATE (versao_rascunho_id, data_atualizacao) ON fluxos TO chroma_ia;
-- A conversa de IA precisa reescrever as próprias falas; é dela.
GRANT UPDATE (falas, titulo, data_atualizacao) ON ia_conversas TO chroma_ia;
GRANT UPDATE (conteudo, descricao, versao, ativo, data_atualizacao)
  ON contextos TO chroma_ia;

-- Explícito, para não depender de "não concedemos": nem DELETE, nem TRUNCATE.
-- Redundante hoje (nada foi concedido), mas sobrevive a alguém rodar um
-- GRANT ALL distraído no futuro.
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM chroma_ia;
-- Disparar é o que manda WhatsApp para gente real. A IA não escreve aqui.
REVOKE INSERT, UPDATE, DELETE ON fluxo_execucoes  FROM chroma_ia;
REVOKE INSERT, UPDATE, DELETE ON fluxo_esperas    FROM chroma_ia;
REVOKE INSERT, UPDATE, DELETE ON fluxo_publicacoes FROM chroma_ia;
-- "nunca remover elas de tags, segmentos": sem UPDATE/DELETE nos vínculos, o
-- INSERT concedido acima é de mão única — agrupa, nunca desagrupa.
REVOKE UPDATE, DELETE ON contato_segmentos FROM chroma_ia;
REVOKE ALL             ON contato_tags     FROM chroma_ia;
GRANT  SELECT          ON contato_tags     TO   chroma_ia;
-- Mensagem é o que sai para o cliente. Ler sim, escrever nunca.
REVOKE INSERT, UPDATE, DELETE ON mensagens    FROM chroma_ia;
REVOKE INSERT, UPDATE, DELETE ON atendimentos FROM chroma_ia;


-- ════════════════════════════════════════════════════════════════════════════
-- O QUE FOI IMPLEMENTADO DEPOIS DESTA MIGRATION (2026-09-09)
-- ════════════════════════════════════════════════════════════════════════════
--   · Mídia: lib/midia.ts (extração do evento, fila e storage em disco sob
--     MIDIA_DIR), captura em app/api/uazapi/webhook, entrega por
--     /api/midia/[id], retentativa em /api/midia/fila, render no chat.
--   · Pausar o lead: pausarExecucao/retomarExecucao em
--     lib/automacoes/repositorio.ts + seção "Automações" na ficha da
--     oportunidade. As consultas de "no fluxo" e cancelarNaCadencia passaram a
--     enxergar 'pausada' — sem isso, pausar sumia da contagem e "remover da
--     cadência" não alcançava quem estava pausado.
--   · Segmento: inscreverSegmento + dispararParaSegmento, no painel do fluxo.
--   · Seleção do kanban: app/funil/barra-selecao.tsx com exportar (CSV),
--     mover de responsável, adicionar a segmento e inscrever em automação.
--   · Contextos: lib/contextos.ts, módulo /contextos, e a costura em
--     app/api/ia/route.ts (o bloco entra depois do system fixo, preservando o
--     prefixo cacheável) com registro em ia_conversa_contextos.
--
-- O QUE CONTINUA PENDENTE
-- ════════════════════════════════════════════════════════════════════════════
--   · DATABASE_URL_IA no .env. O role chroma_ia existe e lib/ia/db.ts já o usa
--     quando a variável está definida — sem ela, a IA lê o banco como DONO e a
--     garantia de "não pode apagar" volta a ser só o prompt. lib/ia/db.ts avisa
--     no log enquanto for o caso.
--   · Storage de mídia em disco não sobrevive a deploy em serverless. Trocar
--     por bucket é mudar salvarArquivo/lerArquivo em lib/midia.ts.
--   · O formato do payload de mídia da uazapi não foi confirmado contra um
--     evento real — a extração é tolerante e loga o evento cru.
--   · Os seis blocos ainda marcados como não implementados no executor
--     (mudar_segmento, criar_oportunidade, atualizar_contato, enviar_email,
--     mudar_fluxo, requisicao_http) seguem sendo 'pulado' na execução.
