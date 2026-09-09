-- ============================================================================
-- Migration: dedupe de mensagens por id_externo.
-- Revise e rode você mesmo (psql, painel do Neon, etc.).
--
-- POR QUE: com o webhook passando a gravar TAMBÉM o que sai do nosso número
-- (fromMe), o mesmo evento pode chegar mais de uma vez — retentativa da uazapi,
-- reexecução do workflow no n8n, ou a linha já existir porque foi o próprio
-- Chroma que enviou (app/chat/actions.ts grava antes de disparar). O handler usa
-- ON CONFLICT (id_externo) DO NOTHING, e ON CONFLICT precisa de índice ÚNICO —
-- o que existe hoje (ix_mensagens_externo) é comum, então não serve.
-- ============================================================================

-- ── 1. Antes de tudo: existe duplicata? ─────────────────────────────────────
-- Rode SÓ isto primeiro. Se voltar zero linhas, pule direto pro passo 3.
SELECT id_externo, count(*) AS repeticoes
FROM mensagens
WHERE id_externo IS NOT NULL
GROUP BY id_externo
HAVING count(*) > 1;

-- ── 2. Só se o passo 1 voltou linhas ────────────────────────────────────────
-- Apaga as repetidas mantendo a MAIS ANTIGA de cada id_externo (a primeira é a
-- que a tela já mostrou). Descomente conscientemente: isto apaga dado.
-- DELETE FROM mensagens m
-- USING mensagens mais_antiga
-- WHERE m.id_externo IS NOT NULL
--   AND m.id_externo = mais_antiga.id_externo
--   AND (mais_antiga.data_criacao, mais_antiga.id) < (m.data_criacao, m.id);

-- ── 3. Troca o índice comum pelo único ──────────────────────────────────────
-- Parcial (WHERE id_externo IS NOT NULL) porque mensagem 'pendente' e mensagem
-- com 'erro' ficam sem id_externo, e várias delas coexistem numa conversa —
-- um único total proibiria a segunda.
DROP INDEX IF EXISTS ix_mensagens_externo;

CREATE UNIQUE INDEX ux_mensagens_externo
  ON mensagens (id_externo)
  WHERE id_externo IS NOT NULL;

-- Confere que ficou único (deve listar ux_mensagens_externo com indisunique = t):
-- SELECT i.relname, x.indisunique
-- FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
-- WHERE x.indrelid = 'mensagens'::regclass;
