-- Posts do Instagram e do Facebook pelo conector MCP (2026-10-15).
--
-- PARA QUE SERVE: o Claude publica e agenda posts nos perfis da empresa pelo
-- link de postar do MCP (app/api/mcp-postar/[segredo]), no lugar do Metricool.
-- Os campos são os que ele aprovou em 2026-10-15.
--
-- POR QUE UMA TABELA: a API do Instagram não agenda. Quem segura o post até a
-- hora e publica é o CRM: o agendador do n8n chama /api/social/publicar a cada
-- minuto, e a rota publica o que venceu (lib/social/publicar.ts).
--
-- A MÍDIA é copiada para o bucket PRIVADO `crm-posts-sociais` na hora de
-- agendar, para o link de origem (imagem ou vídeo gerado por IA) não expirar
-- até a publicação. Na hora de publicar sai uma URL assinada para a Meta
-- buscar. Depois de publicado em todas as redes, a cópia é apagada.
--
-- Rodar ANTES do deploy que traz o link de postar.

CREATE TABLE IF NOT EXISTS posts_sociais (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A chave do perfil em lib/social/perfis.ts (fabhricioari, amaan, arck1pro).
  -- Sem CHECK: perfil novo entra pelo código, sem migration.
  perfil              text NOT NULL,
  redes               text[] NOT NULL
                      CHECK (cardinality(redes) > 0 AND redes <@ ARRAY['instagram', 'facebook']),
  tipo                text NOT NULL CHECK (tipo IN ('reels', 'story', 'feed', 'carrossel')),
  legenda             text NOT NULL DEFAULT '',
  -- Em ordem: [{ origem, caminho, mime, tipo: 'imagem'|'video', tamanho }].
  -- `caminho` é o objeto no bucket; nulo quando a cópia não coube (acima do
  -- teto do bucket) e a publicação usa o link de origem.
  midias              jsonb NOT NULL DEFAULT '[]',
  -- Capa do Reels no Instagram (opcional).
  capa_url            text,
  primeiro_comentario text,
  -- Vazio = agora.
  publicar_em         timestamptz,
  estado              text NOT NULL DEFAULT 'agendado'
                      CHECK (estado IN ('agendado', 'publicando', 'publicado', 'erro', 'cancelado')),
  -- Por rede: { instagram: { id, link, em } | { erro, em }, facebook: … }.
  resultado           jsonb NOT NULL DEFAULT '{}',
  criado_por          text NOT NULL DEFAULT 'mcp',
  data_criacao        timestamptz NOT NULL DEFAULT now(),
  data_atualizacao    timestamptz NOT NULL DEFAULT now()
);

-- A fila do agendador: só os que ainda esperam a hora.
CREATE INDEX IF NOT EXISTS ix_posts_sociais_fila
  ON posts_sociais (publicar_em) WHERE estado = 'agendado';

CREATE INDEX IF NOT EXISTS ix_posts_sociais_perfil
  ON posts_sociais (perfil, data_criacao DESC);
