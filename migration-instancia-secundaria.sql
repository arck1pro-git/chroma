-- ============================================================================
-- O NÚMERO SECUNDÁRIO (pedido dele em 2026-10-30): uma instância do WhatsApp Web
-- pode ter uma secundária, que assume os envios quando a principal cai (fica
-- vermelha: desconectada na uazapi) e devolve quando ela volta. Vale para o
-- chat, a IA, as cadências, as automações e os avisos (lib/uazapi-reserva.ts).
--
-- O MODELO, escolha dele: UMA COLUNA na secundária apontando para a principal
-- que ela cobre ("cada uma cobre uma principal"), em vez de uma marca global
-- principal/secundária, porque o CRM tem vários números e cada um pode ter o
-- seu reserva. Sem a coluna preenchida, a instância é principal (ou um número
-- comum, sem reserva).
--
--   · cada principal tem no máximo UMA secundária (índice único parcial);
--   · uma instância não é secundária de si mesma (CHECK);
--   · encadear (secundária de uma secundária, ou principal que já tem reserva
--     virando reserva de outra) é recusado em Configurações
--     (app/configuracoes/acoes-whatsapp.ts), não aqui.
--
-- ON DELETE SET NULL: apagar a principal deixa a secundária como número comum,
-- com as conversas dela intactas.
--
-- Nada aqui apaga dado. Pode rodar de novo (IF NOT EXISTS / DROP IF EXISTS).
-- ============================================================================

ALTER TABLE instancias_uazapi
  ADD COLUMN IF NOT EXISTS secundaria_de uuid
    REFERENCES instancias_uazapi (id) ON DELETE SET NULL;

ALTER TABLE instancias_uazapi DROP CONSTRAINT IF EXISTS ck_instancia_secundaria_de_si;
ALTER TABLE instancias_uazapi
  ADD CONSTRAINT ck_instancia_secundaria_de_si CHECK (secundaria_de IS NULL OR secundaria_de <> id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_instancia_uma_secundaria
  ON instancias_uazapi (secundaria_de) WHERE secundaria_de IS NOT NULL;

COMMENT ON COLUMN instancias_uazapi.secundaria_de IS
  'A principal que esta instância cobre: quando a principal está desconectada na uazapi e esta, conectada, os envios saem por esta. Nulo = principal ou número comum.';
