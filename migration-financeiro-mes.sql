-- A folha guarda os valores de cada mês, e o deslocamento entra na conta
-- (pedido dele, 2026-11-04):
--
--   "os dados de valor por hora, valor de referência, tipo devem ser
--    persistentes: se já foi lançado um mês no passado, não é dinâmico, fica
--    naquele mês. Também quero o dado de deslocamento [...] sendo a taxa diária
--    de deslocamento um dado a se preencher no colaborador."
--
-- FOTO DO MÊS: financeiro_lancamentos (uma linha por pessoa e mês) passa a
-- guardar também o tipo, o valor hora, o valor mês e a taxa de deslocamento
-- com que aquele mês foi lançado. Mês com a foto usa a foto; mês sem linha (ou
-- sem foto) usa o padrão do cadastro (financeiro_colaboradores), que é o que
-- vale para os meses ainda não lançados. Salvar num mês grava a foto daquele
-- mês; o padrão do cadastro só muda quando se salva o mês corrente ou um
-- futuro (lib/financeiro-pagamentos.ts).
--
-- DESLOCAMENTO: taxa diária no cadastro (vazia = não recebe). O deslocamento do
-- mês é a taxa × os dias presenciais daquele mês no app de ponto
-- (lib/financeiro-tipos.ts, contaDoMes). Não se grava: é conta.
--
-- Os meses que já tinham lançamento (adicional ou descontos) ganham a foto com
-- o padrão de hoje, para não mudarem mais. Pode rodar de novo: tudo é IF NOT
-- EXISTS ou só preenche o que está vazio.

ALTER TABLE financeiro_colaboradores ADD COLUMN IF NOT EXISTS taxa_deslocamento numeric(12, 2) CHECK (taxa_deslocamento >= 0);

ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS tipo text CHECK (tipo IN ('hora', 'fixo'));
ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS valor_hora numeric(12, 2) CHECK (valor_hora >= 0);
ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS valor_mes numeric(12, 2) CHECK (valor_mes >= 0);
ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS taxa_deslocamento numeric(12, 2) CHECK (taxa_deslocamento >= 0);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financeiro_lancamentos_valor_do_tipo') THEN
    ALTER TABLE financeiro_lancamentos ADD CONSTRAINT financeiro_lancamentos_valor_do_tipo CHECK (
      tipo IS NULL OR (tipo = 'hora' AND valor_hora IS NOT NULL) OR (tipo = 'fixo' AND valor_mes IS NOT NULL)
    );
  END IF;
END $$;

UPDATE financeiro_lancamentos l
   SET tipo = c.tipo, valor_hora = c.valor_hora, valor_mes = c.valor_mes, taxa_deslocamento = c.taxa_deslocamento
  FROM financeiro_colaboradores c
 WHERE c.pessoa_id = l.pessoa_id
   AND l.tipo IS NULL;
