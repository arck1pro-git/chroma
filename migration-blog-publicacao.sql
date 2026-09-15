-- Publicação do blog: a chave de conexão do site + os dois status do artigo.
--
-- Idempotente como as outras: rodar de novo não muda nada e não perde dado. As
-- partes que não têm "IF NOT EXISTS" (o CHECK) são derrubadas antes de recriar.
--
-- Depende de migration-blog.sql.

-- ── 1. A chave de conexão ───────────────────────────────────────────────────
--
-- O site externo consome os artigos por
--
--     GET /api/publico/<chave>/artigos
--     GET /api/publico/<chave>/artigos/<slug>
--
-- e a chave é o que diz DE QUAL BLOG ele está falando. Não usamos `blog.id` na
-- URL porque id é sequencial: quem recebe a URL de um blog descobre os outros
-- trocando o número. A chave também é o que se rotaciona quando ela vaza — o
-- id não se troca.
--
-- POR QUE O DEFAULT É UMA EXPRESSÃO E NÃO VEM DA APLICAÇÃO: blog nasce em dois
-- lugares (a tela e, um dia, qualquer INSERT manual) e um blog sem chave é um
-- blog que a rota pública não acha. Deixando no banco, não existe linha sem.
-- `gen_random_uuid()` é do core desde o PG13, não precisa de pgcrypto; por ser
-- volátil, o ADD COLUMN avalia uma vez POR LINHA — as existentes saem daqui
-- cada uma com a sua.
ALTER TABLE blog ADD COLUMN IF NOT EXISTS chave TEXT NOT NULL
  DEFAULT ('bk_' || replace(gen_random_uuid()::text, '-', ''));

-- Duas chaves iguais serviriam o blog errado. O índice é único e não parcial:
-- a coluna não tem vazio (o default sempre preenche).
CREATE UNIQUE INDEX IF NOT EXISTS blog_chave_idx ON blog (chave);

-- ── 2. Status: três viram dois ──────────────────────────────────────────────
--
-- Era rascunho → revisao → publicado. Agora é PENDENTE → APROVADO, e a razão é
-- a rota pública: ela serve o que está aprovado e só. Com três estados havia
-- duas formas de "ainda não" (rascunho e em revisão) que ninguém distinguia na
-- hora de decidir se o artigo sai no ar.
--
-- A CONVERSÃO É IRREVERSÍVEL: rascunho e revisao caem os dois em pendente, e
-- depois não há como saber qual era qual. É o que a troca significa.
--
-- A ordem importa: derrubar o CHECK antigo ANTES do UPDATE, senão o valor novo
-- é recusado pela restrição velha.
ALTER TABLE artigo DROP CONSTRAINT IF EXISTS artigo_status_check;

UPDATE artigo SET status = 'aprovado' WHERE status = 'publicado';
UPDATE artigo SET status = 'pendente' WHERE status IN ('rascunho', 'revisao');

-- Todo artigo nasce pendente: quem gera é a IA, e nada entra no ar sem alguém
-- ler. As duas rotas de INSERT não citam a coluna — é este default que decide.
ALTER TABLE artigo ALTER COLUMN status SET DEFAULT 'pendente';

ALTER TABLE artigo ADD CONSTRAINT artigo_status_check
  CHECK (status IN ('pendente', 'aprovado'));

-- A rota pública filtra por status e slug dentro de um blog. Sem isto é
-- varredura da tabela a cada visita do site.
CREATE INDEX IF NOT EXISTS artigo_publicado_idx ON artigo (blog_id, status);
