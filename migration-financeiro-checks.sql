-- Os três checks do pagamento de cada pessoa em cada mês (pedido dele,
-- 2026-11-04): "1º quando a Patricia for validando, para ela dar o OK. 2º
-- quando o prestador for enviando a NF. 3º quando enviarmos o pagamento".
--
-- Modelagem escolhida por ele: para cada check, quando foi marcado e por quem
-- (o id da conta do AmaanOffice), no lançamento do mês (financeiro_lancamentos,
-- uma linha por pessoa e mês). Desmarcar apaga os dois.
--
-- Decisões dele: quem tem Editar no Financeiro marca; os checks andam em
-- sequência (a NF só depois da validação, o pagamento só depois da NF; e
-- desmarca-se do último para o primeiro). A regra fica no UPDATE
-- (lib/financeiro-pagamentos.ts, marcarCheck).
--
-- A IA (chroma_ia) já não lê a tabela (migration-financeiro-colaboradores.sql);
-- as colunas novas seguem a tabela. Pode rodar de novo: IF NOT EXISTS.

ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS validado_em timestamptz;
ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS validado_por uuid;
ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS nf_em timestamptz;
ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS nf_por uuid;
ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS pago_em timestamptz;
ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS pago_por uuid;
