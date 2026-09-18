-- Biblioteca de documentos: sobe o arquivo UMA vez, usa em qualquer lugar.
--
-- POR QUE ESTA TABELA EXISTE: até aqui, mandar um PDF para um lead significava
-- ter o arquivo na máquina de quem estava atendendo. Não havia onde guardar a
-- tabela de preços, a planta, o contrato-modelo — então cada pessoa mandava a
-- versão que tinha na pasta dela, e ninguém sabia qual era a atual. O pedido é
-- o oposto: um lugar só, e de lá para a cadência e para o chat.
--
-- UMA TABELA, sem pastas e sem tags (decisão do dono do produto). Buscar por
-- nome resolve enquanto forem dezenas de documentos; pasta é uma segunda tela
-- para manter (criar, renomear, mover) e não se paga com esse volume. Quando
-- pagar, a coluna nova entra aqui sem mexer em quem lê — ninguém consulta
-- `documentos` por outra coisa que não o id.
--
-- O ARQUIVO NÃO ESTÁ AQUI, só o caminho relativo dele — mesmo desenho de
-- `mensagens.midia_caminho` (lib/midia.ts), e pelo mesmo motivo: trocar disco
-- por bucket vira troca de adaptador, não migração de schema.

CREATE TABLE IF NOT EXISTS documentos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Como a pessoa chama o arquivo ("Tabela de preços 2026"), que quase nunca é
  -- o nome do arquivo ("tab_precos_v4_FINAL2.pdf"). É por este que se procura
  -- na hora de anexar, então é ele que é obrigatório.
  nome         text NOT NULL CHECK (btrim(nome) <> ''),
  descricao    text,

  -- ── O arquivo ────────────────────────────────────────────────────────────
  -- Nome ORIGINAL, preservado porque é o que o lead vê no WhatsApp quando o
  -- anexo é documento (`docName` da uazapi). Renomear o documento na tela não
  -- muda o que chega do outro lado, e isso é de propósito: quem recebe espera
  -- "contrato.pdf", não o rótulo interno do CRM.
  arquivo_nome text NOT NULL,
  -- Relativo, sob DOCUMENTOS_DIR. NUNCA absoluto: o caminho vai para o banco e
  -- é lido em qualquer SO e em qualquer máquina.
  caminho      text NOT NULL,
  mime         text NOT NULL,
  tamanho      bigint NOT NULL CHECK (tamanho > 0),

  -- O que a uazapi precisa saber para escolher entre mandar como foto, como
  -- vídeo, como áudio ou como documento. Derivado do mime na hora de subir
  -- (lib/documentos.ts) e guardado porque é consultado a cada envio — recalcular
  -- a partir do mime em toda leitura seria a mesma regra escrita em dois lugares.
  tipo         text NOT NULL
                 CHECK (tipo IN ('imagem','video','audio','documento')),

  criado_por   uuid REFERENCES usuarios (id) ON DELETE SET NULL,
  data_criacao timestamptz NOT NULL DEFAULT now(),

  -- Arquivar é o "excluir" de uso diário: some dos seletores de anexo, e o que
  -- já foi enviado continua íntegro. Excluir de verdade existe e é outra coisa
  -- — ver a FK logo abaixo, que é quem impede apagar o arquivo de um histórico.
  arquivado    boolean NOT NULL DEFAULT false
);

-- A lista da tela: os não arquivados, do mais novo para o mais velho. É a
-- ÚNICA consulta que a tela faz sem id, então é a única que merece índice.
CREATE INDEX IF NOT EXISTS ix_documentos_ativos
  ON documentos (data_criacao DESC)
  WHERE arquivado = false;

-- Dois documentos com o mesmo nome tornam a escolha na tela um chute — é a
-- mesma razão do ux_contextos_nome. `lower()` porque "Tabela de Preços" e
-- "tabela de preços" são o mesmo documento para quem procura.
CREATE UNIQUE INDEX IF NOT EXISTS ux_documentos_nome
  ON documentos (lower(btrim(nome)))
  WHERE arquivado = false;


-- ── A mensagem que carregou um documento ────────────────────────────────────
--
-- ON DELETE RESTRICT, e a escolha é o ponto: com SET NULL, excluir um documento
-- esvaziaria em silêncio o anexo de conversas JÁ ENVIADAS — o histórico passaria
-- a mostrar uma mensagem de mídia sem mídia, e nada no CRM diria por quê.
-- Histórico de atendimento não se reescreve. Com RESTRICT o Postgres recusa, e
-- a tela manda arquivar em vez de excluir (app/documentos/acoes.ts).
--
-- Também é o que permite NÃO copiar o arquivo a cada envio: a mensagem aponta
-- para o documento da biblioteca. Mandar a mesma tabela de preços para 300 leads
-- guarda um arquivo, não 300.
ALTER TABLE mensagens
  ADD COLUMN IF NOT EXISTS documento_id uuid
    REFERENCES documentos (id) ON DELETE RESTRICT;

-- Sem isto, a FK acima faz o Postgres varrer `mensagens` inteira a cada
-- exclusão de documento para conferir o RESTRICT — e `mensagens` é a tabela que
-- mais cresce no app.
CREATE INDEX IF NOT EXISTS ix_mensagens_documento
  ON mensagens (documento_id)
  WHERE documento_id IS NOT NULL;

-- `ck_mensagens_midia` exigia caminho ou URL de origem para tudo que não fosse
-- texto — as duas colunas que uma mensagem de saída com documento da biblioteca
-- não tem, porque o arquivo dela está em `documentos`, não na fila de download
-- do webhook. Sem esta linha, mandar um PDF pelo chat viola o CHECK e a
-- mensagem não é gravada.
ALTER TABLE mensagens DROP CONSTRAINT IF EXISTS ck_mensagens_midia;
ALTER TABLE mensagens
  ADD CONSTRAINT ck_mensagens_midia CHECK (
    tipo = 'texto'
    OR midia_caminho IS NOT NULL
    OR midia_url_origem IS NOT NULL
    OR documento_id IS NOT NULL
    OR midia_estado = 'erro'
  ) NOT VALID;


-- ── Onde o resto disto vive ─────────────────────────────────────────────────
--
--   · lib/documentos.ts          — storage em disco, tipo por mime, CRUD
--   · app/documentos/            — a tela do módulo
--   · app/api/documentos         — POST do upload (server action topa em 1 MB)
--   · app/api/documentos/[id]    — entrega o arquivo, com sessão
--   · lib/uazapi.ts              — enviarMidia(), POST {BASE}/send/media
--   · app/api/automacoes/enviar  — o anexo da cadência, pedido pelo motor
--
-- DEPOIS DE RODAR: marque quem vê o módulo em /configuracoes/acessos. Ele nasce
-- sem ninguém, como todo módulo novo (lib/auth/modulos.ts).
