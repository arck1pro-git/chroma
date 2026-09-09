-- ============================================================================
-- Migration: as conversas com a IA passam a ficar no banco.
-- Revise e rode você mesmo (psql, painel do Supabase, etc.). Nada aqui apaga dado.
--
-- POR QUE: até agora o histórico do painel de IA vivia no localStorage do
-- navegador (app/components/chat-ia.tsx). Isso significava que a conversa sumia
-- ao limpar o cache, não existia em outro navegador e não podia ser lida por
-- mais ninguém. A lista de conversas com nome, no topo do painel, já existia —
-- o que faltava era onde guardá-las.
--
-- SEM DONO, de propósito: o CRM ainda não tem sessão (docs/automacoes-arquitetura
-- §3.1), então não há de quem seja uma conversa. Quem abrir o app vê a lista
-- inteira. A coluna usuario_id fica aqui, nula, para quando houver login: aí é
-- um UPDATE, não uma migration de estrutura.
--
-- O QUE ISSO CUSTA, e é bom estar escrito: o que você perguntar à IA fica
-- visível para qualquer um que abrir o CRM, e as perguntas carregam contexto do
-- funil (nomes de oportunidade, valores). É a mesma exposição que qualquer
-- outra tela do CRM tem hoje — nenhuma delas pede login.
-- ============================================================================

CREATE TABLE ia_conversas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Qual painel de IA. Hoje: 'funil' (a conversa da tela inicial), 'automacoes'
  -- (o editor de fluxo) e 'cadencia:<uuid do fluxo>' (o painel de uma etapa).
  -- É o que hoje é a prop `armazem` do componente — a conversa sobre o funil e
  -- a que monta uma cadência não se misturam na mesma lista.
  escopo        text NOT NULL,

  -- Primeira pergunta, cortada. É o nome que aparece na lista.
  titulo        text NOT NULL,

  -- A conversa inteira: [{"papel":"eu"|"ia","texto":"…"}, …].
  --
  -- jsonb e não uma tabela de falas: a tela sempre lê e grava a conversa
  -- COMPLETA (é o histórico que ela manda ao modelo a cada pergunta), então uma
  -- linha por mensagem só acrescentaria um join sem ninguém para consumi-lo.
  -- O preço, e ele é real: cada resposta reescreve a linha toda, e buscar
  -- dentro do texto depois vira consulta em jsonb.
  falas         jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Para quando existir login. Sem FK enquanto não há quem preencher.
  usuario_id    uuid,

  data_criacao     timestamptz NOT NULL DEFAULT now(),
  -- Ordena a lista: conversa mexida agora vai para o topo, como em qualquer
  -- chat. Quem atualiza é a aplicação, a cada gravação de fala.
  data_atualizacao timestamptz NOT NULL DEFAULT now()
);

-- O caminho quente é um só: "as conversas deste painel, mais recentes
-- primeiro". Índice composto porque filtrar por escopo e ordenar por data são
-- a mesma consulta.
CREATE INDEX ix_ia_conversas_escopo
  ON ia_conversas (escopo, data_atualizacao DESC);
