# Módulo de Automações — análise e arquitetura

Documento de projeto.
Base: repositório Chroma em 2026-07-27 (Next 16.2.10, React 19.2.4, postgres.js, Supabase).

---

> ## ⚠ Revisão de 2026-07-27 — o modelo mudou para INSCRIÇÃO
>
> O fluxo **não reage mais a evento**. Ele recebe inscrições: um contato ou uma
> oportunidade é *adicionado* ao fluxo e a execução começa no nó de entrada.
> Não existe bloco de gatilho.
>
> **Seções abaixo que ficaram superadas:**
>
> | Seção | Situação |
> |---|---|
> | §1.4 — acoplamento nos gatilhos | Superada. Não há gatilho para acoplar |
> | §3.2 — barramento de eventos | Superada em quase tudo. Sobrou só "acordar quem espera resposta", que virou consulta direta a `fluxo_esperas` |
> | §3.3 — projeção de gatilhos | Superada. `fluxo_gatilhos` não existe |
> | §4.4 — DDL | **Substituído por [`schema-automacoes.sql`](../schema-automacoes.sql)** |
> | §5.2 — campo `gatilho` no JSON | Superado. `DefinicaoFluxo` não tem `gatilho`; a raiz é o nó `__entrada__` |
> | §5.5 — catálogo de blocos | Superado. Ver `lib/automacoes/catalogo.ts` — 15 blocos, sem gatilhos |
> | §2.1 — laço infinito | **Muito reduzido**: nada dispara sozinho. Sobra só a cadeia de "Mudar fluxo", coberta por `profundidade`/`raiz_execucao_id` |
>
> **Continua valendo integralmente:** §1.2 (grafo, não lista), §1.3 (contrato de
> semântica por bloco), §1.5 (Server Action × Route Handler), §1.6 (`after` não é
> fila), §2.2 (fan-out na uazapi), §2.3 (SSRF), §2.4 (crescimento dos logs),
> §2.5 (divergência CRM × n8n), §2.6 (duplo disparo), §3.1 (**autenticação
> continua bloqueante**), §3.4 (compilador puro), §5.3 (expressões próprias),
> §6 (compilador e pipeline de publicação), §7 (estrutura do projeto).
>
> A conexão com o n8n e as credenciais estão em [`docs/automacoes-n8n.md`](automacoes-n8n.md).

---

---

## 0. Divergências entre a proposta e o repositório

Antes de qualquer decisão de arquitetura, sete premissas do documento original não
batem com o que existe no projeto. Todas mudam alguma escolha adiante.

| # | Proposta | Realidade do repositório | Consequência |
|---|---|---|---|
| 1 | "NeonDB (PostgreSQL)" | `.env` aponta para **Supabase**, pooler de transação (6543, pgbouncer). `lib/db.ts` documenta a migração | Muda a decisão sobre Prisma (item 2) |
| 2 | Prisma ORM | **postgres.js**, com `prepare:false`, `fetch_types:false`, `max:12` — configuração que existe porque o pooler *deadlockava* e penduava rotas por ~30s | Adotar Prisma é refazer essa briga. Ver §4.1 |
| 3 | `src/modules/...`, nomes em inglês | `app/` e `lib/` na raiz, **tudo em português** (`contatos`, `oportunidades`, `funis`, `etapas`) | Estrutura proposta forkaria a convenção. Ver §7 |
| 4 | `FlowExecutions.lead_id` | Não existe "lead". Existem `contatos`, `oportunidades`, `atendimentos` | Execução precisa de sujeito polimórfico. Ver §4.3 |
| 5 | shadcn/ui, Zustand, React Hook Form | Nada disso instalado. UI é feita à mão (`app/components/filtros-ui.tsx`), Tailwind v4, paleta zinc, lucide | shadcn traria um segundo design system. Ver §7.3 |
| 6 | — | **Não existe autenticação nenhuma** no app. Sem middleware, sem sessão | Bloqueante. Ver §3.1 |
| 7 | — | `app/automacoes/page.tsx` é um placeholder `ModuloEmBreve` | Ponto de partida limpo, sem migração |

Uma observação de fato, não de estilo: o item 6 não é um detalhe a resolver depois.
Um módulo que executa `HTTP Request` e `Enviar WhatsApp` sob demanda, exposto sem
login, é um proxy de requisições e um disparador de mensagens aberto à internet.

---

## 1. Análise crítica da arquitetura proposta

### 1.1 O que está certo e deve ser mantido

- **CRM como fonte da verdade, n8n como executor burro.** Correto e é a decisão
  mais importante do documento. Tudo abaixo preserva isso.
- **Nunca persistir JSON do n8n.** Correto.
- **Compilador isolado.** Correto, mas insuficiente como está — ver §1.3.
- **Versionamento por imutabilidade.** Correto na intenção, errado na modelagem
  proposta — ver §4.2.

### 1.2 O `steps: []` não expressa o fluxo que você mesmo desenhou

Este é o erro estrutural mais concreto do documento. O JSON de exemplo é uma lista
linear:

```json
{ "trigger": "novo_lead", "steps": [ {"type":"if"}, {"type":"send_whatsapp"} ] }
```

Mas o diagrama logo abaixo tem duas saídas:

```text
[ Status = Novo ]
     ├──── Sim ──► [Enviar WhatsApp]
     └──── Não ──► [Criar tarefa]
```

Uma lista não representa isso. Você precisaria de aninhamento (`then`/`else`
recursivos), e aninhamento quebra na primeira vez que dois ramos precisarem
convergir de volta para o mesmo passo — o que acontece sempre.

**Decisão: o formato tem que ser um grafo dirigido (nós + arestas rotuladas),
não uma árvore nem uma lista.** Ver §5.

### 1.3 "Trocar o n8n depois" não é garantido por isolar o compilador

O compilador isolado garante que *o formato de saída* é substituível. Não garante
que a **semântica** é. Repare nos blocos pedidos:

- `Delay` / `Esperar Evento` — no n8n é o Wait node (execução parcial persistida,
  com limites da instância). No Temporal é um timer durável. Num motor próprio é o
  que você escrever. As três coisas têm garantias diferentes de sobrevivência a
  restart, de exatamente-uma-vez e de duração máxima.
- `Executar Outro Fluxo` — sub-workflow com contexto herdado? Fire-and-forget?
  Espera o retorno?

Se o significado de "esperar 30 minutos" for definido implicitamente por "o que o
n8n faz", trocar de motor muda o comportamento dos fluxos já publicados em
silêncio — que é o pior modo de falha possível.

**Decisão: cada bloco precisa de um contrato de semântica escrito** (§5.4). O
motor não define o comportamento; ele é obrigado a implementá-lo ou a recusar a
compilação.

### 1.4 O acoplamento perigoso está nos gatilhos, não nos nós

O diagrama sugere que cada workflow no n8n tem seu próprio trigger. Se
`novo_lead` virar um trigger do n8n, você tem duas opções ruins: o n8n faz polling
no banco do CRM (n8n passa a conhecer seu schema — acoplamento pior que o do JSON)
ou você cria um webhook por fluxo e espalha a lógica de "quais fluxos disparam
para este evento" entre CRM e n8n.

**Decisão: o CRM é dono do barramento de eventos.** O n8n só tem um Webhook node
genérico na entrada. Quem decide *quais* fluxos casam com um evento é o CRM. Ver §3.2.

Ganho colateral: você já tem a semente disso. A tabela `historico` registra
"o que aconteceu" com contato e oportunidade, e é escrita nos pontos certos.

### 1.5 Server Actions não servem para tudo aqui

A orientação "sempre que possível usar Server Actions" bate em duas restrições
documentadas do Next 16 (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`):

- **Despacho sequencial por cliente.** "Next.js dispatches Server Actions one at a
  time per client." Autosave do builder via Server Action enfileira atrás de
  qualquer outra ação em voo. Num canvas com autosave a cada mudança, isso trava.
- **Limite de 1MB no corpo** por padrão.

**Decisão:** Server Actions para comandos discretos (publicar, ativar, restaurar
versão, arquivar). Route Handler para autosave/rascunho do builder e para
ingestão de callbacks. Ver §7.2.

### 1.6 `after()` não é fila de jobs

`after()` (`docs/01-app/03-api-reference/04-functions/after.md`) roda dentro do
`maxDuration` da rota e existe para efeitos colaterais curtos. Ele **não**
sobrevive ao fim da invocação, não tem retry e não tem garantia de entrega.

Publicar no n8n dentro de um `after` funciona no caminho feliz. Se a chamada
falhar depois do commit no banco, o CRM acha que publicou e o n8n não tem o
workflow — divergência silenciosa entre fonte da verdade e executor.

**Decisão: padrão outbox + reconciliação.** Ver §6.3.

---

## 2. Problemas futuros que a proposta ainda não endereça

Ordenados por quanto doem quando acontecem.

### 2.1 Laço infinito de automação (crítico)

Fluxo com gatilho `oportunidade_atualizada` cuja ação é atualizar a oportunidade.
Ele dispara a si mesmo. Com `Executar Outro Fluxo`, dois fluxos fazem o ciclo
entre si e nenhum dos dois parece errado isoladamente.

Mitigações, todas necessárias:
- Toda escrita feita por automação carrega `origem = 'automacao'` e o
  `execucao_id` que a causou.
- Gatilhos ignoram, por padrão, eventos de origem `automacao` (com opção explícita
  de não ignorar, para quem sabe o que está fazendo).
- Profundidade máxima por cadeia (`profundidade`, `raiz_execucao_id` na execução).
- Orçamento por entidade: no máximo N execuções por contato/oportunidade por
  janela de tempo.

### 2.2 Fan-out destrutivo (crítico, e específico do seu caso)

Importar 5.000 contatos emite 5.000 eventos `contato_criado`. Se houver um fluxo
de boas-vindas por WhatsApp, são 5.000 disparos pela uazapi.

Dois agravantes reais deste projeto:
- A uazapi é **WhatsApp não-oficial**. Volume súbito é o caminho mais curto para
  banir o número.
- Memória do projeto: **a instância `arckwpp` é compartilhada com o SprintHub**. O
  estrago não fica contido neste CRM.

Mitigações: rate limit por canal (não por fluxo), janela de silêncio configurável,
detecção de importação em lote (evento `contato_criado` com `origem = 'importacao'`
não dispara fluxos por padrão), e um "modo simulação" obrigatório antes da
primeira publicação de qualquer fluxo que envie mensagem.

### 2.3 SSRF pelo bloco HTTP Request (crítico enquanto não houver login)

`HTTP Request` e `Chamar Webhook` transformam o CRM num proxy. Se a requisição
sair do n8n, ela sai de dentro da sua rede.

Mitigações: allowlist de domínios por instalação, bloqueio de faixas privadas
(`10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `127/8`, IPv6 equivalentes),
resolução de DNS antes da chamada para impedir rebinding, sem seguir redirects
para fora da allowlist, timeout e teto de tamanho de resposta.

### 2.4 A tabela de logs de execução é a que explode

Um passo por nó, com payload de entrada e saída, para cada execução. Cem fluxos
ativos, cinco nós cada, mil eventos por dia = 500 mil linhas/dia com JSON dentro.

Mitigações: partição por mês em `fluxo_execucao_passos`, política de retenção
explícita (detalhado 30 dias, agregado para sempre), truncamento de payload com
teto por linha e **redação de PII** — esses payloads vão conter telefone, e-mail e
conteúdo de conversa.

### 2.5 Divergência entre CRM e n8n

Alguém com acesso ao n8n edita um workflow na mão. Agora o executor não corresponde
a nenhuma versão do CRM.

Mitigação: guardar o hash do JSON compilado na publicação; job de reconciliação
compara com o que está no n8n e sinaliza (ou recompila) a divergência. É por isso
que `fluxo_publicacoes` existe como tabela separada em §4.

### 2.6 Duplo disparo

Webhook retentado, deploy no meio de uma execução, clique duplo em "Publicar".
Mandar a mesma mensagem de WhatsApp duas vezes é dano visível ao cliente.

Mitigação: chave de idempotência de ponta a ponta — `UNIQUE (fluxo_id, evento_id)`
em `fluxo_execucoes`, e `evento_id` propagado até a chamada da uazapi.

### 2.7 Migração de fluxos publicados quando o formato mudar

Você vai mudar o schema do JSON (v1 → v2). Existem fluxos publicados em v1 rodando.

Mitigação: `schema` versionado dentro do próprio JSON, funções de migração
`v1→v2` puras e testadas, e recompilação em massa disparada por versão do
compilador (por isso `compilador_versao` está na publicação).

---

## 3. Melhorias de arquitetura propostas

### 3.1 Fase 0 obrigatória: autenticação

Não é escopo do módulo de automações, mas é pré-requisito dele. Enquanto não
existir sessão e autorização, cada Server Action nova é um endpoint POST público
— e a documentação do próprio Next é explícita: *"the route is reachable to anyone
who can send the same POST. Treat every action as an untrusted entry point."*

Mínimo viável antes de publicar o primeiro fluxo: sessão, `usuarios` virando
tabela de verdade (hoje `responsavel_id` e `autor_id` são uuid solto sem FK, como
o próprio `schema.sql` documenta), e verificação de permissão dentro de cada action.

### 3.2 Barramento de eventos do CRM (a mudança estrutural mais importante)

```text
Escrita no CRM (server action / webhook uazapi / importação)
        │
        ▼
  eventos_dominio            ← append-only, na MESMA transação da escrita
        │
        ▼
  Despachante                ← casa evento × gatilhos publicados
        │
        ├─ nenhum fluxo casa → marca processado, fim
        │
        ▼
  fluxo_execucoes (criada ANTES de chamar o motor)
        │
        ▼
  Adaptador do motor  ──►  n8n (Webhook node genérico)
```

Por que isto é melhor que configurar triggers no n8n:

- O n8n nunca vê o banco do CRM. O acoplamento cai para um POST com JSON.
- A regra "quais fluxos rodam para este evento" fica em SQL, testável, no CRM.
- Trocar de motor é trocar o adaptador, não os gatilhos.
- O evento persistido dá replay: reprocessar um dia inteiro vira um `UPDATE`.
- Filtro de gatilho roda no CRM, antes de acordar o motor — barato e observável.

Escrever em `eventos_dominio` na mesma transação da mudança de negócio é o que
garante que não existe evento perdido nem evento sem fato correspondente.

### 3.3 Projeção de gatilhos

Buscar dentro de `definicao->'trigger'` de cada fluxo publicado a cada evento não
escala. Na publicação, o gatilho é extraído para `fluxo_gatilhos` — tabela rasa,
indexada por `tipo`. O despacho vira um índice, não um scan de JSONB.

É uma projeção derivada: reconstruída na publicação, nunca editada à mão.

### 3.4 Compilador como função pura versionada

```ts
compilar(definicao: DefinicaoFluxo, ctx: ContextoCompilacao): WorkflowMotor
```

Sem I/O, sem `Date.now()`, sem acesso a banco — tudo que ele precisa entra por
`ctx` (mapa de credenciais, URL base, ids de fluxo). Consequências práticas:

- Testável por golden files: definição → JSON esperado, diff no PR.
- Determinística: mesmo input, mesmo output, logo o **hash do compilado detecta
  divergência** (§2.5).
- `compilador_versao` permite recompilar tudo depois de corrigir um bug de geração.

### 3.5 Posições automáticas: não

O documento pede "gerar posições automáticas" no compilador. As posições vêm do
builder, onde o usuário arrastou os blocos, e devem viajar no `layout` do JSON do
CRM (§5.2). O compilador só as traduz. Layout calculado é para o caso em que o
fluxo foi criado por API sem passar pelo builder — um fallback, não o caminho.

Mais importante: **`layout` fica fora do bloco de lógica** para que mover um nó na
tela não gere diff semântico ao comparar versões.

---

## 4. Modelagem do banco

### 4.1 Sobre o Prisma — recomendação contrária, com o porquê

Você pediu Prisma. Entrego o schema em §4.5, mas a recomendação é **manter
postgres.js**, pelos seguintes motivos verificáveis neste repositório:

1. `lib/db.ts` documenta que o pooler de transação do Supabase (pgbouncer)
   deadlockava com `Promise.all` e pendurava rotas por ~30s, resolvido com
   `prepare:false` + `fetch_types:false` + `max:12`. Prisma tem a mesma classe de
   problema e exige `?pgbouncer=true` na URL.
2. `prisma migrate` **não funciona pelo pooler de transação** — exige `directUrl`
   numa conexão direta (5432). São duas conexões a manter e um modo de falha novo
   em produção.
3. `next.config.ts` já tem `serverExternalPackages: ["postgres"]` porque o
   bundler quebrava o driver. Prisma tem exigências próprias de bundling.
4. O schema atual é SQL escrito à mão, comentado, com restrições que Prisma não
   expressa bem: a FK composta `(etapa_id, funil_id)` que impede colar um card do
   funil A numa etapa do funil B, e os `CHECK` de `status`/`canal`. Migrar para
   Prisma perde ou degrada essas garantias.

O que você ganharia com Prisma — tipos gerados e migrations versionadas — dá para
ter sem ele: tipos derivados do schema à mão (já é o padrão do projeto) e
migrations em SQL numerado, que o projeto já começou (`migration-front.sql`).

**Se ainda assim quiser Prisma**, o caminho menos ruim é adotá-lo *só* no módulo de
automações, com `directUrl` configurado, aceitando dois clientes de banco no
processo. §4.5 traz o schema equivalente.

### 4.2 Correção no versionamento proposto

A proposta tem `definition_json` em `Flows` **e** em `FlowVersions`. Isso duplica
o dado e as duas cópias vão divergir — é uma questão de tempo.

Modelo correto: `fluxos` guarda metadado e **ponteiros**; `fluxo_versoes` guarda
definições imutáveis. "Restaurar v2" não reescreve nada: cria a v5 com o conteúdo
da v2. O histórico nunca perde um passo.

### 4.3 Correção no sujeito da execução

`lead_id` não existe. Uma execução pode ser sobre um contato, uma oportunidade, um
atendimento — ou nenhum (gatilho de agendamento). Modelado como par
`(entidade_tipo, entidade_id)`, sem FK, pelo mesmo motivo que `historico` já
convive com `autor_id` sem FK.

### 4.4 DDL proposto

Convenções seguidas do `schema.sql` existente: português, `snake_case`, uuid com
`gen_random_uuid()`, `timestamptz`, `data_criacao`, comentário explicando o porquê
de cada decisão não óbvia.

```sql
-- ============================================================================
-- Automações
--
--   fluxo  1 ── N  fluxo_versoes      (versão é imutável; editar cria outra)
--   fluxo  1 ── N  fluxo_publicacoes  (tentativa de publicar uma versão)
--   fluxo  1 ── N  fluxo_gatilhos     (projeção do gatilho, p/ despacho indexado)
--   fluxo  1 ── N  fluxo_execucoes
--   execucao 1 ── N fluxo_execucao_passos
-- ============================================================================

CREATE TABLE fluxos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  descricao     text,

  -- rascunho: nunca publicado | publicado: tem versão ativa no motor
  -- pausado: publicado mas não dispara | arquivado: fora de uso, mantido p/ log
  estado        text NOT NULL DEFAULT 'rascunho'
                  CHECK (estado IN ('rascunho','publicado','pausado','arquivado')),

  -- Ponteiros, não cópias. A definição vive só em fluxo_versoes (ver §4.2).
  versao_rascunho_id  uuid,
  versao_publicada_id uuid,

  -- Qual motor executa. Existe desde já para a troca futura não virar migração.
  motor            text NOT NULL DEFAULT 'n8n',
  motor_workflow_id text,

  data_criacao     timestamptz NOT NULL DEFAULT now(),
  data_atualizacao timestamptz NOT NULL DEFAULT now(),
  arquivado_em     timestamptz
);

-- Um fluxo só pode ter um workflow por motor: barra publicação duplicada por
-- clique repetido (§2.6). Parcial porque motor_workflow_id é NULL até publicar.
CREATE UNIQUE INDEX ux_fluxos_motor_workflow
  ON fluxos (motor, motor_workflow_id)
  WHERE motor_workflow_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Versões: imutáveis. Nunca UPDATE em definicao — restaurar cria versão nova.
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_versoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fluxo_id     uuid NOT NULL REFERENCES fluxos (id) ON DELETE CASCADE,
  numero       integer NOT NULL,
  definicao    jsonb NOT NULL,

  -- sha256 do definicao canonicalizado. Evita gravar versão nova quando o
  -- autosave reenvia conteúdo idêntico, e serve de chave de comparação.
  hash         text NOT NULL,

  -- de qual versão esta saiu: dá a árvore de "restaurado a partir de v2"
  origem_versao_id uuid REFERENCES fluxo_versoes (id),
  notas        text,
  criado_por   uuid,
  data_criacao timestamptz NOT NULL DEFAULT now(),

  UNIQUE (fluxo_id, numero)
);

CREATE INDEX ix_fluxo_versoes_fluxo ON fluxo_versoes (fluxo_id, numero DESC);

ALTER TABLE fluxos
  ADD CONSTRAINT fk_fluxos_versao_rascunho
    FOREIGN KEY (versao_rascunho_id)  REFERENCES fluxo_versoes (id),
  ADD CONSTRAINT fk_fluxos_versao_publicada
    FOREIGN KEY (versao_publicada_id) REFERENCES fluxo_versoes (id);

-- ----------------------------------------------------------------------------
-- Publicações: auditoria de cada tentativa de levar uma versão ao motor.
-- Guarda o hash do COMPILADO — é como se detecta que alguém editou o workflow
-- direto no n8n (§2.5).
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_publicacoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fluxo_id          uuid NOT NULL REFERENCES fluxos (id) ON DELETE CASCADE,
  versao_id         uuid NOT NULL REFERENCES fluxo_versoes (id),
  motor             text NOT NULL,
  motor_workflow_id text,
  compilador_versao text NOT NULL,
  compilado_hash    text NOT NULL,
  estado            text NOT NULL DEFAULT 'pendente'
                      CHECK (estado IN ('pendente','sucesso','erro')),
  erro              text,
  data_criacao      timestamptz NOT NULL DEFAULT now(),
  concluido_em      timestamptz
);

CREATE INDEX ix_fluxo_publicacoes_fluxo ON fluxo_publicacoes (fluxo_id, data_criacao DESC);

-- ----------------------------------------------------------------------------
-- Gatilhos: projeção derivada da definicao publicada (§3.3). Reconstruída a cada
-- publicação, nunca editada à mão. Existe só para o despacho ser um índice.
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_gatilhos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fluxo_id    uuid NOT NULL REFERENCES fluxos (id) ON DELETE CASCADE,
  versao_id   uuid NOT NULL REFERENCES fluxo_versoes (id),
  tipo        text NOT NULL,
  filtro      jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- eventos causados por automação não disparam gatilho por padrão (§2.1)
  aceita_origem_automacao boolean NOT NULL DEFAULT false,
  ativo       boolean NOT NULL DEFAULT true
);

CREATE INDEX ix_fluxo_gatilhos_tipo ON fluxo_gatilhos (tipo) WHERE ativo;

-- ----------------------------------------------------------------------------
-- Eventos de domínio: append-only, gravado na MESMA transação da escrita que o
-- causou (§3.2). É a fila e o histórico de replay ao mesmo tempo.
-- ----------------------------------------------------------------------------
CREATE TABLE eventos_dominio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          text NOT NULL,
  entidade_tipo text NOT NULL CHECK (entidade_tipo IN ('contato','oportunidade','atendimento','tarefa','sistema')),
  entidade_id   uuid,

  -- 'usuario' | 'automacao' | 'webhook' | 'importacao' | 'sistema'
  origem        text NOT NULL DEFAULT 'usuario',
  -- execução que causou este evento; alimenta o guarda de laço (§2.1)
  origem_execucao_id uuid,

  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_criacao  timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz,
  tentativas    smallint NOT NULL DEFAULT 0
);

-- Índice do despachante: a fila é "não processado, mais antigo primeiro".
CREATE INDEX ix_eventos_pendentes
  ON eventos_dominio (data_criacao) WHERE processado_em IS NULL;
CREATE INDEX ix_eventos_entidade
  ON eventos_dominio (entidade_tipo, entidade_id, data_criacao DESC);

-- ----------------------------------------------------------------------------
-- Execuções. Criada ANTES de chamar o motor: se o motor não responder, existe
-- linha 'perdida' para reconciliar — em vez de silêncio.
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_execucoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fluxo_id      uuid NOT NULL REFERENCES fluxos (id) ON DELETE CASCADE,
  versao_id     uuid NOT NULL REFERENCES fluxo_versoes (id),
  evento_id     uuid REFERENCES eventos_dominio (id),

  entidade_tipo text,
  entidade_id   uuid,

  motor              text NOT NULL,
  motor_execucao_id  text,

  estado        text NOT NULL DEFAULT 'pendente'
                  CHECK (estado IN ('pendente','rodando','sucesso','erro','cancelada','esperando','perdida')),
  erro_no       text,     -- id do nó que falhou, no formato do CRM
  erro_msg      text,

  -- guarda de laço (§2.1)
  profundidade      smallint NOT NULL DEFAULT 0,
  raiz_execucao_id  uuid,

  iniciado_em   timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  duracao_ms    integer
);

-- Idempotência de ponta a ponta: um evento gera no máximo uma execução por
-- fluxo, por mais que o webhook seja retentado (§2.6).
CREATE UNIQUE INDEX ux_execucao_por_evento
  ON fluxo_execucoes (fluxo_id, evento_id) WHERE evento_id IS NOT NULL;

CREATE INDEX ix_execucoes_fluxo    ON fluxo_execucoes (fluxo_id, iniciado_em DESC);
CREATE INDEX ix_execucoes_entidade ON fluxo_execucoes (entidade_tipo, entidade_id, iniciado_em DESC);
CREATE INDEX ix_execucoes_estado   ON fluxo_execucoes (estado) WHERE estado IN ('pendente','rodando','esperando');

-- ----------------------------------------------------------------------------
-- Passos: um por nó executado. É a tabela que cresce (§2.4) — particionar por
-- mês e aplicar retenção. Payloads truncados e com PII redigida.
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_execucao_passos (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  execucao_id  uuid NOT NULL,
  no_id        text NOT NULL,     -- id do nó no JSON do CRM, não do n8n
  no_tipo      text NOT NULL,
  ordem        smallint NOT NULL,
  estado       text NOT NULL CHECK (estado IN ('sucesso','erro','pulado')),
  entrada      jsonb,
  saida        jsonb,
  erro         text,
  iniciado_em  timestamptz NOT NULL DEFAULT now(),
  duracao_ms   integer,

  PRIMARY KEY (id, iniciado_em)
) PARTITION BY RANGE (iniciado_em);

CREATE INDEX ix_passos_execucao ON fluxo_execucao_passos (execucao_id, ordem);

-- ----------------------------------------------------------------------------
-- Esperas ativas: delay e espera-por-evento. Mesmo com o n8n segurando a
-- execução, o CRM precisa saber para exibir "aguardando até X" e para poder
-- retomar sozinho quando o motor mudar (§1.3).
-- ----------------------------------------------------------------------------
CREATE TABLE fluxo_esperas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id    uuid NOT NULL REFERENCES fluxo_execucoes (id) ON DELETE CASCADE,
  no_id          text NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('tempo','evento')),
  retomar_em     timestamptz,
  evento_tipo    text,
  evento_filtro  jsonb,
  estado         text NOT NULL DEFAULT 'ativa'
                   CHECK (estado IN ('ativa','retomada','expirada','cancelada')),
  data_criacao   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_esperas_tempo  ON fluxo_esperas (retomar_em) WHERE estado = 'ativa' AND tipo = 'tempo';
CREATE INDEX ix_esperas_evento ON fluxo_esperas (evento_tipo) WHERE estado = 'ativa' AND tipo = 'evento';

-- ----------------------------------------------------------------------------
-- Credenciais do motor: MAPA, não cofre. O segredo vive no n8n; aqui só o
-- apelido usado no JSON do CRM e o id correspondente no motor.
-- ----------------------------------------------------------------------------
CREATE TABLE motor_credenciais (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave          text NOT NULL,     -- 'whatsapp_principal', 'smtp_marketing'
  motor          text NOT NULL,
  motor_cred_id  text NOT NULL,
  motor_cred_tipo text NOT NULL,
  data_criacao   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (motor, chave)
);
```

### 4.5 Equivalente em Prisma

Caso opte por Prisma apesar de §4.1. `@@map`/`@map` preservam os nomes em
português no banco, então convive com o SQL acima.

```prisma
// datasource precisa das DUAS urls: pooler para runtime, direta para migrate
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")        // 6543 + ?pgbouncer=true
  directUrl = env("DATABASE_DIRECT_URL") // 5432, exigida por prisma migrate
}

model Fluxo {
  id                String    @id @default(uuid()) @db.Uuid
  nome              String
  descricao         String?
  estado            String    @default("rascunho")
  versaoRascunhoId  String?   @map("versao_rascunho_id") @db.Uuid
  versaoPublicadaId String?   @map("versao_publicada_id") @db.Uuid
  motor             String    @default("n8n")
  motorWorkflowId   String?   @map("motor_workflow_id")
  dataCriacao       DateTime  @default(now()) @map("data_criacao") @db.Timestamptz
  dataAtualizacao   DateTime  @updatedAt @map("data_atualizacao") @db.Timestamptz
  arquivadoEm       DateTime? @map("arquivado_em") @db.Timestamptz

  versoes     FluxoVersao[]
  execucoes   FluxoExecucao[]
  gatilhos    FluxoGatilho[]
  publicacoes FluxoPublicacao[]

  @@unique([motor, motorWorkflowId])
  @@map("fluxos")
}

model FluxoVersao {
  id             String   @id @default(uuid()) @db.Uuid
  fluxoId        String   @map("fluxo_id") @db.Uuid
  numero         Int
  definicao      Json
  hash           String
  origemVersaoId String?  @map("origem_versao_id") @db.Uuid
  notas          String?
  criadoPor      String?  @map("criado_por") @db.Uuid
  dataCriacao    DateTime @default(now()) @map("data_criacao") @db.Timestamptz

  fluxo     Fluxo           @relation(fields: [fluxoId], references: [id], onDelete: Cascade)
  execucoes FluxoExecucao[]

  @@unique([fluxoId, numero])
  @@index([fluxoId, numero(sort: Desc)])
  @@map("fluxo_versoes")
}

// FluxoExecucao, FluxoExecucaoPasso, EventoDominio, FluxoGatilho,
// FluxoPublicacao, FluxoEspera e MotorCredencial seguem o mesmo padrão de
// mapeamento a partir do DDL de §4.4.
```

Limitações a aceitar se for por aqui: índices parciais (`WHERE ativo`), partição
por range e os `CHECK` só existem via `migrate --create-only` editado à mão.

---

## 5. Formato do JSON do CRM

### 5.1 Princípios

1. **Grafo, não lista** (§1.2).
2. **Versionado no próprio documento** — `schema: "chroma.flow/v1"`.
3. **Ids estáveis** de nó (nanoid), nunca índice de array: o diff entre versões
   precisa sobreviver a reordenação.
4. **Zero vocabulário de motor.** Nenhum `typeVersion`, `credentials`, `position`
   no formato do n8n.
5. **Layout separado da lógica.**

### 5.2 Estrutura

```jsonc
{
  "schema": "chroma.flow/v1",

  "gatilho": {
    "tipo": "oportunidade_mudou_etapa",
    "filtro": {
      "op": "e",
      "condicoes": [
        { "campo": "oportunidade.funil_id", "operador": "igual", "valor": "uuid-funil" },
        { "campo": "oportunidade.etapa.nome", "operador": "igual", "valor": "Proposta" }
      ]
    },
    "aceita_origem_automacao": false
  },

  // Mapa id → nó. Mapa e não array: aresta referencia por id, e mapa impede
  // id duplicado por construção.
  "nos": {
    "n_cond": {
      "tipo": "se",
      "config": {
        "condicao": {
          "op": "e",
          "condicoes": [
            { "campo": "oportunidade.valor", "operador": "maior_que", "valor": 5000 }
          ]
        }
      }
    },
    "n_zap": {
      "tipo": "enviar_whatsapp",
      "config": {
        "para": "{{ contato.whatsapp }}",
        "template": "proposta_enviada",
        "variaveis": { "nome": "{{ contato.nome }}", "valor": "{{ oportunidade.valor | moeda }}" }
      }
    },
    "n_tarefa": {
      "tipo": "criar_tarefa",
      "config": { "titulo": "Ligar para {{ contato.nome }}", "responsavel": "comercial", "prazo_dias": 1 }
    }
  },

  // Arestas rotuladas: é o que permite os dois ramos do seu diagrama e a
  // convergência de volta ao mesmo nó.
  "arestas": [
    { "de": "__gatilho__", "para": "n_cond" },
    { "de": "n_cond", "para": "n_zap",    "ramo": "verdadeiro" },
    { "de": "n_cond", "para": "n_tarefa", "ramo": "falso" }
  ],

  // Só apresentação. Alterar isto não muda o compilado (§3.5).
  "layout": {
    "n_cond":   { "x": 0,   "y": 0 },
    "n_zap":    { "x": 240, "y": -80 },
    "n_tarefa": { "x": 240, "y": 80 }
  }
}
```

### 5.3 Expressões — a decisão que mais compromete a portabilidade

`{{ contato.nome }}` parece inofensivo. A armadilha é adotar a sintaxe de
expressão do n8n: ela é JavaScript avaliado no motor, e nesse instante todo fluxo
salvo passa a depender do runtime do n8n. Trocar de motor deixaria de ser trocar o
compilador.

**Decisão:** linguagem de expressão própria, mínima e fechada:

- Caminhos de uma allowlist: `contato.*`, `oportunidade.*`, `evento.*`,
  `passos.<no_id>.saida.*`.
- Filtros nomeados de um conjunto fixo: `| moeda`, `| data`, `| maiusculas`,
  `| padrao("—")`.
- Sem chamada de função arbitrária, sem acesso a `process`, sem `eval`.

Duas propriedades que isso compra: é analisável estaticamente (dá para validar no
builder que `{{ contato.cnpj }}` não existe, antes de publicar) e é implementável
em qualquer motor futuro. O compilador traduz para a sintaxe do n8n; se um dia o
motor não suportar, o CRM resolve a expressão antes de despachar.

### 5.4 Contrato de semântica por bloco

Cada tipo de bloco carrega, no catálogo (código, não banco), um contrato que o
adaptador de motor precisa satisfazer:

```ts
{
  tipo: "esperar",
  entradas: 1,
  saidas: ["padrao"],
  durabilidade: "sobrevive_reinicio",   // o motor precisa garantir isto
  duracao_maxima: "30d",
  exatamente_uma_vez: true,
  efeito_colateral: false,
}
```

Um adaptador que não consiga garantir `sobrevive_reinicio` **falha na compilação**
em vez de publicar algo que se comporta diferente. É isto que transforma
"n8n substituível" de intenção em garantia verificável.

### 5.5 Catálogo de blocos

Marcados com `[+]` os que você pediu na última linha (oportunidades) e os que
faltavam para o módulo fechar com o CRM que já existe.

**Gatilhos**

| Tipo | Observação |
|---|---|
| `contato_criado` | o "Novo Lead" — o CRM não tem lead, tem contato |
| `contato_atualizado` | com filtro por campo alterado |
| `contato_tag_adicionada` `[+]` | encaixa no que foi construído em `/contatos` |
| `contato_segmento_adicionado` `[+]` | idem |
| `oportunidade_criada` | "Negócio Criado" |
| `oportunidade_atualizada` | |
| `oportunidade_mudou_etapa` `[+]` | **o mais útil do módulo**; hoje já vira linha em `historico` |
| `oportunidade_mudou_funil` `[+]` | |
| `oportunidade_mudou_responsavel` `[+]` | |
| `oportunidade_ganha` / `oportunidade_perdida` `[+]` | derivados de `status` |
| `oportunidade_valor_alterado` `[+]` | com limiar mínimo, senão vira ruído |
| `oportunidade_parada` `[+]` | sem movimentação há N dias — precisa de agendador, não de evento |
| `tarefa_criada` | depende da entidade tarefa existir (§8, Fase 0) |
| `atendimento_aberto` `[+]` | o chat já existe |
| `mensagem_recebida` `[+]` | via webhook uazapi que já está em produção |
| `webhook` | entrada externa; rota pública com segredo por fluxo |
| `agendamento` | cron |

**Condições**

`se` (duas saídas), `escolher` (n saídas + padrão), `filtro` (corta a execução),
`comparar`, e os operadores `e` / `ou` / `nao` compondo a árvore de condição.
Operadores de campo: `igual`, `diferente`, `contem`, `comeca_com`, `maior_que`,
`menor_que`, `entre`, `vazio`, `preenchido`, `mudou`, `mudou_de_para` `[+]`.

**Ações**

| Tipo | Observação |
|---|---|
| `criar_contato` / `atualizar_contato` / `atualizar_campo` | |
| `adicionar_tag` / `remover_tag` `[+]` | server actions já existem em `app/contatos/actions.ts` |
| `adicionar_segmento` / `remover_segmento` `[+]` | idem |
| `criar_oportunidade` / `atualizar_oportunidade` | |
| `mover_oportunidade_etapa` `[+]` | respeitando a FK composta `(etapa_id, funil_id)` |
| `atribuir_responsavel` `[+]` | com estratégia: fixo, rodízio, menos carregado |
| `marcar_ganha` / `marcar_perdida` `[+]` | com motivo |
| `alterar_valor_oportunidade` `[+]` | |
| `registrar_historico` `[+]` | escreve em `historico`; barato e muito útil |
| `criar_anotacao` `[+]` | |
| `criar_tarefa` | |
| `enviar_whatsapp` | pela uazapi — ver §2.2 antes de habilitar |
| `enviar_email` | |
| `chamar_webhook` / `requisicao_http` | ver §2.3 |
| `esperar` (tempo) / `esperar_evento` | contrato de §5.4 |
| `executar_fluxo` | com guarda de profundidade (§2.1) |
| `parar` `[+]` | encerrar explicitamente com motivo — evita `filtro` usado como saída |

---

## 6. O Flow Compiler

### 6.1 Fronteira

```text
lib/automacoes/
  compilador/
    index.ts          compilar(definicao, ctx) -> WorkflowMotor   [PURO]
    catalogo/         um arquivo por bloco: contrato + gerador de nó
    layout.ts         fallback de posição quando não veio do builder
    expressao.ts      tradução da expressão do CRM p/ a do motor
    __golden__/       definição.json + esperado.json, comparados em teste
  motores/
    n8n/
      adaptador.ts    fala HTTP com a API do n8n            [IMPURO]
      tipos.ts        ÚNICO lugar que conhece o JSON do n8n
```

Regra que torna a substituição verificável: **`lib/automacoes/motores/n8n/` é o
único diretório onde a string `"n8n"` pode aparecer**. Dá para checar em CI com um
grep. Se vazar para o compilador ou para os serviços, a troca de motor deixou de
ser local — e você descobre no PR, não dali a um ano.

### 6.2 Responsabilidades

Ficam no compilador (puro): gerar nós, gerar conexões, traduzir expressões,
resolver apelido de credencial → id via `ctx.credenciais`, calcular layout de
fallback, validar contratos de §5.4.

Ficam no adaptador (I/O): criar, atualizar, ativar, desativar, consultar execução.

Não é do compilador: decidir *quando* publicar, gravar no banco, mexer em cache.

### 6.3 Pipeline de publicação com outbox

O fluxo de sete passos do documento original tem um buraco: se o passo 4 falhar
depois do 1, banco e motor divergem. Corrigido:

```text
1. Validar (Zod + contratos + grafo: sem ciclo, sem nó órfão, sem ramo vazio)
2. TRANSAÇÃO
     grava fluxo_versoes (se o hash mudou)
     grava fluxo_publicacoes (estado='pendente', compilado_hash)
     grava eventos_dominio (tipo='fluxo.publicar', outbox)
   COMMIT                              ← ponto de durabilidade
3. Responde ao usuário: "publicando…"  ← não bloqueia a UI
4. Worker consome o outbox:
     compila → chama o motor → ativa
     sucesso: publicacao='sucesso', fluxos.motor_workflow_id, projeta gatilhos
     erro:    publicacao='erro' + motivo, backoff exponencial, fluxo continua
              na versão publicada ANTERIOR
5. UI reflete o estado real da publicação (poll ou Realtime, que já existe)
```

Nada some porque a chamada HTTP falhou, e nunca existe estado "publicado" no CRM
sem workflow correspondente no motor.

### 6.4 API do n8n — pontos a confirmar na sua instância

Estes detalhes variam por versão e edição do n8n. **Confirme antes de codar o
adaptador**, não assuma daqui:

- Header de autenticação `X-N8N-API-KEY`, base `/api/v1`.
- Se a API pública está habilitada na sua edição/licença.
- Verbo de atualização (`PUT` vs `PATCH` em `/workflows/:id`) e se `active` é
  aceito na criação ou exige `POST /workflows/:id/activate` em seguida.
- Se `GET /executions` traz o detalhe por nó que a tela de logs precisa, ou se o
  callback do próprio workflow terá que enviá-lo.

Recomendação independente da versão: **não dependa de polling do `/executions`**
como caminho principal. Passe o `execucao_id` do CRM no payload do webhook e
termine todo workflow compilado com um nó de callback para uma Route Handler do
CRM. O polling fica como reconciliação de execuções `perdidas`.

---

## 7. Arquitetura do projeto

### 7.1 Estrutura, adaptada ao repositório

A árvore `src/modules/` do documento não existe aqui. Equivalente que respeita a
convenção atual (`app/` + `lib/` na raiz, português):

```text
app/
  automacoes/
    page.tsx                    lista de fluxos
    [id]/page.tsx               builder
    [id]/versoes/page.tsx       histórico, diff, restaurar
    [id]/execucoes/page.tsx     logs (tela estilo n8n)
    acoes.ts                    server actions: publicar, pausar, restaurar
    builder/                    componentes React Flow (client)
  api/
    automacoes/
      rascunho/route.ts         autosave do builder (§1.5)
      callback/route.ts         motor → CRM: fim de execução
      webhook/[token]/route.ts  gatilho webhook público, segredo por fluxo
      cron/route.ts             agendamento, esperas vencidas, reconciliação

lib/
  automacoes/
    tipos/          DefinicaoFluxo, contratos de bloco, tipos de evento
    catalogo/       definição declarativa dos blocos (fonte única do builder,
                    do validador e do compilador)
    validadores/    Zod + validação de grafo
    compilador/     puro (§6.1)
    motores/n8n/    único lugar que conhece o n8n
    eventos/        emissor + despachante
    servicos/       casos de uso (publicarFluxo, restaurarVersao…)
    repositorios/   SQL, postgres.js
```

**O catálogo de blocos é fonte única.** Builder (que blocos existem, que campos o
painel mostra), validador (o que é obrigatório) e compilador (como vira nó do
motor) leem do mesmo lugar. Sem isso, adicionar um bloco vira edição em três
arquivos que saem de sincronia.

### 7.2 Server Actions × Route Handlers

Decidido a partir das restrições de §1.5:

| Caso | Mecanismo | Motivo |
|---|---|---|
| Publicar, pausar, arquivar, restaurar versão | Server Action | comando discreto, revalidação de rota |
| Autosave do rascunho | Route Handler `POST` | despacho serial de actions travaria o canvas |
| Callback do motor | Route Handler | chamador externo |
| Webhook de gatilho | Route Handler | endpoint público |
| Cron | Route Handler | chamador externo |
| Listagem/paginação de logs | Server Component + `searchParams` | leitura, não mutação |

### 7.3 Stack — o que adotar e o que recusar

| Proposto | Decisão |
|---|---|
| React Flow | **Sim.** É a peça central do builder |
| Zod | **Sim.** Valida definição na fronteira; use `z.infer` como fonte do tipo |
| Zustand | **Sim, escopado ao builder.** Estado do canvas (nós, seleção, undo/redo) não pertence a `useState` espalhado. Não usar fora de `app/automacoes/builder/` |
| React Hook Form | **Talvez.** Só se os painéis de configuração ficarem grandes. Os formulários atuais do projeto são `useState` e funcionam |
| shadcn/ui | **Não.** O projeto tem linguagem visual própria e consistente (`filtros-ui.tsx`, chips, zinc, `size-*` do lucide). shadcn traria Radix + um segundo vocabulário de componentes. Extraia os componentes que faltam no estilo que já existe |
| Prisma | **Não** — ver §4.1 |
| `dnd-kit` | Já instalado, usado no funil. Não substitui React Flow no canvas, mas serve para reordenar listas nos painéis |

---

## 8. Roadmap

Fases pensadas para cada uma entregar algo utilizável, e para o risco alto vir
antes do trabalho bonito. A ordem importa: a Fase 3 (builder) é a mais visível e a
mais cara — fazer antes da 1 e 2 é construir a interface de um contrato que ainda
vai mudar.

### Fase 0 — Fundação (bloqueante)

- Autenticação e autorização (§3.1). Sem isso nada de automação vai a produção.
- `usuarios` como tabela real, com FK em `responsavel_id` / `autor_id`.
- Entidade `tarefas` (o catálogo depende dela e ela ainda não existe).
- Decisão registrada: Prisma sim ou não; postgres.js é a recomendação.

*Pronto quando:* existe sessão e uma server action recusa chamador não autenticado.

### Fase 1 — Domínio e eventos, sem interface

- DDL de §4.4 aplicado.
- Emissor de eventos ligado nas escritas que já existem (contatos, oportunidades,
  chat), na mesma transação.
- Despachante casando evento × `fluxo_gatilhos`, ainda sem chamar motor nenhum.
- Tela de eventos só para inspeção interna.

*Pronto quando:* mover um card no funil grava um `oportunidade_mudou_etapa` e o
despachante identifica corretamente que zero fluxos casam.

### Fase 2 — Definição, versionamento e compilador (sem canvas)

- Tipos, catálogo, Zod, validação de grafo.
- CRUD de fluxos + versionamento imutável, editando o JSON num textarea.
- Compilador puro com golden tests para 1 gatilho e 3 ações.
- Adaptador n8n + pipeline de publicação com outbox (§6.3).

*Pronto quando:* um fluxo escrito à mão em JSON é publicado, aparece no n8n e
executa de ponta a ponta. **Aqui o módulo já tem valor**, mesmo feio.

### Fase 3 — Builder visual

- Canvas React Flow, nós customizados no estilo visual do projeto.
- Painel de configuração dirigido pelo catálogo.
- Autosave por Route Handler, undo/redo, validação em tempo real.
- Diff e restauração de versões.

### Fase 4 — Execuções e observabilidade

- Callback do motor, ingestão de passos.
- Tela de execuções com filtro, detalhe por nó, re-executar.
- Reconciliação das `perdidas`; partição e retenção (§2.4).

### Fase 5 — Blocos avançados

- `esperar`, `esperar_evento` (com `fluxo_esperas` e o cron).
- `executar_fluxo` com guarda de profundidade.
- `requisicao_http` com allowlist e bloqueio de faixa privada (§2.3).
- Rodízio de responsável, `escolher` com n saídas.

### Fase 6 — Segurança operacional e escala

- Rate limit por canal, detecção de lote, modo simulação (§2.2).
- Guarda de laço completo (§2.1).
- Redação de PII nos logs.
- Job de reconciliação CRM × n8n por hash (§2.5).

**Sugestão de sequência mínima para valor mais cedo:** 0 → 1 → 2 → 4 → 3. A tela
de execuções (4) antes do builder (3) porque, sem ela, depurar o que o motor fez
é impossível — e você vai precisar disso justamente enquanto constrói o builder.

---

## 9. Resumo das decisões que precisam de você

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Prisma ou postgres.js | postgres.js (§4.1) |
| 2 | Autenticação antes ou depois | Antes. É bloqueante (§3.1) |
| 3 | shadcn/ui | Não; estender o design system atual (§7.3) |
| 4 | Nomenclatura do módulo | Português, como o resto do banco |
| 5 | `steps[]` ou grafo | Grafo (§1.2) |
| 6 | Expressões próprias ou do n8n | Próprias, restritas (§5.3) |
| 7 | Gatilhos no n8n ou no CRM | No CRM, com barramento de eventos (§3.2) |
| 8 | Ordem das fases | 0 → 1 → 2 → 4 → 3 (§8) |
