-- Anexos das demandas: foto ou documento (2026-10-15).
--
-- Só os três campos que ele definiu: id, nome e a demanda. O resto sai de
-- outros lugares, de propósito:
--   · o ARQUIVO mora no Supabase Storage, bucket PRIVADO `crm-demandas`, e o
--     nome do objeto É o id desta linha (sem coluna de caminho);
--   · o TIPO sai da extensão do nome — foto chega sempre como .webp, porque o
--     navegador comprime antes de subir (app/demandas/anexos-envio.ts);
--   · quem pode adicionar ou tirar é quem criou a DEMANDA (a mesma regra de
--     editar), então o anexo não precisa guardar autor.
--
-- Na demanda "para todos" (uma linha por pessoa), cada cópia tem a sua linha e
-- o seu objeto — o servidor copia o arquivo dentro do Storage. É o que deixa
-- apagar uma cópia sem mexer no arquivo das outras. O "mesmo anexo" nas cópias
-- é o de mesmo nome, como o mesmo passo do checklist é o de mesma posição.
--
-- Rodar ANTES do deploy que traz os anexos.

CREATE TABLE IF NOT EXISTS demanda_anexos (
  -- Sorteado pelo servidor antes do upload (o objeto no bucket tem este nome).
  id         uuid PRIMARY KEY,
  demanda_id uuid NOT NULL REFERENCES demandas(id) ON DELETE CASCADE,
  -- O nome do arquivo como aparece na tela (e no download).
  nome       text NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_demanda_anexos_demanda ON demanda_anexos (demanda_id);
