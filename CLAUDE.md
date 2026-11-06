@AGENTS.md

# AmaanOffice: guia do projeto para agentes

CRM interno da AMAAN e da Arck1Pro: funis e oportunidades, contatos, chat de WhatsApp, IAs que atendem clientes,
automações (cadências) executadas no n8n, campanhas e anúncios da Meta, blog, demandas da equipe, vídeos
rastreáveis e agenda. O nome interno do repositório e de alguns identificadores ainda é `chroma`.

Responda sempre em português do Brasil. Este arquivo é a fonte das convenções do projeto: quando ele e um hábito
seu divergirem, vale o que está aqui. O diagnóstico da estrutura atual e a direção de organização estão em
[docs/organizacao-do-codigo.md](docs/organizacao-do-codigo.md).

---

## 1. Stack e estrutura

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16.3 (App Router), React 19.2, TypeScript estrito |
| Estilo | Tailwind v4 (paleta zinc), ícones Font Awesome Free Solid por `app/components/icones.tsx`, gráficos `chart.js`; sem biblioteca de componentes |
| Banco | Postgres no Neon, via `postgres.js` (`lib/db.ts`); sem ORM |
| Arquivos | Neon Object Storage, API do S3 (`lib/armazenamento.ts`), buckets privados; Supabase até 2026-11-03 |
| Sessão | JWT HS256 em cookie (`jose`), senha com scrypt |
| Validação | à mão na entrada; `zod` 4 em IA, MCP, Meta Ads, login e configurações |
| IA | SDK da Anthropic; Groq para transcrever áudio; Magnific para voz |
| Hospedagem | Vercel (serverless); gerenciador de pacotes `npm` |

```
app/                  telas, server actions e rotas HTTP (App Router)
  page.tsx            rota raiz: Dashboard + quadro de oportunidades + contatos
  layout.tsx          barra lateral pelos módulos do usuário, tema, IA global do TI
  <modulo>/           uma pasta por módulo (lista em lib/auth/modulos.ts)
  funil/              recursos do quadro usados pela raiz (não tem page.tsx)
  inicio/             peças da tela raiz (quadro, gavetas, cadências, métricas)
  components/         kit visual compartilhado (gaveta, filtros, gráficos, barra lateral)
  configuracoes/      uma ação por assunto: acoes-funis, -tags-segmentos, -usuarios, -campos, -whatsapp, -acessos
  api/                rotas HTTP: interface, IA, webhooks de entrada, serviço do n8n, públicas
  mock/               JSON de demonstração (?demo=...), nunca dado real
  emails/mock.ts      dados de exemplo do módulo E-mails, que ainda não tem tabela
lib/                  regra de negócio, consultas, integrações, tipos e utilitários compartilhados
  db.ts               a conexão com o banco (única)
  entidades.ts        tipos das tabelas (Contato, Oportunidade, Etapa, Mensagem...)
  resultado-acao.ts   contrato de retorno de server action com recusa (ResultadoAcao, Recusa)
  validacao.ts        validação de entrada repetida (ehUuid)
  formato.ts          formatação de dinheiro, data e iniciais (servidor e tela)
  funil.ts            carga do quadro de oportunidades (tela raiz e IA)
  auth/               sessão, DAL (quem é e o que pode), catálogo de módulos, escopo
  ia/                 atendente de WhatsApp, painel de IA, ferramentas, conexão só-leitura
  automacoes/         modelo de fluxo, compilador puro, adaptador do n8n, repositório
  mcp/                conector MCP do Claude (leitura de leads, posts, demandas)
  social/             posts agendados no Instagram e no Facebook
  <dominio>.ts        demais domínios em arquivos por prefixo (meta-*, blog-*, contatos-*...)
extensao-reunioes/    extensão do Chrome do assistente de reuniões (JS puro, sem build; ver LEIAME.md)
proxy.ts              porta da rua: fecha tudo por padrão (o antigo middleware)
next.config.ts        cabeçalhos de segurança, driver do banco fora do bundle
schema.sql            schema base; schema-automacoes.sql; migration-*.sql (raiz, em ordem de criação)
scripts/              operação e verificação, rodados com o runner jiti
docs/                 decisões e arquitetura por assunto
public/               só ícones e o que o app serve; nada de material interno
.claude/              subagentes, skills, hooks e settings do Claude Code (seção 10)
```

Módulos (chave, rota): inicio `/`, chat, contatos, agenda, demandas, metricas, emails, automacoes, campanhas,
templates, blog, webhooks, formularios, documentos, videos, meta, integracoes, financeiro, infra, configuracoes. A rota é
`/<chave>`, exceto inicio. Quem vê cada um é decidido no banco (`departamento_modulos`), não no código. O `blog`
(`docs/blog.md`) é o quadro Pautas → Em revisão → Postado (rótulos de `pendente`/`aprovado`), o desempenho no Search
Console (`lib/blog-google.ts`, a propriedade achada pelo endereço do blog, sem coluna) e a automação de artigos: um
workflow só no n8n, de segunda a sexta às 7h, 2 por blog (`AGENDA_AUTOMACAO`), com a pauta escolhida por IA pela
descrição do blog (`lib/blog-curadoria.ts`); ligar e pausar só pela tela em produção (`lib/blog-automacao.ts`). O `infra`
(`lib/infra*.ts`) lê o uso e o limite de cada serviço externo com as chaves que o CRM já tem. O `financeiro` reúne o
ponto (`lib/ponto.ts`, base guardada 1 minuto na memória), lido da base do app de ponto da equipe (outro sistema, só
leitura, `lib/ponto-db.ts`), e a folha do mês (`lib/financeiro-pagamentos.ts`, conta em `lib/financeiro-tipos.ts`), no
banco do CRM, que a IA (`chroma_ia`) não lê. Sem `?mes=`, a página abre na escolha do mês de competência
(`app/financeiro/escolher-mes.tsx`: os meses com ponto ou lançamento, mais o corrente e o anterior, cada um dizendo se a
folha foi lançada e quantos pagos); não entra sozinha no mês corrente, e "Trocar mês" volta a ela. Com o mês, a página
tem o cabeçalho com o mês, o "Exportar CSV" (a folha do mês
montada no navegador, `app/financeiro/exportar-folha.ts`: `;`, vírgula decimal, BOM, fórmula neutralizada) e o
"Adicionar colaborador", a folha logo abaixo e o Ponto embaixo dela (`#ponto`). Tipo, valor hora, valor mês e taxa diária de
deslocamento ficam gravados no mês lançado (a "foto" em `financeiro_lancamentos`); o cadastro do colaborador guarda o
padrão dos meses ainda não lançados. Deslocamento = taxa × dias com modalidade presencial no ponto; o check
"Contabilizar deslocamento" da gaveta decide se conta: marcado grava R$ 15 (`TAXA_PRESENCIAL` em
`lib/financeiro-tipos.ts`, decidido no servidor), desmarcado grava 0; taxa vazia (cadastro antigo) vale 15. A folha só mostra; o Editar de
cada linha e o "Adicionar colaborador" abrem a gaveta do pagamento por cima (`app/financeiro/gaveta-pagamento.tsx`),
inclusive em mês já lançado. O colaborador da folha vem do app de ponto (o id de lá), de uma conta do AmaanOffice sem
ponto (`amaanoffice:<id do usuário>`) ou de um cadastro feito à mão no "Cadastrar alguém novo" (`manual:<uuid>`, id
sorteado no servidor, nome na coluna `financeiro_colaboradores.nome`), `origemDe` em `lib/financeiro-tipos.ts`. Do ponto
e do AmaanOffice o nome sai da fonte, e a conta com o mesmo e-mail de alguém do ponto não aparece no "Adicionar
colaborador". Cada linha tem três checks do mês (Patricia validou, prestador enviou a NF, pagamento enviado), com
quando e quem em `financeiro_lancamentos` (`validado_*`, `nf_*`, `pago_*`): quem tem Editar marca, em sequência
(`motivoParaNaoMudar` na tela, a mesma ordem no UPDATE de `marcarCheck`). Setor com "Casa" no nome (a casa da Pati,
`ehSetorDaCasa`) vai para o fim da folha e da lista de horas do Ponto.

## 2. Fluxo de execução e pontos de entrada

**Tela:**
1. `proxy.ts` lê o cookie. Rota pública ou de serviço passa; sem sessão, `/login` (tela) ou 401 em JSON (API).
2. `app/layout.tsx` chama `usuarioAtual()` (DAL, memorizado por render) e monta a barra com os módulos da pessoa.
3. `page.tsx` chama `exigirModulo("<chave>")`, carrega dados por `dados.ts` ou `lib/` e entrega ao componente.
4. O componente cliente chama uma server action: guarda, validação, `lib/` ou SQL, `revalidatePath`, retorno.
5. Ao vivo por polling barato: `/api/chat/versao` no chat e `/api/demandas/contagem` na barra (uma aba por
   navegador). Não há Realtime.

**Outras entradas:**

| Entrada | Rotas | Tranca |
|---|---|---|
| Webhooks de mensagem | `/api/uazapi/webhook` (repassado pelo n8n), `/api/meta/whatsapp/webhook`, `/api/meta/instagram/webhook` (DM e comentários) | segredo na URL (uazapi); assinatura `X-Hub-Signature-256` (Meta) |
| Leads da Meta | `/api/meta/leads/webhook` | assinatura `X-Hub-Signature-256` |
| Formulários de sites | `/api/webhooks/[slug]` | slug do webhook |
| Serviço (n8n) | `/api/automacoes/enviar` e `/mover`, `/api/ia/retomar`, `/api/meta/leads/varrer`, `/api/social/publicar`, `/api/chat/agendadas/enviar`, `/api/midia/fila`, `/api/meta/whatsapp/processar`, `/api/blogs/rss/gerar` e `/pauta` | `Authorization: Bearer CRM_SERVICE_TOKEN`, via `autorizado()` |
| Públicas | `/api/publico/[chave]` (blog), `/v/[slug]` e `/api/v/*` (vídeos), `/api/mcp/[segredo]` (Claude) | chave, slug sorteado ou segredo na URL |
| IA de interface | `/api/ia`, `/api/ia/automacoes`, `/api/ia/campanhas`, `/api/ia/webhooks` | sessão; alcance limitado nas ferramentas |
| Extensão de reuniões | `/api/reunioes/assistente/*` (lead da sala, busca, trecho de áudio, análise, resumo, salvar na ficha) | sessão + Origin exato da extensão + módulo Agenda, em `lib/reunioes-extensao.ts`; o lead segue Dashboard/Contatos e o Chat |
| Instalar a extensão | `/api/extensao-reunioes` (o .zip da pasta `extensao-reunioes/`, só os arquivos da extensão; aberto pelo menu da conta na barra lateral) | sessão + módulo Agenda |

Mensagem que chega pelo WhatsApp é gravada e, depois da resposta (`after`), `lib/ia/atendente.ts` decide se a IA
responde. A IA é da etapa (`etapas.ia_id`): atende o lead enquanto ele está numa etapa com IA e para quando o card sai,
inclusive quando a própria IA o move. O interruptor do contato (`contatos.ia`, `lib/ia/contato-ia.ts`) só é ligado por
uma pessoa, na tela do contato ou pela palavra da IA no celular; as exceções são o bloco "Passar para a IA" das campanhas
e a IA de comentários do Instagram. Mensagem de grupo do WhatsApp Web (`@g.us`) vira conversa do grupo (`lib/grupos-whatsapp.ts`, tabela
`grupos_whatsapp`, `atendimentos.grupo_id` com `contato_id` NULL) e nunca passa pela IA; só o chat a lista (LEFT JOIN),
e o que lê conversa com `JOIN contatos` não vê grupo. Conversa fixada (`atendimentos.fixada_em`) vale para a equipe. Envio de mensagem, da equipe ou da IA, passa por `lib/conversa-envio.ts`: grava pendente, envia pela
uazapi, pela Meta ou pelo Instagram (escolha por canal, sem "senão é uazapi"), casa o retorno. Número secundário: no
WhatsApp Web, com a instância vermelha e a secundária dela verde (`instancias_uazapi.secundaria_de`), o envio sai pela
secundária e a mensagem fica na conversa dela com o lead; quem decide é `lib/uazapi-reserva.ts`, a cada envio, também
para cadências, automações e avisos, e a IA lê as conversas do par. Instagram: DM vira
conversa comum (canal 'instagram'); comentários ficam em `instagram_comentarios`; todo envio ao Instagram sai pelo
ponto único de `lib/instagram.ts`; a IA de comentário (`lib/ia/comentarios.ts`) só escolhe frase pública fixa. Automação: a tela desenha o fluxo, `lib/automacoes/compilador` gera o
workflow, `lib/automacoes/motores/n8n/adaptador.ts` publica no n8n, e o n8n chama as rotas de serviço. Campanha de
WhatsApp oficial: a tela desenha os blocos (contrato em `lib/campanhas-fluxo.ts`, entrada conferida por
`lib/campanhas-fluxo-entrada.ts`), o motor `lib/campanhas-whatsapp.ts` executa no tique do n8n em
`/api/meta/whatsapp/processar`, e a IA do construtor (`lib/ia/campanhas-construtor.ts`) só desenha na tela, nunca grava.

Mudar a oportunidade de etapa, por qualquer caminho (arraste, lote, IA, cadência, campanha), passa por
`moverEtapaRegistrandoLote` em `lib/historico.ts`. A etapa com `etapas.pede_retorno` (a "interesse futuro") só aceita
quem traz o dia de retomar o contato (`oportunidades.retomar_em`, conferido por `conferirRetomarEm` em
`lib/mover-etapa.ts`); a tela pede o dia em `app/funil/escolher-retorno.tsx`. Sair para outra etapa apaga o dia; no dia,
o card mostra "Retomar contato" e sobe na coluna. Card novo não nasce nessa etapa, e remover etapa não despeja leads nela.

Lead com reunião marcada que avisa que não vai conseguir ir: a IA chama `avisar_imprevisto` (avisa a Fernanda, sem
encerrar o atendimento), oferece horários e, quando ele escolhe, `remarcar_reuniao` muda o mesmo evento no Google
(`remarcarReuniao` em `lib/agenda.ts`) e avisa a Fernanda. Sem resposta, a rodada das retomadas volta a oferecer 2 h
depois e, depois, uma vez por dia (`lib/ia/remarcacao.ts`, estado no histórico). Na "reunião agendada" combinada fora
do CRM, a remarcação é uma reserva nova.

## 3. Onde fica cada coisa

| O quê | Onde |
|---|---|
| Páginas | `app/<modulo>/page.tsx` (servidor, sempre com `exigirModulo`) |
| Componentes da tela | `app/<modulo>/*.tsx`; compartilhados em `app/components/` |
| Server actions | `app/<modulo>/acoes.ts` (novo) ou `actions.ts` (antigo); `acoes-<assunto>.ts` quando o módulo tem vários assuntos (Configurações); `app/components/acoes-*.ts` |
| Rotas HTTP | `app/api/**/route.ts` |
| Regra de negócio | `lib/` (ex.: `mover-etapa.ts`, `oportunidades.ts`, `demandas.ts`, `automacoes/`, `ia/`); parte ainda nas ações |
| Integrações | `lib/uazapi.ts`, `lib/whatsapp-oficial.ts`, `lib/meta*.ts`, `lib/instagram*.ts`, `lib/google-*.ts`, `lib/automacoes/motores/n8n/`, `lib/transcricao.ts`, `lib/voz.ts`, `lib/armazenamento.ts`, `lib/social/` |
| Consultas ao banco | `lib/db.ts` (conexão); `app/<modulo>/dados.ts` (leitura só daquela tela); `lib/<dominio>` quando outra parte também lê (ex.: `lib/funil.ts`, `lib/webhooks-dados.ts`, que a IA reutiliza) |
| Tipos | `lib/entidades.ts` (tabelas), `lib/*-tipos.ts`, `lib/automacoes/tipos.ts`, `app/chat/tipos.ts`; tipo local fica junto do uso |
| Validação | na entrada (ação ou rota): `ehUuid` de `lib/validacao.ts`, `trim`/`slice`, enum, limites; zod em payload complexo |
| Formatação | `lib/formato.ts` (dinheiro, data, iniciais), `lib/telefone.ts` (telefone) |
| Retorno de ação com recusa | `lib/resultado-acao.ts` (`ResultadoAcao`, `Recusa`, `comoResultado`) |
| Permissões | `lib/auth/dal.ts`, `lib/auth/modulos.ts`, `lib/auth/escopo-oportunidades.ts` |
| Schema e migrations | `schema.sql`, `schema-automacoes.sql`, `migration-*.sql` na raiz |
| Testes | não há suíte; verificação por script em `scripts/` (seção 5) |
| Estilo global | `app/globals.css` (variantes `dark:` e `tela-baixa:`, `@source inline` das cores de etapa) |

## 4. Convenções

**Nomes.** Tudo em português: arquivos, funções, variáveis, tabelas, mensagens. Arquivos em kebab-case
(`filtros-ui.tsx`), componentes em PascalCase, funções em camelCase começando por verbo (`carregarFunil`,
`exigirModulo`), predicados com `eh`/`tem` (`ehEscopo`, `temIaCompleta`), constantes em UPPER_SNAKE, tabelas e
colunas em snake_case. Arquivo novo de ações se chama `acoes.ts`.

**Imports.** Alias `@/` para atravessar pastas; relativo (`./`) dentro do mesmo módulo. `import type` para tipos.
Ordem: pacotes, depois `@/lib`, depois `@/app`, depois relativos. `lib/` não importa de `app/`. Há duas exceções
conhecidas, as ferramentas de IA que escrevem pelas ações da tela (`lib/ia/tags-segmentos.ts` e `lib/ia/webhooks.ts`,
diagnóstico 3.3); não crie novas. Código que outra parte de `lib/` precisa ler mora em `lib/`. Módulo de servidor com
segredo ou banco importa `server-only`.

**Banco (postgres.js).**
- Só o `sql` de `lib/db.ts`, como tagged template. Nunca interpolar string; nunca `sql.unsafe` com entrada.
- jsonb: `${sql.json(obj)}`. `${JSON.stringify(obj)}::jsonb` grava uma string.
- Regex em template string: `'\\D'`. `'\D'` chega ao Postgres como `'D'`.
- Lista de uuids: `= ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])`.
- Lote: `jsonb_to_recordset(${sql.json(linhas)}) AS x(col tipo, ...)`.
- Atomicidade: `ON CONFLICT`, guarda `NOT EXISTS` na mesma instrução, ou transação.
- Nunca carregar a base inteira de contatos (dezenas de milhares): busca com `LIMIT` via `lib/contatos-busca.ts`.
- A IA lê por `lib/ia/db.ts` (role sem escrita). Não criar outra conexão `postgres()`. A exceção é `lib/ponto-db.ts`, a
  base de outro sistema (o app de ponto), lida só em transação READ ONLY por `lerPonto`; a coluna `senha` de lá nunca
  é lida.

**Erros.**
- Erro esperado em server action (validação, regra de negócio, nome repetido, serviço externo recusou): devolver
  `ResultadoAcao` de `lib/resultado-acao.ts`, ou seja `{ ok: false, erro: "mensagem" }`. Em produção a mensagem de
  um `throw` não chega ao navegador: a tela recebe "Minified React error #441" (diagnóstico, item 3.1). Validação
  simples devolve direto; recusa vinda de função auxiliar lança `Recusa` dentro de `comoResultado`, que também
  converte o índice único com `{ duplicado: "frase" }`. A tela lê `r.ok` antes de seguir e mostra `r.erro`.
- Erro inesperado: deixar subir, com contexto no log. Nunca `catch` vazio, nunca engolir erro de negócio.
- Rota: `Response.json({ erro }, { status })`. Recurso que a pessoa não pode ver responde 404.
- Webhook de entrada responde 200 depois de registrar, para o remetente não reenviar em laço.
- Efeito colateral (histórico em `lib/historico.ts`, evento da Meta, aviso à equipe) não derruba a ação principal.

**Arquivos e comentários.** Uma responsabilidade por arquivo. Cabeçalho explica o papel do arquivo e as decisões
não óbvias, com data (AAAA-MM-DD) e motivo quando for decisão de produto. Comentário explica o porquê, não repete o
código. Comentário desatualizado se corrige junto da mudança.

**Interface.** Tailwind v4 em zinc, `dark:` em tudo que tem cor. Ícone vem sempre de `app/components/icones.tsx`
(Font Awesome Free Solid, desde 2026-10-27): ícone novo entra lá, com nome, e as telas não importam o pacote direto.
Reaproveitar `app/components/`
antes de criar peça nova. Minimalista: uma faixa por assunto, nada duplicado. Tem que caber em tablet deitado
(1024×768, variante `tela-baixa:`). Classe montada em runtime precisa constar no `@source inline` do
`app/globals.css`. Atualização ao vivo pendura no polling existente.

## 5. Comandos

```bash
npm install                      # dependências (package-lock.json)
npm run dev                      # servidor de desenvolvimento em http://localhost:3000 (usa o .env, banco DEV)
npx tsc --noEmit -p .            # tipos, ~15 s
npm run lint                     # ESLint no projeto inteiro, ~24 s
npx eslint caminho/arquivo.ts    # ESLint só nos arquivos tocados
npm run build                    # build de produção
npm run start                    # serve o build local
node --env-file=.env scripts/jiti.mjs scripts/<arquivo>.ts   # roda TS do projeto fora do Next
```

- **Testes:** não existe `npm test`. Os scripts de verificação que já existem simulam a rede e passam hoje:
  `scripts/testar-cadencia-responsavel.mjs` e `scripts/testar-agenda-ocupados.mjs` (direto com `node`),
  `testar-filtro-campanhas.ts`, `testar-meta-ads.ts`, `testar-meta-eventos.ts` (pelo runner; este usa o DEV numa
  transação desfeita) e `testar-instagram.ts` (pelo runner; webhook, IA de comentário e envio do Instagram contra o
  DEV com Graph e modelo falsos, cenário marcado e apagado no fim), `testar-templates-whatsapp.ts` (pelo runner,
  sem `.env`: as regras do editor de templates e as do envio, com dado do contato saneado, no chat e nas campanhas),
  `testar-campanhas-fluxo.ts` e `testar-campanhas-tela.ts` (pelo runner, sem `.env`: o contrato das campanhas em
  blocos e as operações do construtor, com as pendências iguais às do servidor), `testar-campanhas-motor.ts`
  e `testar-campanhas-construtor.ts` (pelo runner, contra o DEV com Graph e uazapi falsas: o motor das campanhas e a
  IA do construtor, sem chamar a Anthropic), `testar-campanhas-metricas.ts` (pelo runner, contra o DEV com a Graph
  falsa: o funil, as falhas por motivo e o gasto pelo template_analytics), `testar-atendimento-humano.ts` (pelo runner, contra o DEV com um funil de teste apagado no fim: o fim da cadência,
  a IA que passa o lead para a equipe e a pill "Atendimento humano"), `testar-reunioes-assistente.ts` (pelo runner, contra
  o DEV com cenário marcado e a Anthropic falsa num servidor local: a porta, o lead e o copiloto da extensão de reuniões),
  `testar-documentos-envio.ts` (pelo runner, contra o DEV e o Storage do `.env`, com marca apagada no fim: o envio direto
  da biblioteca de Documentos pela URL assinada e as recusas do registro),
  `testar-instancia-secundaria.ts` (pelo runner, contra o DEV com a uazapi falsa num servidor local e marca apagada no
  fim: quando a secundária assume, onde a mensagem fica, a volta à principal e as travas do banco),
  `testar-ia-remarcacao.ts` (pelo runner, contra o DEV com a Anthropic falsa e marca apagada no fim: o estado da
  remarcação, o aviso do imprevisto e as mensagens de 2 h e diárias da rodada; a mudança no Google fica no
  `testar-agenda-ocupados.mjs`),
  `testar-ia-retorno.ts` (pelo runner, contra o DEV com a Anthropic falsa num servidor local e marca apagada no fim: o
  retorno combinado da IA, a rodada que retoma no horário e a retomada por silêncio que o respeita),
  `testar-ponto.ts` (pelo runner: as regras das horas do ponto; com `PONTO_DATABASE_URL`, lê dois meses da base do app
  de ponto e confere que a conexão recusa escrita, sem gravar nada lá), `testar-folha.ts` (pelo runner: a conta da folha
  com deslocamento e as recusas; contra o DEV, a foto do mês e o padrão do cadastro, com marca apagada no fim, e a IA sem
  leitura), `testar-interesse-futuro.ts` (pelo runner, contra o DEV com um funil de teste apagado no fim: a etapa que
  pede o dia de retomar, a trava do mover, o lote, o quadro e a remoção de etapa), `testar-blog.ts` (pelo runner, com
  Search Console, n8n e Anthropic falsos pelo `fetch` interceptado e um blog marcado no DEV, apagado no fim: a
  propriedade do blog, o desempenho e o artigo no Google, o workflow e o ligar, a curadoria da pauta e a cota do dia),
  `scripts/testar-extensao-reunioes.mjs` (direto com `node`: o service worker da extensão com um `chrome` falso; o áudio
  de verdade só no Chrome, ver `extensao-reunioes/LEIAME.md`) e `scripts/testar-hooks.mjs`
  para os hooks do Claude Code. Quando rodar cada um está na skill `/verify`. `testar-gsc.ts` e `testar-login.ts`
  falam com serviço e conta de verdade e só rodam a pedido.
- **Script novo de verificação:** chama as funções reais pelo runner acima, contra o banco DEV: cria o cenário com
  marca reconhecível, chama a função (nunca uma cópia do SQL) e apaga num `finally`. Dependência externa (n8n,
  uazapi, Meta) é substituída por um servidor `node:http` local. Script descartável fica fora do repositório.
- **SQL avulso no DEV:** `node --env-file=.env scripts/jiti.mjs scripts/rodar-sql.ts <arquivo.sql>`, só quando a
  tarefa pede.
- **Windows:** o Bash é Git Bash (use `MSYS_NO_PATHCONV=1` quando um argumento começar com `/`); o PowerShell é
  5.1, sem `&&`.
- O estado atual de `tsc` e lint é zero erro. Mudança que introduz erro não está pronta.

## 6. Segurança e operações que exigem autorização

**Regras do código:**
- Fechado por padrão. Rota nova nasce protegida pelo `proxy.ts`; abrir uma exige outra tranca e entrada comentada
  na lista do `proxy.ts`.
- `exigirModulo` em cada `page.tsx` (não no layout); `exigir*` no início de toda server action;
  `exigirModuloApi`/`exigirLoginApi` ou tranca própria em toda rota. Escopo `'proprio'` filtra por `usuario.id`.
- Entrada de ação e rota é não confiável. Nada vindo do cliente decide permissão.
- Segredo nunca em `NEXT_PUBLIC_*`, nunca em componente cliente, nunca em log. Variável de ambiente lida dentro da
  função (ler no topo quebra o `next build`). Variável nova entra no `.env.example` com comentário de origem.
- URL externa vinda de usuário passa por `lib/destino-permitido.ts`/`lib/rede-externa.ts` (SSRF). Texto de cliente
  que vai para prompt passa por `lib/ia/sanitizar.ts`. Comparação de segredo em tempo constante.
- URL de webhook que entra num prompt de integração fica escrita no código, não em variável de ambiente.
- O repositório no GitHub é público: nunca versionar dado de cliente, segredo, export, PDF, planilha ou vídeo.

**Só com pedido explícito do usuário naquela vez** (aprovação anterior não vale para a próxima):
- Qualquer acesso ao banco de produção, inclusive leitura. O trabalho acontece no DEV (`DATABASE_URL` do `.env`).
- Rodar migration na produção. No DEV, só quando a tarefa pedir.
- Criar tabela ou coluna que o usuário não especificou. Modelagem de dados é decisão dele: descreva a necessidade
  e as opções, sem DDL inventado.
- Commit, push, merge, deploy, variáveis da Vercel. Push pode publicar.
- Enviar WhatsApp, e-mail ou evento da Meta reais; publicar post nas redes.
- Criar, ativar, parar ou alterar workflow no n8n (instância compartilhada com produção e com outro sistema).
- Mexer no webhook da instância uazapi compartilhada.
- Instalar dependência, baixar browser headless ou ferramenta pesada.
- Editar o `.env`. As travas `WHATSAPP_SO_PARA` e `INSTAGRAM_SO_PARA` (ambiente de desenvolvimento) nunca são
  contornadas nem criadas na Vercel.
- Semear o DEV (padrão é mock em JSON); quando pedido, com marca e sem deixar nada pendente.
- Apagar dado ou arquivo, `DROP`, `TRUNCATE`, `git reset`, `git clean`, `git checkout --`.
- Mudar a lógica funcional do produto quando o pedido era documentação, análise ou revisão.

## 7. Procedimentos

**Investigar um bug.** Fixar o sintoma (o que, onde, desde quando, DEV ou produção). Reproduzir no DEV, por script
ou consulta. Levantar evidência antes de teorizar: erro, log, linhas no banco, `git log -S`, `git blame`. Listar
hipóteses e o teste que separa cada uma. Achar a linha e o mecanismo. Corrigir a causa com a menor mudança, procurar
o mesmo padrão no resto do código e provar que o caso passa. Se a resposta só existe na produção, parar e dizer qual
consulta ou log precisa ser visto.

**Implementar uma funcionalidade.** Localizar os módulos envolvidos e ler seus contratos, quem os chama e os
comentários de cabeçalho. Ler o guia do Next em `node_modules/next/dist/docs/` para cada API usada. Reutilizar tipos,
helpers e componentes existentes. Definir o contrato entre servidor e tela (assinatura da ação, tipo do retorno)
antes de escrever as duas pontas. Seguir o fluxo da seção 2 e as convenções da seção 4. Menor mudança que resolve,
sem refatoração fora do escopo.

**Verificar uma alteração.** A skill `/verify` escolhe as verificações pelo que mudou (tipos, lint, scripts, build),
roda e mostra o resultado real. Lógica de servidor sem script: escrever um (seção 5). Interface: tipos, lint e o
HTML servido pelo dev server; a conferência visual fica com o usuário, salvo pedido. Revisão com `/review`, e
`/security-audit` quando a mudança toca acesso, rota, integração, IA ou dados pessoais. Relatar o que foi
verificado e o que não foi, com a saída real.

O fluxo completo, com delegação aos subagentes e revisão, está nas skills `/fix-bug` e `/implement-feature`.

## 8. Arquivos críticos, dependências e integrações

**Mexer aqui exige leitura atenta do cabeçalho e revisão de segurança:**
`proxy.ts`, `lib/auth/dal.ts`, `lib/auth/sessao.ts`, `lib/auth/modulos.ts`, `lib/auth/escopo-oportunidades.ts`,
`lib/db.ts`, `lib/ia/db.ts`, `next.config.ts`, `lib/automacoes/servico.ts`, `lib/segredo.ts`,
`lib/destino-permitido.ts`, `lib/rede-externa.ts`, `lib/ia/sanitizar.ts`, `lib/conversa-envio.ts`,
`lib/uazapi-reserva.ts` (por qual número o WhatsApp Web envia quando a principal cai),
`lib/ia/atendente.ts`, `lib/automacoes/compilador/`, `lib/automacoes/motores/n8n/adaptador.ts`,
`app/api/uazapi/webhook/route.ts`, `app/api/meta/whatsapp/webhook/route.ts`, `app/api/mcp/[segredo]/route.ts`,
`app/api/meta/instagram/webhook/route.ts`, `lib/instagram.ts` (ponto único de envio e trava de dev),
`lib/instagram-webhook.ts`, `lib/ia/comentarios.ts`, `lib/grupos-whatsapp.ts` (conversa de grupo, sem contato), `lib/campanhas-whatsapp*.ts` (o motor que dispara para o segmento
inteiro, dividido por assunto; sobretudo `-rodada`, `-envios` e `-controle`), `lib/campanhas-fluxo-entrada.ts`,
`lib/aviso-equipe-whatsapp.ts`, `lib/ia/campanhas-construtor.ts`, `lib/whatsapp-custo.ts` (lê o gasto na Graph),
`lib/reunioes-extensao.ts` (Origin e freio da extensão de reuniões), `lib/reunioes-lead.ts`, `lib/ia/reuniao.ts`,
`lib/blog-automacao.ts` (cria, reescreve, liga e pausa o workflow do blog no n8n compartilhado; só produção),
`extensao-reunioes/manifest.json` (permissões e a chave que fixa o ID) e `extensao-reunioes/service-worker.js`.

**Dependências que importam:** `next` 16.3 (API diferente do treino, ver `AGENTS.md`), `postgres` (fora do
bundle, `serverExternalPackages`), `jose`, `zod` 4, `@anthropic-ai/sdk`, `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` (o Storage do
Neon, só em `lib/armazenamento.ts`), `@xyflow/react` (editor de fluxos), `@dnd-kit/*` (arrastar no quadro), `chart.js`.

**Integrações externas:**

| Serviço | Para quê | Onde | Cuidado |
|---|---|---|---|
| Neon | banco (DEV local, produção na Vercel) | `lib/db.ts` | produção só com pedido |
| Neon Object Storage | documentos, mídias do chat, anexos, vídeos | `lib/armazenamento.ts` | buckets privados no projeto da produção (o DEV usa os mesmos); link de envio assinado com tamanho e tipo; envio do navegador por `app/components/enviar-arquivo.ts` |
| uazapi | WhatsApp não oficial | `lib/uazapi.ts` | instância compartilhada; laço bane o número |
| Meta | WhatsApp Cloud API, leads, Ads, Conversions API, posts, Instagram (DM e comentários) | `lib/whatsapp-oficial.ts`, `lib/meta*.ts`, `lib/social/`, `lib/instagram*.ts` | eventos sempre ligados na produção; app compartilhado (WhatsApp, leads, Instagram): mexer só na assinatura do objeto em questão |
| n8n | executa cadências e agendadores | `lib/automacoes/motores/n8n/` | instância compartilhada; só tocar o que o CRM criou |
| Google | Agenda (OAuth), Drive e gravações do Meet (conta de serviço), Search Console do blog (conta de serviço, só leitura) | `lib/google-*.ts`, `lib/agenda.ts`, `lib/gravacoes.ts`, `lib/search-console.ts`, `lib/blog-google.ts` | escopo mínimo; inspeção de URL tem cota (2.000/dia por site) |
| Anthropic | IAs de atendimento e de interface, copiloto de reuniões da extensão (`lib/ia/reuniao.ts`), artigos e curadoria da pauta do blog | `lib/ia/`, `lib/artigo-geracao.ts`, `lib/blog-curadoria.ts` | prompt com dado de cliente sanitizado (título de notícia também); a mesma chave e o mesmo limite de uso servem a todas |
| Groq, Magnific | transcrição de áudio (chat e reuniões da extensão), voz da IA | `lib/transcricao.ts`, `lib/voz.ts` | número por extenso antes da voz; a extensão divide a chave da Groq com o chat |
| Claude (MCP) | conector de leitura e posts | `app/api/mcp/[segredo]`, `lib/mcp/` | telefone e e-mail mascarados |
| App de ponto (Neon à parte) | horas da equipe na aba Ponto do Financeiro | `lib/ponto-db.ts`, `lib/ponto.ts` | outro sistema: só leitura (transação READ ONLY), nunca a coluna `senha` |

## 9. Regras permanentes de qualidade

- Código simples, explícito, modular e fácil de entender. Cada módulo com responsabilidade clara e delimitada.
- Evitar arquivo grande demais, componente com várias responsabilidades e função difícil de testar. Arquivo acima
  de ~600 linhas que você precisa alterar é candidato a divisão pelo assunto, em commit separado e só com
  autorização.
- Não criar abstração, camada ou arquivo só para seguir um padrão. Três linhas repetidas são melhores que uma
  abstração errada.
- Sem duplicação de lógica, dependência circular, import desorganizado ou acoplamento desnecessário.
- Separar apresentação, regra de negócio, validação, persistência e integração quando isso fizer sentido para o
  módulo (seção 3 e diagnóstico, seção 4).
- Usar os tipos existentes antes de criar novos. Evitar `any`; quando inevitável (payload sem contrato), restringir
  ao trecho e justificar no comentário.
- Não duplicar definição de tipo, schema, constante ou regra de negócio.
- Preservar compatibilidade e comportamento existentes, salvo pedido explícito.
- Não reescrever módulo estável sem benefício concreto.
- Não adicionar dependência sem justificar a necessidade e sem autorização.
- Não esconder erro, desabilitar regra de lint, usar `@ts-ignore` ou afrouxar tipo para a verificação passar.
- Não declarar teste ou verificação aprovada sem ter executado.
- Antes de implementar: localizar os módulos envolvidos, entender contratos e dependências.
- Depois de implementar: reler os arquivos afetados e rodar as verificações disponíveis (seção 5).

## 10. Subagentes, skills e hooks

Tudo em `.claude/`. A sessão principal decide, coordena, fala com o usuário e é a única que faz commit, sempre a
pedido.

**Subagentes** (`.claude/agents/`, todos em Opus com esforço xhigh). Eles recebem este arquivo automaticamente; o
arquivo de cada um traz só o papel, a área e o checklist próprio.

| Agente | Papel | Edita? |
|---|---|---|
| `code-reviewer` | revisa diff, commit ou branch: bugs, regressões, legibilidade, modularidade, acoplamento, cobertura | não |
| `security-reviewer` | autorização, escopo, segredos, injeção, SSRF, XSS, webhooks, IA, riscos arquiteturais | não |
| `backend-engineer` | `lib/`, server actions, rotas, `dados.ts`, migrations, scripts; investiga bugs de servidor | sim |
| `frontend-engineer` | telas, componentes, estilos e interação; investiga bugs de interface | sim |

**Como colaborar:**
1. **Antes:** a sessão principal localiza os módulos e define o contrato entre servidor e tela. Mudança em acesso,
   rota pública, integração externa ou IA passa antes pelo `security-reviewer` para avaliar o desenho.
2. **Durante:** `backend-engineer` e `frontend-engineer` podem trabalhar em paralelo só sobre o contrato fechado e
   nunca no mesmo arquivo. O backend é dono de `lib/`, `actions.ts`/`acoes.ts`, `dados.ts`, `app/api/` e SQL; o
   frontend, de `page.tsx` (composição), componentes `.tsx`, `app/components/` e `app/globals.css`. Quem precisa de
   mudança na área do outro pede pela sessão principal.
3. **Depois:** `code-reviewer` no diff inteiro; `security-reviewer` também, quando a mudança toca acesso, rota,
   integração, IA ou dados pessoais. Achado crítico ou alto volta para o agente dono do arquivo.
4. **Fechamento:** a sessão principal confere a verificação real, atualiza a documentação (seção 11) e relata.

Frentes independentes que vão virar mudanças separadas ficam numa branch ou worktree por frente, nunca no mesmo
checkout. A worktree nasce sem `node_modules` e sem `.env`; quem providencia é o usuário.

**Skills** (`.claude/skills/`):

| Skill | O que faz | Quem chama |
|---|---|---|
| `/review [alvo]` | roda o `code-reviewer` em contexto separado: alterações locais, sha, branch ou caminho | usuário ou sessão |
| `/security-audit [alvo]` | roda o `security-reviewer`, defensivo; aceita também módulo, rota ou desenho | usuário ou sessão |
| `/verify [build ou tudo]` | escolhe as verificações pelo que mudou, roda e mostra a tabela com o resultado real | usuário ou sessão |
| `/implement-feature <pedido>` | entender, plano com donos e contrato, implementar pelos agentes, verificar, revisar | só o usuário |
| `/fix-bug <sintoma>` | reproduzir, causa raiz, menor correção, a mesma reprodução passando, revisão | só o usuário |

**Hooks** (`.claude/settings.json`, scripts em `.claude/hooks/`, testados por `scripts/testar-hooks.mjs`). São rede
de segurança por padrão de texto e não substituem a seção 6:
- `proteger-arquivos.mjs`, antes de Read, Grep, Edit, Write e NotebookEdit: nega ler ou editar `.env*` (exceto
  `.env.example`), inclusive por nome curto, stream ou Grep com glob que alcance o `.env`, e nega editar o que é
  gerado ou gerenciado (`.git/`, `node_modules/`, `.next/`, `package-lock.json`, `AGENTS.md`).
- `guardar-comandos.mjs`, antes de Bash e PowerShell: pede aprovação para commit, push, reset, descarte de
  alterações, remoção recursiva, `npm install`, `npx --yes`, `vercel`, `rodar-sql`, SQL que grava quando o comando
  executa SQL, banco de produção, e comando que lê o `.env` (`cat .env`, `grep -r` na raiz, `rg --hidden`). No Bash,
  os primeiros também estão em `permissions.ask`. Não pega script que lê a variável por dentro, comando montado
  numa variável, `git checkout <arquivo>` sem `--` nem `rm` de arquivo avulso.
- `verificar-ao-parar.mjs`, ao encerrar a vez: roda `tsc` e `eslint` de `node_modules` quando um `.ts`, `.tsx`,
  `.js`, `.mjs`, `tsconfig.json` ou `package.json` mudou desde a última conferência. Falhou, bloqueia uma vez por
  conjunto de alterações com a saída; o mesmo conjunto depois só avisa. Sem `node_modules`, só avisa. Não roda
  testes nem build: isso é do `/verify`.

**Memória automática.** Ligada no projeto (`autoMemoryEnabled`), com as notas em `~/.claude/projects/<projeto>/memory/`,
fora do repositório. Guarda preferência do usuário, decisão de produto com data e armadilha não óbvia. Nunca segredo,
token, senha, telefone, e-mail ou dado de cliente, nem o que o código, o git ou este arquivo já registram.

## 11. Documentação viva

Mudança que altera arquitetura, fluxo, ponto de entrada, rota pública, permissão, integração, variável de
ambiente, comando ou convenção atualiza a documentação **no mesmo trabalho**:

- este `CLAUDE.md` (estrutura, fluxo, comandos, convenções, arquivos críticos);
- o doc do assunto em `docs/` (por exemplo `auth.md` para rota pública, `acessos.md` para módulo novo);
- `.env.example` para variável nova; o comentário da lista em `proxy.ts` para rota aberta;
- o cabeçalho do arquivo alterado, quando a decisão registrada nele mudou;
- `docs/organizacao-do-codigo.md` quando um item do diagnóstico for resolvido.

O `code-reviewer` trata documentação desatualizada pela mudança como achado. Não edite o bloco gerenciado do
`AGENTS.md`: o `next dev` o reescreve.
