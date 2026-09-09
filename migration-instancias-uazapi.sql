-- ============================================================================
-- Migration: cadastro de instâncias uazapi em Configurações.
-- Revise e rode você mesmo (psql, painel do Neon, etc.). Nada aqui apaga dado.
--
-- POR QUE: hoje só existe UMA instância configurada, direto no .env
-- (UAZAPI_BASE_URL/UAZAPI_TOKEN) — o que já sabemos ser limitado, pois a
-- arckwpp (compartilhada com o SprintHub) e a "teste crm" já são duas. Esta
-- tabela deixa o CRM saber de várias instâncias e dar nome a cada uma; o
-- token só é gravado depois de confirmado contra a própria uazapi (GET
-- /instance/status), então não entra lixo aqui.
--
-- ESCOPO DESTA MIGRATION: só o cadastro/nome. O envio/recebimento (lib/uazapi.ts,
-- app/api/uazapi/webhook) continua lendo do .env — trocar isso é outro passo,
-- de propósito não incluído aqui.
-- ============================================================================

CREATE TABLE instancias_uazapi (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                 text NOT NULL UNIQUE,
  base_url             text NOT NULL,
  token                text NOT NULL UNIQUE,
  -- Confirmados no momento de conectar, via GET {base_url}/instance/status.
  -- numero pode ficar NULL se a instância ainda não tiver WhatsApp pareado.
  numero               text,
  instancia_uazapi_id  text,
  data_criacao         timestamptz NOT NULL DEFAULT now()
);
