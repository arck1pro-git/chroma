-- Duas leituras que faltavam ao role do motor (chroma_n8n).
--
-- SINTOMA: o lead entrava na etapa, o CRM inscrevia na cadência (o recebimento
-- da webhook dizia "entrou na cadência da etapa"), e nenhuma mensagem saía. No
-- n8n a execução aparecia como `error`, no nó "Ainda inscrito? [msg1]":
--
--   permission denied for table mensagens
--
-- CAUSA: migration-role-n8n.sql concedeu INSERT em `mensagens` — a mensagem que
-- a automação envia — mas não SELECT. E a guarda que roda ANTES de cada envio
-- (GUARDA_INSCRITO, em lib/automacoes/motores/n8n/adaptador.ts) precisa LER a
-- última mensagem da conversa: é assim que a cadência para sozinha quando o
-- lead responde. Sem SELECT, a guarda estoura, o ramo morre antes do envio, e a
-- execução fica `pendente` no CRM para sempre.
--
-- A segunda linha é o mesmo caso, uma casa à frente: MARCAR_PASSO numera o
-- passo com `SELECT count(*) FROM fluxo_execucao_passos`, e o role só tinha
-- INSERT. Corrigida a primeira, o erro apareceria aqui.
--
-- O QUE ISSO ABRE: o motor passa a ler o texto das mensagens dos contatos que
-- ele atende. É o mínimo que a regra "não fale por cima de quem respondeu"
-- exige — ela é uma comparação sobre a última mensagem da conversa. Continua
-- sem DELETE, sem UPDATE de texto e sem enxergar anotações, e-mails ou
-- conversas de IA.

GRANT SELECT ON mensagens             TO chroma_n8n;  -- a guarda de "já respondeu?"
GRANT SELECT ON fluxo_execucao_passos TO chroma_n8n;  -- numerar o passo no INSERT
