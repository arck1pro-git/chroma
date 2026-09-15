-- Uma oportunidade ABERTA por contato em cada funil.
--
-- A REGRA: o mesmo contato não pode ter dois cards abertos no mesmo funil.
-- Fechadas não contam — nem entre si. Cliente que ganhou em março e volta em
-- outubro é negócio novo, e dois negócios perdidos com a mesma pessoa são
-- história, não duplicata. Por isso o índice é PARCIAL: ele só enxerga
-- status = 'aberta'.
--
-- POR QUE NO BANCO E NÃO SÓ NA APLICAÇÃO: são três portas que criam
-- oportunidade (a tela, a captação por webhook e o reabrir de uma fechada) e
-- duas delas podem rodar ao mesmo tempo — o formulário do site enviado duas
-- vezes em meio segundo passa por qualquer "verifica antes de inserir". O
-- índice é a única guarda que não tem janela. A verificação na aplicação
-- continua existindo, mas para dar MENSAGEM: sem ela o usuário veria o erro
-- 23505 cru.
--
-- ⚠ ISTO FALHA SE JÁ HOUVER DUPLICATA. É de propósito: qual das duas fica é
-- decisão de quem conhece o negócio, não de uma migration. Para achá-las:
--
--     SELECT f.nome AS funil, c.nome AS contato, count(*)
--     FROM oportunidades o
--     JOIN contatos c ON c.id = o.contato_id
--     JOIN funis f ON f.id = o.funil_id
--     WHERE o.status = 'aberta'
--     GROUP BY f.nome, c.nome
--     HAVING count(*) > 1;
--
-- Depende de schema.sql.

CREATE UNIQUE INDEX IF NOT EXISTS ux_oportunidade_aberta_por_funil
  ON oportunidades (contato_id, funil_id)
  WHERE status = 'aberta';
