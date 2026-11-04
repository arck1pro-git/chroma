-- A etapa "interesse futuro" (pedido dele, 2026-11-04): "crie uma nova coluna
-- nos funis arck1pro e amaan onde para mover o lead para ali é preciso
-- selecionar o tempo de interesse futuro, para sabermos quando entrar em
-- contato" e "só dá pra mover pra essa etapa se fizer isso".
--
-- Modelagem escolhida por ele (duas colunas):
--   · oportunidades.retomar_em: o dia de retomar o contato. Gravado quando a
--     oportunidade entra numa etapa que pede retorno e apagado quando ela sai
--     para uma que não pede (lib/historico.ts, moverEtapaRegistrandoLote);
--   · etapas.pede_retorno: a etapa só aceita a oportunidade com a data. Liga
--     e desliga em Configurações › Funis; nasce ligada nas etapas novas.
--
-- No dia, o card mostra "Retomar contato" e sobe para o topo da coluna (decisão
-- dele: nada é enviado). Posição escolhida por ele: logo depois de "sem
-- contato". Funil sem "sem contato" fica sem a etapa e o aviso diz qual.
--
-- Pode rodar de novo: as colunas são IF NOT EXISTS e o funil que já tem uma
-- etapa que pede retorno (ou chamada "interesse futuro") não ganha outra.

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS retomar_em date;
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS pede_retorno boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  f record;
  posicao int;
BEGIN
  FOR f IN SELECT id, nome FROM funis WHERE upper(trim(nome)) IN ('AMAAN', 'ARCK1PRO') LOOP
    IF EXISTS (SELECT 1 FROM etapas WHERE funil_id = f.id AND (pede_retorno OR lower(trim(nome)) = 'interesse futuro')) THEN
      RAISE NOTICE 'funil %: já tem a etapa de interesse futuro, nada feito', f.nome;
      CONTINUE;
    END IF;
    SELECT ordem INTO posicao FROM etapas WHERE funil_id = f.id AND lower(trim(nome)) = 'sem contato' ORDER BY ordem LIMIT 1;
    IF posicao IS NULL THEN
      RAISE NOTICE 'funil %: sem a etapa "sem contato", a etapa nova NÃO foi criada', f.nome;
      CONTINUE;
    END IF;
    UPDATE etapas SET ordem = ordem + 1 WHERE funil_id = f.id AND ordem > posicao;
    INSERT INTO etapas (nome, funil_id, ordem, pede_retorno) VALUES ('interesse futuro', f.id, posicao + 1, true);
    RAISE NOTICE 'funil %: etapa "interesse futuro" criada na posição %', f.nome, posicao + 1;
  END LOOP;
END $$;
