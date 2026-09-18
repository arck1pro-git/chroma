-- O WhatsApp de quem trabalha aqui — para o CRM AVISAR a pessoa.
--
-- POR QUE AGORA: o bloco "Enviar notificação" existe no catálogo desde o começo
-- (lib/automacoes/catalogo.ts) e nunca fez nada — o adaptador o compilava como
-- No-Op, um nó que o fluxo atravessa sem efeito. A coluna da cadência que diz
-- "Ligação" cai nesse bloco, então uma cadência com passo de ligação prometia
-- avisar alguém e não avisava ninguém.
--
-- Para avisar de verdade falta o óbvio: o número da pessoa. `usuarios` guardava
-- e-mail e senha, nada de telefone — dá para logar, não dá para receber.
--
-- ESTE NÚMERO NÃO É O DO CONTATO, e a diferença importa: `contatos.whatsapp` é
-- de quem compra; este é de quem vende. Podem coincidir (a Patricia está nos
-- dois, porque ela também foi cadastrada como contato um dia) e ainda assim são
-- papéis distintos — apagar o contato não pode calar a notificação dela.
--
-- FORMATO: só dígitos, com DDI, sem separador — o mesmo de `contatos.whatsapp` e
-- de `instancias_uazapi.numero` ('554792137973'). Quem normaliza na entrada é a
-- tela; o casamento com o que o WhatsApp devolve é problema de
-- lib/telefone.ts, que já trata o nono dígito indo e vindo.
--
-- NULO É O NORMAL: a maioria das contas não precisa receber aviso nenhum, e
-- exigir telefone de todo mundo travaria o cadastro de quem só entra para
-- aparecer como responsável. Quem não tem número não pode ser escolhido no
-- bloco — a tela filtra, e o envio recusa com o motivo escrito.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS whatsapp text;

-- Só dígitos e num tamanho plausível. NOT VALID porque a coluna nasce agora e
-- não há linha antiga para varrer; vale para tudo que entrar daqui pra frente.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_whatsapp;
ALTER TABLE usuarios
  ADD CONSTRAINT ck_usuarios_whatsapp CHECK (
    whatsapp IS NULL OR whatsapp ~ '^[0-9]{10,15}$'
  ) NOT VALID;

COMMENT ON COLUMN usuarios.whatsapp IS
  'Número de quem trabalha aqui, para receber notificação da automação. Só dígitos com DDI. Não confundir com contatos.whatsapp, que é o do cliente.';

-- A Patricia, pedida nominalmente: 55 47 9213-7973.
--
-- Doze dígitos, SEM o nono — é como o número foi passado e é como o mesmo
-- telefone já está em `contatos` ('554792137973'). Se o WhatsApp dela estiver no
-- formato novo (5547 9 9213-7973), o envio falha com "número não existe" e a
-- correção é reescrever aqui; lib/telefone.ts resolve o casamento na volta, não
-- na ida.
UPDATE usuarios SET whatsapp = '554792137973' WHERE nome = 'Patricia';
