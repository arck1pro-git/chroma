-- ── Departamentos e acesso por módulo ───────────────────────────────────────
-- Quem vê o quê. Até aqui o CRM tinha login (migration-auth.sql) e mais nada:
-- quem entrava via TODOS os módulos — funil, automações, webhooks, chaves de
-- blog, Configurações inteira.
--
-- POR QUE DEPARTAMENTO E NÃO `papel`: `usuarios.papel` já existia com
-- CHECK ('admin','operador'), e bastaria acrescentar 'ti' na lista. O problema
-- é que "comercial vê dashboard, chat e agenda" ficaria escrito em TypeScript:
-- pra mudar o acesso de um time alguém teria que editar código e publicar.
-- Com departamento em tabela, quem muda é o TI, na tela, sem deploy — que é o
-- que foi pedido.
--
-- O QUE CONTINUA EM CÓDIGO, E POR QUÊ: o CATÁLOGO de módulos
-- (lib/auth/modulos.ts). Um módulo é uma rota com page.tsx — nenhuma linha de
-- banco cria /agenda. A tabela responde "quem tem acesso a /agenda", não
-- "existe /agenda". Módulo que sai do código e sobra aqui é simplesmente
-- ignorado na leitura.
--
-- Idempotente: pode rodar duas vezes sem estourar.

-- ── departamentos ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departamentos (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome     text NOT NULL,
  -- Estável e legível: é o que o seed, o script de admin e qualquer consulta
  -- manual usam pra achar o departamento sem depender do uuid sorteado.
  slug     text NOT NULL UNIQUE,

  -- Hierarquia: comercial(1) < admin(2) < ti(3). NÃO é ela que decide acesso a
  -- módulo — isso é departamento_modulos, linha a linha. O nível serve pra
  -- ordenar a tela e pra impedir que alguém mexa num departamento acima do seu.
  nivel    smallint NOT NULL DEFAULT 1 CHECK (nivel BETWEEN 1 AND 99),

  -- Os três originais não se apagam. Apagar "Comercial" com gente dentro
  -- deixaria essa gente sem departamento — e sem departamento é sem acesso.
  sistema  boolean NOT NULL DEFAULT false,

  -- A chave da própria portaria: só departamento com isto abre
  -- /configuracoes/acessos e edita estas duas tabelas.
  --
  -- POR QUE UMA COLUNA E NÃO O MÓDULO 'configuracoes': se a tela de acessos
  -- fosse liberada por linha de departamento_modulos, quem tivesse
  -- Configurações poderia se dar qualquer módulo — inclusive os que o pedido
  -- tirou do admin. Separado assim, Configurações continua sendo uma coisa
  -- (funis, tags, usuários) e "mexer em quem vê o quê" é outra.
  gerencia_acessos boolean NOT NULL DEFAULT false,

  data_criacao timestamptz NOT NULL DEFAULT now()
);

-- ── departamento_modulos ────────────────────────────────────────────────────
-- Uma linha = um módulo liberado. AUSÊNCIA DE LINHA É AUSÊNCIA DE ACESSO: não
-- existe linha com "negado". Departamento novo nasce sem nada e recebe o que o
-- TI marcar — mesmo princípio do proxy.ts, que fecha por padrão.
CREATE TABLE IF NOT EXISTS departamento_modulos (
  departamento_id uuid NOT NULL REFERENCES departamentos (id) ON DELETE CASCADE,

  -- Chave do catálogo em lib/auth/modulos.ts. Sem FK nem CHECK de propósito:
  -- a lista de módulos muda com deploy de código, e um CHECK aqui obrigaria uma
  -- migração a cada módulo novo — com a migração e o deploy tendo que acontecer
  -- na ordem certa, senão o INSERT falha.
  modulo          text NOT NULL,

  -- Até onde a pessoa enxerga DENTRO do módulo:
  --   'proprio' → só as linhas em que ela é a responsável
  --   'todos'   → as de todo mundo
  -- É o que faz o comercial ver só as métricas dele e o admin as de todos, sem
  -- que isso vire um `if (papel === 'comercial')` em TypeScript.
  --
  -- Módulo que não sabe filtrar por dono ignora esta coluna (ver `escopavel` no
  -- catálogo); fica 'todos' e ninguém lê.
  escopo          text NOT NULL DEFAULT 'todos'
                    CHECK (escopo IN ('proprio', 'todos')),

  PRIMARY KEY (departamento_id, modulo)
);

-- ── o vínculo da pessoa ─────────────────────────────────────────────────────
-- NULL é permitido e quer dizer "sem acesso a nada". Duas situações reais caem
-- aí: o usuário que existe só pra aparecer como responsável (sem e-mail, sem
-- senha — ver migration-front.sql) e a conta nova antes de alguém dizer de que
-- time ela é. As duas devem mesmo ver zero módulos.
--
-- ON DELETE RESTRICT (o padrão): apagar um departamento com gente dentro tem
-- que doer no banco também, não só na tela.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS departamento_id uuid REFERENCES departamentos (id);

CREATE INDEX IF NOT EXISTS ix_usuarios_departamento
  ON usuarios (departamento_id) WHERE departamento_id IS NOT NULL;

-- ── Os três do pedido ───────────────────────────────────────────────────────
INSERT INTO departamentos (nome, slug, nivel, sistema, gerencia_acessos) VALUES
  ('Comercial', 'comercial', 1, true,  false),
  ('Admin',     'admin',     2, true,  false),
  ('TI',        'ti',        3, true,  true)
ON CONFLICT (slug) DO NOTHING;

-- ── Acesso inicial ──────────────────────────────────────────────────────────
-- O `WHERE NOT EXISTS` é o detalhe que importa: o seed só roda pra departamento
-- que ainda não tem NENHUMA linha de módulo. Sem isso, rodar a migração de novo
-- depois de o TI tirar um módulo na tela ressuscitaria o acesso removido — a
-- migração desfazendo, calada, uma decisão de quem administra.
INSERT INTO departamento_modulos (departamento_id, modulo, escopo)
SELECT d.id, m.modulo, m.escopo
  FROM departamentos d
  JOIN (VALUES
    -- Comercial: dashboard, chat, agenda — e as métricas DELE.
    ('comercial', 'inicio',       'todos'),
    ('comercial', 'chat',         'todos'),
    ('comercial', 'agenda',       'todos'),
    ('comercial', 'metricas',     'proprio'),

    -- Admin: tudo, menos Configurações, Automações e Webhooks.
    ('admin',     'inicio',       'todos'),
    ('admin',     'chat',         'todos'),
    ('admin',     'agenda',       'todos'),
    ('admin',     'metricas',     'todos'),
    ('admin',     'emails',       'todos'),
    ('admin',     'campanhas',    'todos'),
    ('admin',     'blog',         'todos'),
    ('admin',     'contextos',    'todos'),
    ('admin',     'meta',         'todos'),
    ('admin',     'integracoes',  'todos'),

    -- TI: tudo.
    ('ti',        'inicio',       'todos'),
    ('ti',        'chat',         'todos'),
    ('ti',        'agenda',       'todos'),
    ('ti',        'metricas',     'todos'),
    ('ti',        'emails',       'todos'),
    ('ti',        'automacoes',   'todos'),
    ('ti',        'campanhas',    'todos'),
    ('ti',        'blog',         'todos'),
    ('ti',        'webhooks',     'todos'),
    ('ti',        'contextos',    'todos'),
    ('ti',        'meta',         'todos'),
    ('ti',        'integracoes',  'todos'),
    ('ti',        'configuracoes','todos')
  ) AS m(slug, modulo, escopo) ON m.slug = d.slug
 WHERE NOT EXISTS (
   SELECT 1 FROM departamento_modulos dm WHERE dm.departamento_id = d.id
 );

-- ── Quem já tinha conta ─────────────────────────────────────────────────────
-- papel='admin' vai pro TI, e não pro Admin do pedido: quem é admin hoje é
-- quem montou isto e precisa continuar alcançando Configurações depois da
-- virada. Mandar pro Admin novo tiraria dele, em silêncio, a tela que ele usa
-- pra consertar o resto — inclusive esta.
--
-- Só mexe em quem ainda não tem departamento: rodar de novo não reclassifica
-- ninguém que o TI já tenha movido na tela.
UPDATE usuarios u
   SET departamento_id = d.id
  FROM departamentos d
 WHERE u.departamento_id IS NULL
   AND u.email IS NOT NULL
   AND d.slug = CASE WHEN u.papel = 'admin' THEN 'ti' ELSE 'comercial' END;

-- `usuarios.papel` fica onde está, sem ninguém lendo. Não é dropada aqui de
-- propósito: se algo que escapou da varredura ainda escrever nela, um UPDATE
-- numa coluna ignorada é barulho; um UPDATE numa coluna que sumiu é 500 na cara
-- do usuário. Sai numa migração própria, depois de uma semana sem reclamação.
