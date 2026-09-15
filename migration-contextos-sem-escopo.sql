-- Contextos perdem o `escopo`.
--
-- PEDIDO: "os contextos devem ter só nome, descrição e prompt; onde vão ser
-- aplicados não precisa, isso vamos definir na interface".
--
-- O QUE ERA: `escopo` classificava o bloco em 'analise' | 'conteudo' |
-- 'automacao' | 'atendimento', e cada tela só enxergava os do escopo dela — o
-- painel de IA do funil só listava 'analise', o Blog só aceitava 'conteudo'.
--
-- POR QUE SAI: a classificação estava no lugar errado. Quem sabe se um bloco
-- serve para uma tela é a TELA, na hora de oferecê-lo — não o bloco, no momento
-- em que foi escrito. Na prática o campo obrigava a decidir o uso antes de
-- existir uso, e um mesmo texto ("tom de voz da marca") que serve para artigo,
-- para atendimento e para análise tinha de ser cadastrado três vezes.
--
-- DEPOIS DISTO um contexto é só: nome, descrição e o prompt (`conteudo`).
-- Quem escolhe onde aplicar é a interface: o blog aponta para um contexto no
-- seu cadastro, o painel de IA deixa marcar quais entram naquela conversa.
--
-- `ativo`, `ordem` e `versao` FICAM: não dizem onde o bloco se aplica. `ativo`
-- é o liga/desliga, `ordem` é a posição na lista e `versao` é o que torna uma
-- análise reproduzível seis meses depois (contexto_versoes depende dela).

-- O índice referencia a coluna e sai junto; explícito para deixar o rastro.
DROP INDEX IF EXISTS ix_contextos_escopo;

-- Idempotente: rodar duas vezes não quebra. O CHECK de valores válidos vai
-- embora junto com a coluna.
ALTER TABLE contextos DROP COLUMN IF EXISTS escopo;

-- Sem o escopo, a lista tem uma ordem só: a manual, e o nome como desempate.
-- (Era ORDER BY escopo, ordem, lower(nome) em lib/contextos.ts.)
CREATE INDEX IF NOT EXISTS ix_contextos_ordem ON contextos (ordem, lower(nome))
  WHERE ativo;
