-- ============================================================================
-- Migration: o canal de Instagram no /chat (2026-10-26).
-- Idempotente. Roda DEPOIS de migration-ias.sql (precisa da tabela ias) e de
-- migration-campos-personalizados.sql (precisa de contatos.campos).
--
-- PEDIDO: no /chat, as mensagens diretas (DM) e os comentários das três contas
-- de lib/social/perfis.ts, por conta e por postagem, e uma IA que responde a
-- quem comenta. Decisões dele (2026-10-26):
--   · comentários em TABELA PRÓPRIA (instagram_comentarios);
--   · a identidade do Instagram do contato fica em contatos.campos
--     (instagram_id = IGSID, a chave; instagram_usuario = o @, só exibição);
--   · a IA de comentário responde curto em público (frase fixa aprovada) e abre
--     o direct, onde a IA de atendimento segue;
--   · as regras da IA em TABELA (instagram_ia_regras: conta, postagem opcional,
--     IA, ligada). Nenhuma regra nasce aqui: sem regra, nenhuma IA responde.
--
-- As DMs não têm tabela: viram conversa comum (atendimentos.canal =
-- 'instagram', que o CHECK já aceita, e numero_instancia = id da conta).
--
-- COLUNAS ALÉM DO DESENHO, pedidas pela revisão de segurança (2026-10-26):
--   · envio, erro      → a nossa resposta nasce 'pendente' ANTES de falar com a
--                        Meta (a reserva da IA) e termina 'enviado', 'erro' ou
--                        'descartado' (a IA decidiu não responder);
--   · para_autor_id    → a quem a nossa resposta responde: é o que segura uma
--                        resposta pública da IA por autor por postagem;
--   · direct_em/por    → o comentário que já virou direct (private reply): uma
--                        vez por pessoa por postagem, e a Meta só aceita uma
--                        por comentário;
--   · midia_tipo       → media_product_type do webhook: "todas as postagens"
--                        (regra da conta) não vale em anúncio (AD).
-- E os índices únicos parciais das reservas (abaixo), que são a trava real.
-- ============================================================================

CREATE TABLE IF NOT EXISTS instagram_comentarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id       text NOT NULL CHECK (conta_id ~ '^[0-9]+$'),
  midia_id       text NOT NULL CHECK (midia_id ~ '^[0-9]+$'),
  midia_tipo     text,
  comentario_id  text UNIQUE CHECK (comentario_id ~ '^[0-9]+$'),
  pai_id         text CHECK (pai_id ~ '^[0-9]+$'),
  autor_id       text CHECK (autor_id ~ '^[0-9]+$'),
  autor_usuario  text,
  texto          text NOT NULL DEFAULT '',
  da_conta       boolean NOT NULL DEFAULT false,
  enviada_por    text CHECK (enviada_por IN ('ia', 'crm', 'aparelho')),
  envio          text CHECK (envio IN ('pendente', 'enviado', 'erro', 'descartado')),
  erro           text,
  para_autor_id  text CHECK (para_autor_id ~ '^[0-9]+$'),
  direct_em      timestamptz,
  direct_por     text CHECK (direct_por IN ('ia', 'crm')),
  contato_id     uuid REFERENCES contatos (id) ON DELETE SET NULL,
  lido_em        timestamptz,
  data_criacao   timestamptz NOT NULL DEFAULT now(),
  data_registro  timestamptz NOT NULL DEFAULT now(),

  -- Só a nossa resposta tem quem enviou e estado de envio.
  CONSTRAINT ck_ig_comentarios_nossa CHECK (da_conta OR (enviada_por IS NULL AND envio IS NULL)),
  -- Linha que veio da Meta sempre tem o id dela; só a nossa, enquanto não sai, não tem.
  CONSTRAINT ck_ig_comentarios_id CHECK (comentario_id IS NOT NULL OR envio IS NOT NULL),
  CONSTRAINT ck_ig_comentarios_direct CHECK ((direct_em IS NULL) = (direct_por IS NULL))
);

COMMENT ON TABLE instagram_comentarios IS
  'Comentários das postagens das contas do Instagram do CRM e as nossas respostas (lib/instagram-webhook.ts, lib/instagram-comentarios.ts, lib/ia/comentarios.ts).';
COMMENT ON COLUMN instagram_comentarios.conta_id IS 'Id da conta profissional do Instagram (lib/social/perfis.ts, instagramId).';
COMMENT ON COLUMN instagram_comentarios.midia_id IS 'Id da postagem (mídia) na Meta.';
COMMENT ON COLUMN instagram_comentarios.midia_tipo IS 'media_product_type que a Meta mandou no webhook (FEED, REELS, STORY, AD). A regra da conta não vale em AD.';
COMMENT ON COLUMN instagram_comentarios.comentario_id IS 'Id do comentário na Meta. NULL só na nossa resposta que ainda não saiu.';
COMMENT ON COLUMN instagram_comentarios.pai_id IS 'Comentário respondido (thread). NULL = comentário direto na postagem (raiz).';
COMMENT ON COLUMN instagram_comentarios.autor_id IS 'IGSID de quem comentou (na nossa resposta, a própria conta).';
COMMENT ON COLUMN instagram_comentarios.autor_usuario IS 'O @ de quem comentou, sem a arroba. Só exibição: a chave é autor_id.';
COMMENT ON COLUMN instagram_comentarios.texto IS 'O texto do comentário.';
COMMENT ON COLUMN instagram_comentarios.da_conta IS 'Feito por uma das contas do CRM (as nossas respostas): nunca dispara a IA.';
COMMENT ON COLUMN instagram_comentarios.enviada_por IS 'Na nossa resposta: ia, crm (alguém pelo CRM) ou aparelho (pelo app do Instagram).';
COMMENT ON COLUMN instagram_comentarios.envio IS 'Na nossa resposta: pendente (reservada, antes da Meta), enviado, erro ou descartado (a IA decidiu não responder).';
COMMENT ON COLUMN instagram_comentarios.erro IS 'Motivo, quando envio = erro ou descartado.';
COMMENT ON COLUMN instagram_comentarios.para_autor_id IS 'Na nossa resposta: o IGSID de quem foi respondido (uma resposta pública da IA por autor por postagem).';
COMMENT ON COLUMN instagram_comentarios.direct_em IS 'Quando o comentário virou direct (private reply). Uma vez por pessoa por postagem.';
COMMENT ON COLUMN instagram_comentarios.direct_por IS 'Quem abriu o direct a partir do comentário: ia ou crm.';
COMMENT ON COLUMN instagram_comentarios.contato_id IS 'O contato do autor, quando já existe (contato só nasce quando há direct).';
COMMENT ON COLUMN instagram_comentarios.lido_em IS 'Quando alguém marcou como lido no CRM. Não lido = comentário de terceiro com isto vazio.';
COMMENT ON COLUMN instagram_comentarios.data_criacao IS 'Hora do comentário (a do evento da Meta).';
COMMENT ON COLUMN instagram_comentarios.data_registro IS 'Hora em que o CRM gravou a linha ou mudou o envio da nossa resposta (o que o /api/chat/versao acompanha).';

-- A lista da tela: os comentários de uma postagem, em ordem.
CREATE INDEX IF NOT EXISTS ix_ig_comentarios_midia
  ON instagram_comentarios (conta_id, midia_id, data_criacao);

-- Os não lidos (contagem por conta e por postagem).
CREATE INDEX IF NOT EXISTS ix_ig_comentarios_nao_lidos
  ON instagram_comentarios (conta_id, midia_id)
  WHERE NOT da_conta AND lido_em IS NULL;

-- A assinatura do /api/chat/versao: max(data_registro).
CREATE INDEX IF NOT EXISTS ix_ig_comentarios_registro
  ON instagram_comentarios (data_registro);

-- RESERVA 1: no máximo UMA resposta da IA por comentário, em qualquer estado.
-- É o INSERT da reserva que bate aqui: só quem inseriu chama o modelo e a Meta.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ig_ia_por_comentario
  ON instagram_comentarios (pai_id)
  WHERE enviada_por = 'ia';

-- RESERVA 2: no máximo UMA resposta pública da IA por autor por postagem.
-- 'descartado' (a IA decidiu não responder) não ocupa a vaga.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ig_ia_por_autor
  ON instagram_comentarios (conta_id, midia_id, para_autor_id)
  WHERE enviada_por = 'ia' AND envio <> 'descartado';

-- RESERVA 3: um direct por pessoa por postagem (IA ou equipe).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ig_direct_por_autor
  ON instagram_comentarios (conta_id, midia_id, autor_id)
  WHERE direct_em IS NOT NULL;

-- O teto por conta por hora (lib/ia/comentarios.ts).
CREATE INDEX IF NOT EXISTS ix_ig_ia_por_hora
  ON instagram_comentarios (conta_id, data_registro)
  WHERE enviada_por = 'ia';


CREATE TABLE IF NOT EXISTS instagram_ia_regras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id      text NOT NULL CHECK (conta_id ~ '^[0-9]+$'),
  midia_id      text CHECK (midia_id ~ '^[0-9]+$'),
  ia_id         uuid NOT NULL REFERENCES ias (id) ON DELETE CASCADE,
  ligada        boolean NOT NULL DEFAULT false,
  data_criacao  timestamptz NOT NULL DEFAULT now(),
  -- NULLS NOT DISTINCT (Postgres 15+): a regra da conta (midia_id NULL) é uma
  -- só. No padrão, dois NULLs seriam "diferentes" e a trava deixaria duas.
  CONSTRAINT ux_instagram_ia_regras UNIQUE NULLS NOT DISTINCT (conta_id, midia_id)
);

COMMENT ON TABLE instagram_ia_regras IS
  'Qual IA responde aos comentários de uma conta do Instagram. A regra da postagem vence a da conta. Ligar e desligar é de Admin e TI (módulo meta).';
COMMENT ON COLUMN instagram_ia_regras.conta_id IS 'Id da conta profissional do Instagram (lib/social/perfis.ts).';
COMMENT ON COLUMN instagram_ia_regras.midia_id IS 'A postagem; NULL = todas as postagens da conta (menos anúncio).';
COMMENT ON COLUMN instagram_ia_regras.ia_id IS 'A IA que responde (e que fica ligada no contato que nasceu do direct aberto por ela).';
COMMENT ON COLUMN instagram_ia_regras.ligada IS 'Se a regra está valendo. Desligada na postagem também cala a regra da conta nela.';
COMMENT ON COLUMN instagram_ia_regras.data_criacao IS 'Quando a regra foi criada.';


-- A identidade do Instagram do contato: uma pessoa, um contato. O upsert do
-- webhook usa ON CONFLICT neste índice (com o mesmo predicado).
CREATE UNIQUE INDEX IF NOT EXISTS ux_contatos_instagram_id
  ON contatos ((campos->>'instagram_id'))
  WHERE campos ? 'instagram_id';
