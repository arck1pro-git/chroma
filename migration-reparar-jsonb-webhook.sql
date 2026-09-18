-- Conserta o jsonb que a captação gravou torto.
--
-- O DEFEITO: lib/webhooks-recepcao.ts escrevia `${JSON.stringify(obj)}::jsonb`.
-- Com `fetch_types:false` (exigido pelo pooler — ver lib/db.ts), o driver manda
-- a string como texto JSON e o `::jsonb` a guarda como um jsonb do TIPO STRING,
-- não como objeto:
--
--   SELECT jsonb_typeof('{"a":1}'::text::jsonb)  ->  string    (errado)
--   SELECT jsonb_typeof(sql.json({a:1}))         ->  object    (certo)
--
-- No primeiro envio isso já era errado e passava despercebido. No SEGUNDO envio
-- do mesmo contato o `||` fazia o resto:
--
--   jsonb_string || jsonb_string  ->  ["{...}","{...}"]
--
-- ou seja, em vez de MESCLAR os campos, empilhava as duas versões num array de
-- strings. A ficha do contato lê `campos` como objeto e procura por chave —
-- num array ela não acha nada, e o lead aparecia sem nenhum campo preenchido
-- mesmo tendo chegado com todos.
--
-- O código já foi corrigido para `sql.json`. Esta migration limpa o que ficou.
-- Nada aqui apaga dado: os dois formatos quebrados carregam o conteúdo, só no
-- invólucro errado.

-- ── 1. contatos.campos gravado como STRING ──────────────────────────────────
-- Um envio só, nunca mesclado. `#>> '{}'` extrai o texto de dentro do jsonb
-- string, e o cast o relê como objeto.
UPDATE contatos
   SET campos = (campos #>> '{}')::jsonb
 WHERE jsonb_typeof(campos) = 'string';

-- ── 2. contatos.campos gravado como ARRAY de strings ────────────────────────
-- Dois ou mais envios empilhados. Cada elemento é um objeto serializado; o
-- conserto é reabrir todos e fundir num objeto só.
--
-- A ORDEM IMPORTA e respeita a regra original: o código fazia `novos || campos`,
-- onde o operando da DIREITA vence — ou seja, o valor JÁ GRAVADO permanece e só
-- chave inédita entra ("no contato existente nenhum dado bom é sobrescrito").
-- No array, o `||` foi empilhando o novo à ESQUERDA, então o índice MAIOR é o
-- mais antigo. Agregando em ordem crescente, o último a entrar no
-- jsonb_object_agg é o mais antigo — e é ele que vence, como antes.
UPDATE contatos c
   SET campos = coalesce(sub.mesclado, '{}'::jsonb)
  FROM (
    SELECT c2.id,
           (SELECT jsonb_object_agg(kv.key, kv.value)
              FROM jsonb_array_elements(c2.campos) WITH ORDINALITY AS el(item, pos)
              CROSS JOIN LATERAL jsonb_each(
                CASE WHEN jsonb_typeof(el.item) = 'string'
                     THEN (el.item #>> '{}')::jsonb
                     ELSE el.item
                END
              ) AS kv
             WHERE jsonb_typeof(
                     CASE WHEN jsonb_typeof(el.item) = 'string'
                          THEN (el.item #>> '{}')::jsonb
                          ELSE el.item
                     END
                   ) = 'object'
           ) AS mesclado
      FROM contatos c2
     WHERE jsonb_typeof(c2.campos) = 'array'
  ) AS sub
 WHERE c.id = sub.id;

-- ── 3. oportunidades.campos, pelo mesmo motivo ──────────────────────────────
-- Hoje não há linha afetada (a captação nunca chegou a gravar campo de
-- oportunidade), mas o INSERT tinha o mesmo defeito — então a limpeza fica
-- escrita para o caso de alguma linha ter escapado.
UPDATE oportunidades
   SET campos = (campos #>> '{}')::jsonb
 WHERE jsonb_typeof(campos) = 'string';

-- ── 4. webhook_recebimentos.payload ─────────────────────────────────────────
-- O log de depuração ("mandei e não chegou") e a fonte da aba Métricas, que
-- cruza o payload recebido com os campos declarados para achar chave que chega
-- e é descartada. Guardado como string, esse cruzamento não acha chave nenhuma.
UPDATE webhook_recebimentos
   SET payload = (payload #>> '{}')::jsonb
 WHERE jsonb_typeof(payload) = 'string';

-- ── Conferência ─────────────────────────────────────────────────────────────
-- Depois de rodar, os três devem devolver só 'object' (ou nada):
--   SELECT jsonb_typeof(campos),  count(*) FROM contatos      WHERE campos  IS NOT NULL GROUP BY 1;
--   SELECT jsonb_typeof(campos),  count(*) FROM oportunidades WHERE campos  IS NOT NULL GROUP BY 1;
--   SELECT jsonb_typeof(payload), count(*) FROM webhook_recebimentos         GROUP BY 1;
