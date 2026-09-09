# Conectar no n8n — o que precisa existir

Complementa `docs/automacoes-arquitetura.md` (revisão de 2026-07-27, modelo por
inscrição) e `schema-automacoes.sql`.

---

## 1. A decisão que define tudo: quem fala com a uazapi

Antes de listar credencial, é preciso escolher por onde a mensagem sai. As duas
opções mudam radicalmente quantas credenciais o n8n precisa.

### Opção A — n8n fala direto com a uazapi

O nó de WhatsApp do workflow chama `POST {UAZAPI}/send/text`.

Precisa: credencial da uazapi dentro do n8n, credencial de e-mail dentro do n8n,
e credencial de banco (ou API) para o n8n escrever contato/oportunidade.

**Consequências ruins, e uma delas é um bug de produto:**

- Mensagem enviada por automação **não aparece no chat do CRM**. O envio pela
  tela grava em `mensagens` antes de disparar (é o que `app/chat` faz hoje); o
  n8n não faria isso. O atendente veria o cliente respondendo a uma mensagem
  que não existe na conversa.
- A normalização de telefone (`lib/telefone.ts`) teria que ser reimplementada em
  expressão do n8n.
- O rate limit da §2.2 fica impossível de garantir: com dois emissores, nenhum
  dos dois sabe o total. E a instância `arckwpp` é compartilhada com o SprintHub.
- Regras de negócio (etapa pertence ao funil, FK composta do `schema.sql`)
  precisariam ser respeitadas por fora do CRM.

### Opção B — n8n chama o CRM de volta *(recomendada)*

Todo bloco com efeito vira um **HTTP Request para uma rota do CRM**, autenticado
por token de serviço. O CRM faz o trabalho como sempre fez.

```text
Inscrição na tela
   └─> CRM cria fluxo_execucoes
        └─> POST no webhook do workflow no n8n
             └─> n8n orquestra a ordem, os desvios e as esperas
                  └─> a cada bloco: POST de volta em /api/automacoes/acao
                       └─> CRM envia pela uazapi, grava em mensagens,
                           atualiza a oportunidade, respeita o rate limit
```

O n8n vira o que você queria desde o começo: **motor de execução, não integrador**.
Ele guarda ordem, condição e espera. Nada mais.

Ganhos diretos: uma credencial só no n8n; mensagem de automação aparece no chat;
rate limit num ponto único; trocar o n8n por outro motor não mexe em nenhuma
integração — só em quem chama `/api/automacoes/acao`.

**O resto deste documento assume a Opção B.**

---

## 2. Variáveis de ambiente (no CRM)

```bash
# ── CRM → n8n ───────────────────────────────────────────────────────────────
# Instância do n8n. A API pública responde em {N8N_BASE_URL}/api/v1.
N8N_BASE_URL=https://n8n.suaempresa.com.br
# Chave da API pública do n8n (Settings → n8n API). Header X-N8N-API-KEY.
N8N_API_KEY=<secreto>

# ── n8n → CRM ───────────────────────────────────────────────────────────────
# URL pública do CRM. O compilador assa isto nos nós de HTTP Request, então o
# n8n precisa alcançar este endereço — em desenvolvimento, um túnel.
CRM_BASE_URL=https://crm.suaempresa.com.br
# Token que o n8n manda de volta. Gere com: openssl rand -hex 32
CRM_SERVICE_TOKEN=<secreto>
```

Nenhum destes vai para o navegador — sem `NEXT_PUBLIC_`.

## 3. O que cadastrar dentro do n8n (uma vez)

**Habilitar a API pública.** Settings → n8n API → gerar chave. Confirme que a
sua edição/licença libera isso; varia por versão. É só isso.

### Como os nós autenticam de volta — decisão de 2026-09-04

O `Authorization: Bearer <CRM_SERVICE_TOKEN>` vai **escrito direto no header de
cada HTTP Request**, montado pelo adaptador a partir do `.env`. Não há credencial
cadastrada no n8n e a tabela `motor_credenciais` fica vazia.

O caminho alternativo — credencial `Header Auth` no n8n, com o CRM guardando só
o id em `motor_credenciais` — está implementado no schema mas **não é usado**.
Ele foi descartado por ser um passo manual na UI do motor antes de qualquer
publicação funcionar.

O que a escolha custa, e é bom ter escrito:

- **O token viaja em texto no JSON do workflow.** A instância é compartilhada
  (§5.1): quem abrir o workflow lê o token. Credencial do n8n seria mascarada;
  parâmetro de nó não é.
- Com esse token dá para chamar `/api/automacoes/acao` e **reexecutar blocos de
  fluxos publicados** — na prática, reenviar mensagem para contatos. Não dá para
  injetar texto novo (a config é lida da versão publicada, ver §4).
- **Trocar o `CRM_SERVICE_TOKEN` exige republicar todos os fluxos.** Os
  workflows já publicados seguem mandando o token antigo, e o CRM responde 401.

Para voltar ao caminho da credencial, é `cabecalhoDoCrm()` no adaptador e a
linha correspondente em `motor_credenciais`.

## 4. Rotas que o CRM precisa expor

Route Handlers, não Server Actions: quem chama é externo.

| Rota | Método | Quem chama | Para quê |
|---|---|---|---|
| `/api/automacoes/acao` | POST | n8n | Executa um bloco (enviar WhatsApp, atualizar oportunidade…) e devolve o resultado |
| `/api/automacoes/callback` | POST | n8n | Fim de execução: sucesso, erro e qual nó falhou |
| `/api/automacoes/cron` | POST | agendador | Esperas vencidas, reconciliação de execuções `perdidas`, partição do mês |

Todas exigem `Authorization: Bearer <CRM_SERVICE_TOKEN>`, comparado em **tempo
constante** (`crypto.timingSafeEqual`) — comparação com `===` vaza o token por
tempo de resposta.

`/api/automacoes/acao` recebe **só ponteiros**: `execucao_id`, `fluxo_id` e
`no_id`. O `tipo` e a `config` do bloco **não viajam** — o CRM os lê da versão
que aquela execução inscreveu. Dois motivos, os dois descobertos ligando isso:

1. **Colisão de sintaxe.** O `jsonBody` do HTTP Request node é uma expressão do
   n8n, e ele avalia `{{ … }}` dentro dela. Uma mensagem com `{{primeiro_nome}}`
   seria avaliada *lá*, onde a variável não existe, e chegaria vazia.
2. **Confiança.** Quem tivesse o token poderia mandar qualquer texto para
   qualquer contato. Lendo da versão publicada, o pior que um corpo forjado faz
   é reexecutar um bloco que já existe.

De quebra, republicar a cadência não muda o que quem já está dentro dela vai
receber.

É também aqui que entram o rate limit (§2.2) e a allowlist do `requisicao_http`
(§2.3).

## 5. O que o compilador gera

Um workflow n8n por fluxo publicado:

- **Webhook node** na entrada, caminho determinístico (`chroma/fluxo/<fluxo_id>`),
  validando `motor_webhook_segredo` no header.
  O webhook liga direto no primeiro bloco da corrente: **uma entrada só**.

  Houve aqui um Switch "Começar em", que lia `comecar_em` do corpo e mandava a
  execução direto para um bloco do meio — era o que sustentava o arraste de
  cards entre as mensagens da cadência. Funcionou (verificado na instância em
  2026-09-08: modo `expression` com `numberOutputs` + `output`, execução
  entrando na 3ª mensagem), e foi removido junto com o arraste por decisão de
  produto — ver `docs/cadencia-etapa.md`. Fica registrado porque o formato do
  parâmetro custou a ser descoberto, e é o que se usaria para reintroduzi-lo.
- **HTTP Request node** por bloco de ação, apontando para
  `{CRM_BASE_URL}/api/automacoes/acao`, com o header `Authorization` montado do
  `CRM_SERVICE_TOKEN` (ver §3).
- **IF / Switch node** para `se` e `alternador`.
- **Wait node** para `esperar` e `verificar_resposta`.
- **HTTP Request final** para `/api/automacoes/callback`.

Tudo isso vive **só** em `lib/automacoes/motores/n8n/`. A regra que torna a troca
de motor verificável continua valendo: a string `"n8n"` não pode aparecer fora
desse diretório, e dá para checar isso em CI com um grep.

## 5.1 A instância é compartilhada — regra de convivência

`hostinger-n8n.fe8diu.easypanel.host` **não é uma instância dedicada ao Chroma**.
Em 2026-07-27 tinha 10 workflows, 4 ativos, incluindo automação de produção da
empresa: landing pages, RD Station, disparo de WhatsApp e vários fluxos do
SprintHub.

O CRM cria, atualiza e ativa workflows por API. Um adaptador descuidado derruba
automação que a empresa depende. Regras não-negociáveis:

- **Só toca workflow cujo id esteja em `fluxos.motor_workflow_id`.** Nunca
  resolver por nome, nunca varrer `GET /workflows` para decidir o que mexer.
- **Nenhum `DELETE` fora desse conjunto.** Nem em "limpeza", nem em migração.
- **Prefixo no nome** (`[Chroma] <nome do fluxo>`) serve para humano identificar
  na interface do n8n — não para o código encontrar. Identidade é o id.
- A reconciliação da §2.5 compara hash **dos workflows que são nossos**; um
  workflow desconhecido não é divergência, é de outra pessoa.

Já existe um `[Disparo Wpp]` ativo enviando WhatsApp. Somado à instância uazapi
compartilhada com o SprintHub, o rate limit da §2.2 tem que assumir **outro
emissor no mesmo número** — o CRM não é o único que dispara.

## 6. API do n8n — confirmado na instância (2026-07-27)

Testado contra `hostinger-n8n.fe8diu.easypanel.host` com um workflow descartável,
criado e apagado pelo próprio teste:

| Chamada | Resultado |
|---|---|
| `POST /workflows` sem `active` no corpo | **200**, criado com `active: false` |
| `POST /workflows/:id/activate` | **200**, `active: true` |
| `PUT /workflows/:id` | **200** — é o verbo certo |
| `PATCH /workflows/:id` | **405** — não use |
| `GET /executions?workflowId=&limit=` | **200** |
| `POST /workflows/:id/deactivate` | **200** |

O adaptador em `lib/automacoes/motores/n8n/adaptador.ts` já segue isso: cria sem
`active`, ativa em chamada separada, atualiza com `PUT`.

Continua valendo: **não dependa de polling do `/executions`** como caminho
principal. O callback é a fonte; o polling fica só para reconciliar as `perdidas`.

Independente da versão: **não dependa de polling do `/executions`** como caminho
principal. O callback é a fonte; o polling fica só para reconciliar as `perdidas`.

## 7. Ordem de implementação

1. ✅ Aplicar `schema-automacoes.sql`.
2. ⬜ **Autenticação do CRM (§3.1 — continua bloqueante).** Nada abaixo
   substitui isto: as server actions de publicar e disparar seguem sendo POST
   anônimos para quem souber o id.
3. ✅ `/api/automacoes/acao` + token de serviço, em tempo constante
   (`lib/automacoes/servico.ts`). Executa hoje: `enviar_whatsapp_web`,
   `enviar_notificacao`, `atualizar_oportunidade`, `mudar_tag`. O resto
   responde `pulado` com o motivo, em vez de derrubar a execução.
4. ✅ Adaptador n8n: criar, atualizar, ativar workflow, e disparar o webhook
   de produção (`dispararWebhook`).
5. ✅ Compilador. Golden tests ainda não existem; o que existe é o teste de ida
   e volta da cadência (colunas → fluxo → colunas).
6. ✅ `/api/automacoes/callback`: fecha a execução. O estado final sai dos
   PASSOS gravados, não do que o corpo do POST afirma — um callback forjado não
   consegue marcar como sucesso uma execução que errou.
7. ✅ `enviar_whatsapp_web` ligado, com as duas travas que este documento pedia:
   - **modo simulação**, `AUTOMACOES_DISPARAR` — enquanto não for `"true"`, tudo
     roda menos a chamada à uazapi;
   - **rate limit**, `AUTOMACOES_MSGS_POR_MINUTO` (padrão 12), contado sobre
     `fluxo_execucao_passos` do último minuto.

### O que ainda falta para o disparo real funcionar

Verificado no banco em 2026-09-04:

- `N8N_BASE_URL` e `N8N_API_KEY` não estão no `.env`. Sem elas não há como
  publicar nem disparar.
- `CRM_SERVICE_TOKEN` **está** no `.env`, e é o que os nós vão carregar. Se
  faltar, `publicar` recusa em vez de gerar nós com `Bearer undefined`.
- `CRM_BASE_URL` precisa ser um endereço que o n8n alcance. Em desenvolvimento,
  um túnel — o compilador assa esse valor dentro de cada nó.

## 8. Segurança do webhook de entrada — em aberto

O `motor_webhook_segredo` é gerado, gravado e **enviado** no header
`x-chroma-segredo` a cada disparo. Nada do lado do motor o confere: o Webhook
node sem credencial aceita qualquer POST que acerte o caminho.

O caminho é `chroma/fluxo/<uuid do fluxo>`, o que é barreira de adivinhação, não
de autenticação. Quem descobrir a URL consegue criar execuções. Fechar isso pede
uma credencial Header Auth no próprio Webhook node — outra linha em
`motor_credenciais`, e o adaptador passando a referenciá-la.
