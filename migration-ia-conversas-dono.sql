-- ============================================================================
-- Migration: as conversas com a IA passam a ter DONO.
-- Revise e rode você mesmo (psql, painel do Neon, etc.).
--
-- POR QUE AGORA: migration-ia-conversas.sql criou `usuario_id` nula de
-- propósito, com este comentário — "Para quando existir login. Sem FK enquanto
-- não há quem preencher". O login existe desde migration-auth.sql, e a coluna
-- continuou vazia: a lista da barra lateral é a de TODO MUNDO, e cada pessoa vê
-- as perguntas que as outras fizeram à IA. Como as perguntas carregam contexto
-- do funil (nome de oportunidade, valor), isso é vazamento entre departamentos
-- dentro do próprio CRM.
--
-- O QUE MUDA: a barra passa a listar só o que a pessoa logada criou. Ler, gravar
-- e apagar também — o dono entra no WHERE de toda consulta (lib/ia/conversas.ts),
-- não só na listagem. Filtrar só na lista deixaria a conversa de outro acessível
-- por id, que é o mesmo buraco com um passo a mais.
--
-- ⚠ ESTA MIGRATION MUDA VISIBILIDADE. Depois de rodar, ninguém mais enxerga as
-- conversas antigas de outra pessoa — inclusive as suas, se o dono escolhido
-- abaixo não for você. Nada é apagado: é só quem vê.
-- ============================================================================

-- ── 1. As conversas de hoje vão para o TI ───────────────────────────────────
--
-- Elas nasceram sem dono, então não há como saber quem perguntou o quê: o CRM
-- não tinha sessão quando foram gravadas. Jogá-las no TI é a decisão do dono do
-- produto, e é a que menos mente — TI é o departamento que administra
-- (gerencia_acessos), e o alternativo seria deixá-las órfãs, ou seja, invisíveis
-- para todos e impossíveis de apagar pela tela.
--
-- O DONO É UMA PESSOA, não um departamento: `usuario_id` aponta para `usuarios`.
-- Escolhemos o usuário ATIVO e COM LOGIN mais antigo do departamento 'ti'.
-- Se quiser outra pessoa, troque o SELECT abaixo por um id fixo antes de rodar.
UPDATE ia_conversas
   SET usuario_id = (
     SELECT u.id
       FROM usuarios u
       JOIN departamentos d ON d.id = u.departamento_id
      WHERE d.slug = 'ti'
        AND u.ativo = true
        AND u.email IS NOT NULL
      ORDER BY u.data_criacao
      LIMIT 1
   )
 WHERE usuario_id IS NULL;

-- Sem ninguém no TI, o UPDATE acima não casou nada e as linhas seguem órfãs — e
-- o NOT NULL do passo 2 quebraria com um erro de constraint que não explica
-- nada. Falhar aqui, dizendo o que fazer, é mais barato que decifrar aquilo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ia_conversas WHERE usuario_id IS NULL) THEN
    RAISE EXCEPTION
      'Há conversas sem dono e nenhum usuário ativo com login no departamento TI para recebê-las. Cadastre alguém no TI (Configurações → Usuários), ou troque o SELECT do passo 1 por um id de usuário fixo, e rode de novo.';
  END IF;
END $$;

-- ── 2. Dono obrigatório, daqui pra frente ───────────────────────────────────
--
-- NOT NULL e não "nula = de todo mundo": com a coluna opcional, um INSERT que
-- esquecesse o dono criaria uma conversa invisível para todos (o filtro é
-- `usuario_id = <quem está logado>`), e ninguém descobriria isso a não ser pela
-- conversa que sumiu. O banco recusando é melhor que o silêncio.
ALTER TABLE ia_conversas
  ALTER COLUMN usuario_id SET NOT NULL;

-- A FK que a migration original não pôs porque não havia quem preencher.
--
-- ON DELETE CASCADE: conversa sem dono seria invisível para todo mundo e
-- impossível de apagar pela tela — lixo permanente. Na prática isto quase nunca
-- dispara: o CRM DESATIVA usuário (`ativo = false`), não apaga — não há um
-- DELETE FROM usuarios em lugar nenhum do código.
ALTER TABLE ia_conversas
  DROP CONSTRAINT IF EXISTS ia_conversas_usuario_id_fkey;
ALTER TABLE ia_conversas
  ADD CONSTRAINT ia_conversas_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE;

-- ── 3. Os índices, agora que o dono entrou no WHERE ─────────────────────────
--
-- São duas consultas quentes, e o dono é a primeira coluna das duas:
--   · a barra lateral  → WHERE usuario_id = ? ORDER BY data_atualizacao DESC
--   · um painel de IA  → WHERE usuario_id = ? AND escopo = ? ORDER BY ...
--
-- O ix_ia_conversas_escopo antigo (escopo, data_atualizacao) não serve a
-- nenhuma das duas agora: sem o dono na frente, o Postgres varre todas as
-- conversas do escopo para descartar as dos outros.
DROP INDEX IF EXISTS ix_ia_conversas_escopo;

CREATE INDEX IF NOT EXISTS ix_ia_conversas_dono
  ON ia_conversas (usuario_id, data_atualizacao DESC);

CREATE INDEX IF NOT EXISTS ix_ia_conversas_dono_escopo
  ON ia_conversas (usuario_id, escopo, data_atualizacao DESC);

-- ── Onde o resto disto vive ─────────────────────────────────────────────────
--
--   · lib/ia/conversas.ts        — o dono no WHERE de toda consulta
--   · app/components/acoes-ia.ts — pega o dono da sessão, nunca do navegador
