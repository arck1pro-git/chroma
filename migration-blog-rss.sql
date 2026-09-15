-- RSS por blog: as fontes de pauta da geração automática de artigos.
--
-- COMO FUNCIONA: toda segunda às 8h um workflow do n8n pergunta ao CRM quais
-- notícias virar artigo (/api/blogs/rss/pauta) e depois pede UM artigo por vez
-- (/api/blogs/rss/gerar). O laço é do n8n de propósito — ver o comentário na
-- rota de pauta.
--
-- Idempotente: só ADD COLUMN IF NOT EXISTS e CREATE TABLE IF NOT EXISTS.

-- O interruptor. Desligado por padrão: um blog cadastrado hoje não pode começar
-- a gerar artigo sozinho na segunda seguinte sem alguém ter pedido.
ALTER TABLE blog ADD COLUMN IF NOT EXISTS rss_ativo BOOLEAN NOT NULL DEFAULT false;

-- Uma linha por feed. O teto de 5 por blog é regra de produto e mora na API
-- (app/api/blogs/[id]/rss) — no banco ele viraria um CHECK com subconsulta, que
-- o Postgres não aceita, ou um trigger, que é peso demais para a regra.
CREATE TABLE IF NOT EXISTS blog_rss (
  id         SERIAL PRIMARY KEY,
  blog_id    INTEGER NOT NULL REFERENCES blog(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- O mesmo feed duas vezes no mesmo blog só faria a pauta repetir item e
  -- gastar chamada de leitura à toa.
  UNIQUE (blog_id, url)
);

CREATE INDEX IF NOT EXISTS blog_rss_blog_id_idx ON blog_rss (blog_id);

-- A pauta descarta notícia que já virou artigo comparando com `artigo.fonte_url`
-- DENTRO do blog. Sem este índice a checagem varre a tabela de artigos inteira a
-- cada execução, uma vez por item de feed.
CREATE INDEX IF NOT EXISTS artigo_fonte_url_idx ON artigo (blog_id, fonte_url)
  WHERE fonte_url <> '';
