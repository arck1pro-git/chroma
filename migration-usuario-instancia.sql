-- O número de WhatsApp (instância da uazapi) de cada pessoa — a relação
-- usuário↔API. Pedido dele (2026-10-05): a cadência pode enviar "pelo
-- responsável", e aí cada mensagem sai do número do RESPONSÁVEL DA
-- OPORTUNIDADE, resolvido na hora do envio (app/api/automacoes/enviar).
--
-- UMA COLUNA EM `usuarios`, e não o contrário nem uma tabela de ligação
-- (escolha dele): cada pessoa aponta para UM número de envio, e várias pessoas
-- podem dividir o mesmo — o SDR e o closer saindo do número do comercial. Sem
-- "qual dos três números dela" na hora de mandar.
--
-- NULO É O NORMAL: quem não vende não envia. A cadência ligada no responsável
-- NÃO cai em outro número quando a pessoa não tem um (decisão dele): a
-- mensagem não sai e a execução registra o erro com o nome de quem falta.
--
-- ON DELETE SET NULL: apagar a instância em Configurações desliga quem
-- apontava para ela, em vez de travar a exclusão. A mensagem seguinte dessas
-- pessoas falha com o motivo escrito — o mesmo que acontece com "sem número".
--
-- Não confundir com `usuarios.whatsapp` (migration-usuario-whatsapp.sql):
-- aquele é o número PARA ONDE se avisa a pessoa; este é o número DE ONDE a
-- pessoa fala com o lead.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS instancia_id uuid
    REFERENCES instancias_uazapi (id) ON DELETE SET NULL;

COMMENT ON COLUMN usuarios.instancia_id IS
  'Número de WhatsApp (instância da uazapi) de onde a cadência envia em nome desta pessoa, quando a cadência está ligada no responsável da oportunidade. Nulo = não envia por ela.';
