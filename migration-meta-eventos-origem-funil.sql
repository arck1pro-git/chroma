-- ============================================================================
-- O pixel da MARCA do funil como origem do evento (2026-10-19). Lead sem pixel
-- e sem conjunto com pixel (formulário instantâneo, Typebot, importação) vai
-- para o pixel do funil — PIXEL_DA_MARCA em lib/meta-eventos.ts.
--
-- A trava antiga só aceitava 'lead' e 'conjunto', e o registro falhava DEPOIS
-- de o evento já ter saído para a Meta: o evento chegava e o CRM o marcava
-- como erro. Rodar no DEV e no PROD. Pode rodar mais de uma vez.
-- ============================================================================

ALTER TABLE meta_eventos DROP CONSTRAINT IF EXISTS meta_eventos_pixel_origem_check;
ALTER TABLE meta_eventos ADD CONSTRAINT meta_eventos_pixel_origem_check
  CHECK (pixel_origem IN ('lead', 'conjunto', 'funil'));
