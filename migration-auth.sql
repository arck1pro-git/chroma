-- ── Autenticação ────────────────────────────────────────────────────────────
-- Login de verdade. Até aqui o CRM não tinha nenhum: qualquer um que alcançasse
-- a URL via tudo — funil, contatos, conversas de WhatsApp, chaves de blog.
--
-- POR QUE EM `usuarios`, E NÃO NUMA TABELA `contas` À PARTE: responsavel_id em
-- oportunidades e atendimentos já aponta pra cá. Com a credencial na mesma
-- linha, "quem está logado" e "de quem é a oportunidade" são o MESMO id, e não
-- dois que precisam ser casados a cada consulta. O preço é não dar pra ter
-- pessoa no CRM sem acesso ao sistema — resolvido por `ativo`, não por tabela.
--
-- Idempotente: pode rodar duas vezes sem estourar.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS email         text,
  -- Formato escrito por lib/auth/senha.ts: scrypt$N$r$p$<salt b64>$<hash b64>.
  -- Guarda os parâmetros junto do hash porque eles vão mudar com o tempo, e sem
  -- isso a senha antiga fica impossível de conferir depois de um ajuste.
  ADD COLUMN IF NOT EXISTS senha_hash    text,
  ADD COLUMN IF NOT EXISTS papel         text NOT NULL DEFAULT 'operador',
  -- Desligar o acesso sem apagar a pessoa: o id dela continua em oportunidades
  -- e atendimentos, e apagar a linha levaria o histórico junto.
  ADD COLUMN IF NOT EXISTS ativo         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ultimo_acesso timestamptz;

-- Único por email, ignorando caixa: "Fabricio@" e "fabricio@" são a mesma
-- pessoa, e sem isto viram duas contas. Índice em lower() e não citext — a
-- extensão não está instalada aqui e isto não exige nenhuma.
-- Parcial (WHERE email IS NOT NULL) porque usuário sem login é permitido.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unico
  ON usuarios (lower(email))
  WHERE email IS NOT NULL;

-- Papel fora da lista é erro de escrita, não estado possível.
DO $$
BEGIN
  ALTER TABLE usuarios
    ADD CONSTRAINT usuarios_papel_valido CHECK (papel IN ('admin', 'operador'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Quem tem email TEM que ter hash. Linha com email e sem senha seria uma conta
-- que existe e não entra — e, dependendo de como o login for escrito um dia,
-- uma conta que entra sem senha.
DO $$
BEGIN
  ALTER TABLE usuarios
    ADD CONSTRAINT usuarios_credencial_completa
    CHECK ((email IS NULL) = (senha_hash IS NULL));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
