-- ============================================================================
-- Migration: a cor passa a ser do FUNIL; a etapa recebe um tom dela.
-- Revise e rode você mesmo (psql, painel do Neon). NADA aqui apaga dado.
--
-- POR QUE: cada etapa guardava a própria classe Tailwind em `etapas.cor`
-- ('bg-violet-500'), escolhida a dedo. Doze etapas podiam sair em doze cores
-- sem relação nenhuma entre si, e a cor não dizia nada sobre o andamento do
-- funil. Agora o funil define UM tom e as etapas o recebem clareando no começo
-- e escurecendo até o fim — a última na ordem é sempre a mais escura. A cor
-- passa a significar progresso.
--
-- ONDE A CONTA MORA: lib/cores-funil.ts (`tomDaEtapa`). É derivação PURA a
-- partir de (cor do funil, posição, total de etapas) — nada por etapa é
-- gravado. Consequência boa e deliberada: reordenar uma etapa muda o tom dela
-- sozinha, o que uma cor gravada na linha não faria.
-- ============================================================================

-- ── 1. A cor do funil ───────────────────────────────────────────────────────
-- Guarda o NOME da cor ('blue'), não a classe pronta ('bg-blue-500'). A classe
-- muda conforme a posição da etapa; o nome é o único pedaço estável, e é o que
-- não amarra o banco a uma convenção de CSS.
--
-- DEFAULT 'blue': funil criado antes desta coluna existir não pode ficar sem
-- cor — sem tom, o quadro sairia com as faixas invisíveis.
ALTER TABLE funis
  ADD COLUMN IF NOT EXISTS cor text NOT NULL DEFAULT 'blue';

-- Vale a lista de lib/cores-funil.ts (TONS_FUNIL). O CHECK existe para um
-- UPDATE à mão não gravar 'roxo' e a faixa sumir na tela sem erro nenhum —
-- classe que o Tailwind não conhece não pinta, e o bug aparece só no olho.
ALTER TABLE funis DROP CONSTRAINT IF EXISTS funis_cor_check;
ALTER TABLE funis
  ADD CONSTRAINT funis_cor_check CHECK (cor IN (
    'blue','sky','cyan','teal','emerald','lime','amber',
    'orange','rose','fuchsia','violet','indigo','zinc'));

-- ── 2. O funil de teste em azul ─────────────────────────────────────────────
-- Pedido explícito. Roda em todos porque hoje o banco só tem os de teste; se
-- houver funil que deva ficar em outra cor, troque pelo id.
UPDATE funis SET cor = 'blue';

-- ── 3. etapas.cor: NÃO é mais lido ──────────────────────────────────────────
-- A coluna continua no banco, com os valores que já tinha. O código parou de
-- ler e de escrever nela (app/configuracoes/actions.ts, app/funil/dados.ts) —
-- quem responde "de que cor é esta etapa?" agora é tomDaEtapa().
--
-- NÃO apaguei a coluna porque DROP não tem volta e o dado antigo não incomoda
-- ninguém: ele só ocupa espaço. O risco de deixá-la é outro, e vale saber: um
-- SELECT futuro pode ler `etapas.cor` achando que ela vale alguma coisa. Se
-- preferir fechar essa porta, é a linha abaixo — conscientemente, depois de
-- conferir que nada mais a referencia:
--
--   ALTER TABLE etapas DROP COLUMN cor;
--
-- Enquanto ela existir, o DEFAULT antigo ('bg-zinc-400') continua preenchendo
-- etapa nova, e isso é inofensivo: ninguém lê.
