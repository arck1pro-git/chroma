-- ============================================================================
-- Migration: role do Postgres para o n8n gravar direto.
-- Revise e rode você mesmo (psql, painel do Neon). NADA aqui apaga dado.
--
-- POR QUE EXISTE: a automação deixou de chamar o CRM de volta a cada bloco — o
-- workflow agora fala com a uazapi e escreve no banco pelos próprios nós. Isso
-- mata o túnel, o /api/automacoes/acao e o executor, mas cria um problema novo:
-- o nó Postgres do n8n precisa de credencial.
--
-- E a instância n8n é COMPARTILHADA com a produção do SprintHub
-- (docs/automacoes-n8n.md §5.1). Uma credencial de DONO ali dentro significa
-- que qualquer pessoa com acesso àquele n8n lê a base inteira de contatos e
-- pode apagá-la. Não é hipótese remota: são 10 workflows de gente diferente.
--
-- Este role é o contrário disso. Ele consegue fazer exatamente o que um passo
-- de automação precisa registrar, e mais nada:
--
--   · SELECT no que o workflow lê para montar a mensagem
--   · INSERT em mensagens, atendimentos e nos passos da execução
--   · UPDATE só nas colunas que fecham uma execução
--   · DELETE em lugar nenhum
--   · nada em contatos, oportunidades, tags, segmentos, contextos ou fluxos
--
-- Vazando a credencial, o pior que se faz é gravar mensagem e passo. Não se
-- perde base, não se altera lead, não se apaga histórico.
--
-- ⚠ A SENHA: troque o literal antes de rodar. Ela vai para dentro de uma
-- credencial do n8n e não volta para o .env do CRM.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chroma_n8n') THEN
    CREATE ROLE chroma_n8n LOGIN PASSWORD 'TROQUE_ESTA_SENHA';
  END IF;
END $$;

-- Ponto de partida: nada.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM chroma_n8n;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM chroma_n8n;
REVOKE ALL ON SCHEMA public FROM chroma_n8n;
GRANT USAGE ON SCHEMA public TO chroma_n8n;

-- ── Ler: só o necessário para montar e endereçar a mensagem ─────────────────
-- Note que NÃO é "SELECT em tudo", diferente do role da IA: o workflow não tem
-- por que enxergar anotações, histórico, e-mails ou conversas de IA.
GRANT SELECT ON contatos            TO chroma_n8n;  -- nome e whatsapp do destino
GRANT SELECT ON oportunidades       TO chroma_n8n;  -- variáveis do texto
GRANT SELECT ON etapas              TO chroma_n8n;
GRANT SELECT ON funis               TO chroma_n8n;
GRANT SELECT ON usuarios            TO chroma_n8n;  -- nome do responsável
GRANT SELECT ON atendimentos        TO chroma_n8n;  -- achar a conversa aberta
GRANT SELECT ON instancias_uazapi   TO chroma_n8n;  -- número que envia
GRANT SELECT ON fluxos              TO chroma_n8n;
GRANT SELECT ON fluxo_versoes       TO chroma_n8n;
GRANT SELECT ON fluxo_execucoes     TO chroma_n8n;

-- ── Escrever: só o registro do que a automação fez ──────────────────────────
GRANT INSERT ON mensagens              TO chroma_n8n;  -- a mensagem enviada
GRANT INSERT ON atendimentos           TO chroma_n8n;  -- a conversa, se não existir
GRANT INSERT ON fluxo_execucao_passos  TO chroma_n8n;  -- o passo, para auditoria

-- UPDATE por COLUNA. `mensagens` precisa do casamento com o retorno da uazapi
-- (id_externo + status), e nada além disso: o TEXTO de uma mensagem já enviada
-- não se reescreve, e sem esta lista o n8n poderia reescrevê-lo.
GRANT UPDATE (id_externo, status, erro) ON mensagens TO chroma_n8n;
GRANT UPDATE (data_atualizacao)         ON atendimentos TO chroma_n8n;
-- Fechar a execução — é o que o nó final faz no lugar do antigo /callback.
GRANT UPDATE (estado, finalizado_em, duracao_ms, erro_no, erro_msg, motor_execucao_id)
  ON fluxo_execucoes TO chroma_n8n;

-- ── O que fica explicitamente fora ──────────────────────────────────────────
-- Redundante (nada foi concedido), mas sobrevive a um GRANT ALL distraído.
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM chroma_n8n;
-- O lead em si é intocável pelo motor: ele manda mensagem, não edita cadastro.
REVOKE INSERT, UPDATE ON contatos      FROM chroma_n8n;
REVOKE INSERT, UPDATE ON oportunidades FROM chroma_n8n;
REVOKE ALL ON contato_tags       FROM chroma_n8n;
REVOKE ALL ON contato_segmentos  FROM chroma_n8n;
REVOKE ALL ON contextos          FROM chroma_n8n;
REVOKE ALL ON ia_conversas       FROM chroma_n8n;
GRANT SELECT ON contato_tags      TO chroma_n8n;
GRANT SELECT ON contato_segmentos TO chroma_n8n;

-- Sem DEFAULT PRIVILEGES: tabela nova NÃO nasce visível para o motor. Ao
-- contrário do role da IA, que analisa o CRM inteiro e ganha SELECT por padrão,
-- este aqui só deve enxergar o que alguém decidiu conscientemente mostrar.
