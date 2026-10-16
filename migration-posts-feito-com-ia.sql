-- Selo "feito com IA" nos posts do Instagram (2026-10-16, pedido dele: "subir
-- o post no mcp com a opção de feito com avatar de IA ativada na meta").
-- Campo aprovado por ele (opção por post, padrão desligado).
--
-- Ligado, o contêiner do Instagram vai com is_ai_generated = true e o post
-- mostra "Informações de IA" (Reels, story, foto e carrossel — no carrossel,
-- só no contêiner pai). O Facebook não tem esse selo pela API.
--
-- Rodar ANTES do deploy que traz o selo.

ALTER TABLE posts_sociais
  ADD COLUMN IF NOT EXISTS feito_com_ia boolean NOT NULL DEFAULT false;
