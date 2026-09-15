-- Módulo de Blog: blogs orientados por contexto + artigos de SEO gerados por IA.
--
-- Idempotente: só CREATE TABLE/INDEX IF NOT EXISTS. Rodar mais de uma vez não
-- muda nada e não perde dado.
--
-- O QUE É "AUDITORIA" AQUI: o pedido original falava numa tabela `auditoria`
-- (nome + prompt) que orienta a linha editorial. Este projeto JÁ TEM essa
-- entidade — é `contextos` (migration-revisao-modulos.sql), literalmente "blocos
-- de prompt que setamos no projeto para auditar coisas com IA, ou gerar
-- conteúdos", com escopo 'conteudo' reservado para geração de texto. Criar uma
-- segunda tabela de prompt ao lado dela seria duas fontes de verdade para a
-- mesma coisa. Por isso `blog.auditoria_id` referencia contextos(id) — e é uuid,
-- não serial, porque é o tipo da chave de lá.

-- Blog: cada blog é orientado por um contexto, que define ângulo, tom e
-- critérios editoriais de todos os artigos dele.
CREATE TABLE IF NOT EXISTS blog (
  id           SERIAL PRIMARY KEY,
  nome         TEXT NOT NULL,

  -- ON DELETE SET NULL e não RESTRICT: apagar o bloco de prompt não pode levar
  -- junto os artigos já escritos. O blog fica sem orientação e a tela cobra
  -- que se escolha outra antes de gerar o próximo.
  auditoria_id uuid REFERENCES contextos(id) ON DELETE SET NULL,

  descricao    TEXT NOT NULL DEFAULT '',
  url_base     TEXT NOT NULL DEFAULT '',   -- ex.: https://site.com/blog (canonical + breadcrumb)
  autor        TEXT NOT NULL DEFAULT '',   -- assinatura padrão dos artigos
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Artigo: markdown em `conteudo` + metadados de SEO.
--
-- NÃO EXISTE COLUNA de sumário, FAQ, HTML publicável, contagem de palavras nem
-- nota de SEO: tudo isso é DERIVADO do markdown em lib/artigo.ts. Guardar aqui
-- criaria um segundo lugar para a mesma informação, que sai de sincronia na
-- primeira edição feita por fora da tela.
CREATE TABLE IF NOT EXISTS artigo (
  id               SERIAL PRIMARY KEY,
  blog_id          INTEGER NOT NULL REFERENCES blog(id) ON DELETE CASCADE,
  titulo           TEXT NOT NULL,
  slug             TEXT NOT NULL DEFAULT '',
  meta_title       TEXT NOT NULL DEFAULT '',
  meta_description TEXT NOT NULL DEFAULT '',
  palavra_chave    TEXT NOT NULL DEFAULT '',
  keywords         TEXT NOT NULL DEFAULT '',   -- secundárias, separadas por vírgula
  resumo           TEXT NOT NULL DEFAULT '',
  conteudo         TEXT NOT NULL DEFAULT '',   -- markdown, a fonte única de verdade
  imagem_alt       TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'rascunho'
                   CHECK (status IN ('rascunho','revisao','publicado')),
  fonte_titulo     TEXT NOT NULL DEFAULT '',   -- matéria que originou o artigo
  fonte_url        TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artigo_blog_id_idx ON artigo (blog_id);

-- Slug é único por blog: dois blogs podem ter o mesmo slug, o mesmo blog não.
-- O WHERE deixa vários rascunhos sem slug conviverem — o vazio não é um
-- endereço, então não colide com nada.
CREATE UNIQUE INDEX IF NOT EXISTS artigo_blog_slug_idx ON artigo (blog_id, slug)
  WHERE slug <> '';
