-- UM ATENDIMENTO POR PAR DE NÚMEROS.
--
-- A regra: entre o nosso número e o número do contato existe UMA conversa, e
-- ela é a mesma para sempre. Encerrar não abre outra depois — reabre aquela.
-- No Chroma, conversa É o número: o chat serve para ver, não para distribuir
-- ticket entre atendentes.
--
-- Hoje nada garante isso. O webhook procurava uma conversa NÃO ENCERRADA
-- daquele par e, não achando, criava — então toda conversa encerrada que
-- recebesse mensagem de novo virava linha nova, com o histórico do contato
-- partido em pedaços. `iniciarAtendimento` (a tela do chat) procurava por
-- contato IGNORANDO o número, e a linha que criava nascia sem
-- `numero_instancia`.
--
-- ESTA MIGRATION NÃO APAGA NADA. Se houver conversa duplicada, ela PARA e diz
-- quais são — fundir e excluir é decisão de quem conhece as conversas, não de
-- um script. Sem duplicata, ela só preenche o número que falta e cria a trava.

-- SEM BEGIN/COMMIT: postgres.js (scripts/rodar-sql.ts) recusa transação aberta
-- na mão num pool (UNSAFE_TRANSACTION). Os três passos são seguros soltos: o
-- UPDATE é idempotente, a conferência não escreve e o índice usa IF NOT EXISTS.

-- ── 1. A linha sem número ────────────────────────────────────────────────────
-- Conversa sem `numero_instancia` não é "entre dois números": é um buraco, e
-- foi a tela do chat que o abriu. Com UMA instância cadastrada a resposta é
-- óbvia e o backfill a aplica. Com várias, a linha fica como está — adivinhar
-- de qual número aquela conversa saiu seria inventar histórico.
UPDATE atendimentos a
   SET numero_instancia = (SELECT i.numero FROM instancias_uazapi i LIMIT 1),
       data_atualizacao = now()
 WHERE a.numero_instancia IS NULL
   AND (SELECT count(*) FROM instancias_uazapi) = 1
   AND (SELECT i.numero FROM instancias_uazapi i LIMIT 1) IS NOT NULL
   -- Só quando a do par ainda não existir: com ela existindo, preencher aqui
   -- criaria a duplicata que esta migration veio impedir.
   AND NOT EXISTS (
     SELECT 1 FROM atendimentos b
      WHERE b.contato_id = a.contato_id
        AND b.id <> a.id
        AND b.numero_instancia = (SELECT i.numero FROM instancias_uazapi i LIMIT 1));

-- ── 2. Duplicata existente PARA a migration ─────────────────────────────────
-- O índice único falharia sozinho, mas com a mensagem do Postgres: "Key
-- (contato_id, numero_instancia)=(…) is duplicated" — um par de uuids, sem
-- dizer de quem é a conversa nem quantas mensagens estão em cada lado. Este
-- bloco falha ANTES, dizendo o nome do contato e o tamanho de cada conversa,
-- que é o que se precisa para decidir qual fica.
DO $$
DECLARE
  linha record;
  achou boolean := false;
BEGIN
  FOR linha IN
    SELECT c.nome AS contato,
           a.numero_instancia,
           count(*)::int AS conversas,
           string_agg(
             a.id::text || ' (' || a.status || ', ' ||
             (SELECT count(*) FROM mensagens m WHERE m.atendimento_id = a.id)::text ||
             ' mensagens)', ' | ' ORDER BY a.data_criacao) AS detalhe
      FROM atendimentos a
      JOIN contatos c ON c.id = a.contato_id
     GROUP BY c.nome, a.contato_id, a.numero_instancia
    HAVING count(*) > 1
  LOOP
    achou := true;
    RAISE WARNING 'Conversa duplicada: % com o número % → %',
      linha.contato, coalesce(linha.numero_instancia, '(sem número)'), linha.detalhe;
  END LOOP;

  IF achou THEN
    RAISE EXCEPTION
      'Há conversas duplicadas (listadas acima). Junte as mensagens na que fica e apague as outras à mão; depois rode esta migration de novo. Nada foi alterado.';
  END IF;
END $$;

-- ── 3. A trava ───────────────────────────────────────────────────────────────
-- NULLS NOT DISTINCT (Postgres 15+; aqui roda 18) porque `numero_instancia`
-- aceita NULL e, no comportamento padrão, dois NULLs seriam "diferentes" — a
-- trava deixaria passar exatamente o caso que abriu o buraco.
--
-- Sem filtro por status, de propósito: a regra é "uma por par", não "uma ABERTA
-- por par". Conversa encerrada que volta a receber mensagem REABRE (ver o
-- ON CONFLICT em app/api/uazapi/webhook/route.ts) em vez de nascer de novo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_atendimento_contato_numero
  ON atendimentos (contato_id, numero_instancia) NULLS NOT DISTINCT;
