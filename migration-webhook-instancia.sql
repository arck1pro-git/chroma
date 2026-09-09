-- ============================================================================
-- Migration: atendimento passa a ser por (contato, instância), não só contato.
-- Revise e rode você mesmo (psql, painel do Neon, etc.). Nada aqui apaga dado.
--
-- POR QUE: o Chroma pode vir a receber webhook de mais de um número nosso (hoje
-- só a instância de teste "teste crm" 554788060306; a arckwpp compartilhada com
-- o SprintHub pode entrar depois). Se o mesmo contato externo falar com os dois
-- números, isso são DUAS conversas, não uma — por isso o atendimento passa a ser
-- identificado por (contato_id, numero_instancia), não só contato_id.
--
-- numero_instancia é NULLABL: atendimento criado pela UI (agente iniciando
-- manualmente) ou de canal que não é whatsapp continua sem esse conceito.
-- ============================================================================

ALTER TABLE atendimentos
  ADD COLUMN numero_instancia text;

-- Acelera a busca do handler por "atendimento aberto deste contato NESTA
-- instância" a cada mensagem recebida.
CREATE INDEX ix_atendimentos_contato_instancia
  ON atendimentos (contato_id, numero_instancia);
