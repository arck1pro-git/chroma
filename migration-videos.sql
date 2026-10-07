-- Vídeos com link rastreável (2026-10-06).
--
-- PARA QUE SERVE: mandar ao lead um link de vídeo com o WhatsApp dele na URL
-- (/v/<slug>?w=<whatsapp>) e saber quanto ele assistiu.
--
-- O ARQUIVO mora no Supabase Storage, bucket PRIVADO `crm-videos`, criado à
-- parte em 2026-10-06. O bucket `videos` que já existia no projeto é de OUTRO
-- sistema e não é tocado — a mesma regra de lib/armazenamento.ts. Aqui fica só
-- o que o CRM precisa saber do arquivo.
--
-- A MEDIÇÃO: cada vez que alguém abre o link nasce UMA linha em
-- video_visualizacoes. Enquanto a página está aberta, ela manda a cada poucos
-- segundos o que o player tocou, e a mesma linha é atualizada. Uma linha por
-- abertura (e não por pessoa) é o que deixa contar "abriu 3 vezes" e somar o
-- tempo de cada vez; o agrupamento por pessoa é feito na leitura.
--
-- Rodar ANTES do deploy que traz a tela /videos.

CREATE TABLE videos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- O pedaço do link: curto e sorteado, não derivado do nome. Renomear o
  -- vídeo não pode quebrar o link que já foi mandado, e o link não pode ser
  -- adivinhado a partir do título.
  slug         text NOT NULL UNIQUE,
  nome         text NOT NULL,
  -- Objeto no bucket crm-videos.
  caminho      text NOT NULL,
  -- Quadro do vídeo em JPEG, tirado no navegador na hora de subir. É a imagem
  -- da prévia do link no WhatsApp e o pôster do player. Nulo quando o
  -- navegador não conseguiu ler o vídeo (codec que ele não toca).
  capa         text,
  mime         text NOT NULL,
  tamanho      bigint NOT NULL,
  -- Segundos. Lida no navegador ao subir; se ele não conseguiu, o primeiro
  -- player que tocar preenche (lib/videos.ts, registrarSinal). Sem duração não
  -- há "% assistido".
  duracao      numeric(10,2),
  -- Em pixels, para a página pública reservar o formato certo antes do vídeo
  -- carregar — Reels é 9:16, e um quadro 16:9 fixo deixaria tarjas enormes.
  largura      integer,
  altura       integer,
  autor_id     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  data_criacao timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE video_visualizacoes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id           uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  -- O WhatsApp como veio no link, só dígitos, e o contato que ele casou na hora
  -- de abrir (últimos 8 dígitos, a mesma tolerância do webhook — ver
  -- lib/telefone.ts). Número que não é contato fica com contato_id nulo; link
  -- sem ?w= fica com os dois nulos.
  whatsapp           text,
  contato_id         uuid REFERENCES contatos(id) ON DELETE SET NULL,
  -- O que tocou, em segundos: [[início, fim], ...], já unidos. Vem do
  -- `video.played` do navegador, então pausa não conta e trecho repetido não
  -- conta duas vezes.
  trechos            jsonb NOT NULL DEFAULT '[]',
  -- A soma dos trechos: quanto do vídeo a pessoa viu NESTA abertura.
  segundos_assistidos numeric(10,2) NOT NULL DEFAULT 0,
  -- O ponto mais adiante que tocou.
  posicao_max        numeric(10,2) NOT NULL DEFAULT 0,
  -- Quanto tempo a página ficou aberta e VISÍVEL (aba em primeiro plano). É o
  -- "quanto ficou no vídeo", que inclui pausa — diferente de assistido.
  segundos_na_pagina integer NOT NULL DEFAULT 0,
  -- Para separar celular de computador na leitura, e para reconhecer robô.
  user_agent         text,
  data_criacao       timestamptz NOT NULL DEFAULT now(),  -- quando abriu
  data_atualizacao   timestamptz NOT NULL DEFAULT now()   -- último sinal
);

CREATE INDEX ix_video_visualizacoes_video
  ON video_visualizacoes (video_id, data_criacao DESC);
CREATE INDEX ix_video_visualizacoes_contato
  ON video_visualizacoes (contato_id) WHERE contato_id IS NOT NULL;

-- O MÓDULO "videos" nasce sem ninguém, como todo módulo novo
-- (lib/auth/modulos.ts): marque quem recebe em /configuracoes/acessos.
