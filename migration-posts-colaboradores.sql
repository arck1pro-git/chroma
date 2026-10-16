-- Colab nos posts do Instagram (2026-10-16, pedido dele: "colab entre
-- arck1pro e fabricio"). Campo aprovado por ele.
--
-- Até 3 contas do Instagram convidadas para o post (o teto da API). Vale para
-- Reels, post de foto e carrossel — story não aceita colab. Quando a conta
-- convidada é um dos perfis do conector (lib/social/perfis.ts), o CRM aceita o
-- convite sozinho logo depois de publicar (lib/social/meta-publicar.ts); conta
-- de fora recebe o convite e aceita no app.
--
-- Rodar ANTES do deploy que traz o colab.

ALTER TABLE posts_sociais
  ADD COLUMN IF NOT EXISTS colaboradores text[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(colaboradores) <= 3);
