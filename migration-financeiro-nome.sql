-- O colaborador cadastrado à mão na folha (pedido dele, 2026-11-04: "coloca no
-- adicionar colaborador para poder cadastrar um também"), alguém que não está
-- no app de ponto nem no AmaanOffice. Modelagem escolhida por ele: uma coluna
-- de nome no cadastro da folha.
--
-- O pessoa_id dele é "manual:<uuid>" (lib/financeiro-tipos.ts, origemDe), e o
-- nome fica aqui. Para quem vem do ponto ou do AmaanOffice a coluna fica NULL:
-- o nome continua vindo da fonte.
--
-- Rodar ANTES do deploy que traz o cadastro (sem a coluna, a folha avisa que
-- falta migration). Pode rodar de novo: IF NOT EXISTS.

ALTER TABLE financeiro_colaboradores ADD COLUMN IF NOT EXISTS nome text CHECK (length(nome) <= 120);
