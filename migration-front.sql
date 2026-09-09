-- ============================================================================
-- Migration: furos que o front precisa e o schema.sql original não tinha.
-- Revise e rode você mesmo (psql, painel do Neon, etc.). Nada aqui apaga dado.
-- Cada bloco explica POR QUE a coluna existe e onde a tela usa.
-- ============================================================================

-- ── Funis ───────────────────────────────────────────────────────────────────
-- Subtítulo do funil, mostrado na barra de filtros. DEFAULT '' pra não quebrar
-- as linhas que já existirem (nenhuma, por enquanto).
ALTER TABLE funis
  ADD COLUMN descricao text NOT NULL DEFAULT '';

-- ── Etapas ──────────────────────────────────────────────────────────────────
-- ordem: sequência das colunas no kanban. Sem isto, "quais etapas e em que
--        ordem?" não tem resposta e o quadro sai embaralhado.
-- cor:   classe Tailwind do pontinho da etapa (ex.: 'bg-violet-500'). É string
--        de UI mesmo — o front aplica direto como className.
ALTER TABLE etapas
  ADD COLUMN ordem int  NOT NULL DEFAULT 0,
  ADD COLUMN cor   text NOT NULL DEFAULT 'bg-zinc-400';

-- Ordena as etapas dentro do funil (é como o front lista as colunas).
CREATE INDEX ix_etapas_funil_ordem ON etapas (funil_id, ordem);

-- ── Usuários ────────────────────────────────────────────────────────────────
-- responsavel_id (oportunidades, atendimentos) e autor_id (mensagens, historico,
-- anotacoes) são uuid soltos no schema atual — não há de onde tirar nome/iniciais
-- pra mostrar no card e no balão. Esta tabela dá esse de-para.
-- (Ainda NÃO é auth: é só o cadastro de quem aparece como responsável/autor.)
CREATE TABLE usuarios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  iniciais     text NOT NULL,
  data_criacao timestamptz NOT NULL DEFAULT now()
);

-- ── OPCIONAL: viram FK quando você quiser o banco garantindo integridade ─────
-- O schema original já dizia "vira FK quando usuarios existir". Descomente se
-- quiser travar responsavel/autor a um usuario real. Cuidado: com isto, enviar
-- mensagem exige um usuario cadastrado (o "usuário logado" precisa existir aqui).
-- ALTER TABLE oportunidades ADD FOREIGN KEY (responsavel_id) REFERENCES usuarios (id);
-- ALTER TABLE atendimentos  ADD FOREIGN KEY (responsavel_id) REFERENCES usuarios (id);
-- ALTER TABLE mensagens     ADD FOREIGN KEY (autor_id)       REFERENCES usuarios (id);
-- ALTER TABLE historico     ADD FOREIGN KEY (autor_id)       REFERENCES usuarios (id);
-- ALTER TABLE anotacoes     ADD FOREIGN KEY (autor_id)       REFERENCES usuarios (id);

-- ── NÃO viram coluna (ficam derivados na query) ──────────────────────────────
--   · oportunidades.dias_na_etapa → o front mostra "N dias na etapa", mas não há
--     registro de QUANDO a op entrou na etapa. Vou aproximar por now()-data_criacao.
--     Se um dia quiser o número exato, aí sim precisa de uma coluna
--     `entrou_etapa_em timestamptz` tocada a cada movimentação.
--   · atendimentos.nao_lidas → count de mensagens do contato mais novas que
--     atendimentos.lido_em. Já dá pra derivar, sem coluna nova.
--
-- ── NÃO incluído (decidir se/quando persistir o kanban) ──────────────────────
--   · Reordenar card DENTRO da etapa (drag) não tem onde salvar: precisaria de
--     `oportunidades.ordem int`. Mover ENTRE etapas já salva em etapa_id/funil_id.
--     Fora isto, a ordem dentro da coluna é a de data_criacao. Me avisa se quiser
--     ordem manual persistente que eu adiciono a coluna.
