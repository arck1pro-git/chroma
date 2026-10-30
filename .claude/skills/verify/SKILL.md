---
name: verify
description: Roda as verificações do AmaanOffice proporcionais ao que mudou (tipos, lint, scripts de teste locais, build) e mostra os resultados reais numa tabela. Use antes de declarar uma mudança pronta, antes de commit e antes de deploy. Não corrige nada, só relata.
argument-hint: "[vazio = alterações locais | build | tudo]"
allowed-tools: Bash(git status *), Bash(git diff *), Bash(git ls-files *), Bash(npx tsc --noEmit -p .), Bash(npx eslint *), Bash(npm run lint), Bash(npm run build), Bash(node scripts/testar-cadencia-responsavel.mjs), Bash(node --env-file=.env scripts/jiti.mjs scripts/testar-filtro-campanhas.ts), Bash(node --env-file=.env scripts/jiti.mjs scripts/testar-meta-ads.ts), Bash(node --env-file=.env scripts/jiti.mjs scripts/testar-meta-eventos.ts), Bash(node scripts/testar-hooks.mjs), Bash(node scripts/testar-agenda-ocupados.mjs)
---

Alvo: $ARGUMENTS

- **Vazio:** as alterações locais.
- **build:** as alterações locais e o build de produção.
- **tudo:** lint do projeto inteiro, todos os scripts da tabela e o build. Use antes de deploy.

## 1. O que mudou

Junte `git diff --name-only HEAD` e `git ls-files --others --exclude-standard`. Sem alteração e com alvo vazio,
rode só os tipos e diga que não havia mudança. Se a pasta não tem `node_modules` (worktree nova), pare e diga isso:
o `npx` baixaria pacotes do registro.

## 2. O que rodar

| Verificação | Quando | Comando |
|---|---|---|
| Tipos | sempre | `npx tsc --noEmit -p .` |
| Lint dos alterados | há `.ts`, `.tsx`, `.js` ou `.mjs` alterado | `npx eslint --no-warn-ignored --max-warnings=0 <arquivos>` |
| Lint inteiro | mudou `eslint.config.mjs`, `tsconfig.json` ou `package.json`; alvo `tudo` | `npm run lint` |
| Cadências, n8n, envio | mudou `lib/automacoes/`, `app/api/automacoes/` ou `app/configuracoes/acoes-whatsapp.ts` | `node scripts/testar-cadencia-responsavel.mjs` |
| Filtro de campanhas | mudou `app/inicio/filtro-campanhas.ts` | `node --env-file=.env scripts/jiti.mjs scripts/testar-filtro-campanhas.ts` |
| Meta Ads | mudou `lib/meta.ts` ou `lib/meta-ads-*` | `node --env-file=.env scripts/jiti.mjs scripts/testar-meta-ads.ts` |
| Eventos da Meta | mudou `lib/meta-eventos.ts` | `node --env-file=.env scripts/jiti.mjs scripts/testar-meta-eventos.ts` |
| Templates do WhatsApp | mudou `lib/templates-whatsapp.ts`, `lib/campanhas-whatsapp*.ts`, `lib/whatsapp-oficial.ts` ou `app/api/meta/templates/` | `node scripts/jiti.mjs scripts/testar-templates-whatsapp.ts` |
| Campanhas em blocos | mudou `lib/campanhas-fluxo.ts` | `node scripts/jiti.mjs scripts/testar-campanhas-fluxo.ts` |
| Construtor de campanhas | mudou `app/campanhas/fluxo/`, `lib/campanhas-fluxo.ts` ou `lib/campanhas-fluxo-envios.ts` | `node scripts/jiti.mjs scripts/testar-campanhas-tela.ts` |
| Motor das campanhas | mudou `lib/campanhas-whatsapp*.ts`, `lib/campanhas-fluxo*.ts`, `lib/aviso-equipe-whatsapp.ts`, `lib/conversa-envio.ts` ou `app/api/meta/whatsapp/` | `node --env-file=.env scripts/jiti.mjs scripts/testar-campanhas-motor.ts` |
| Métricas e gasto das campanhas | mudou `lib/campanhas-metricas*.ts`, `lib/whatsapp-custo.ts` ou `app/api/meta/whatsapp/campanhas/[id]/metricas/` | `node --env-file=.env scripts/jiti.mjs scripts/testar-campanhas-metricas.ts` |
| IA do construtor de campanhas | mudou `lib/ia/campanhas-construtor*.ts`, `lib/campanhas-fluxo*.ts` ou `app/api/ia/campanhas/` | `node --env-file=.env scripts/jiti.mjs scripts/testar-campanhas-construtor.ts` |
| Agenda e horários da IA | mudou `lib/agenda.ts` ou `lib/google-oauth.ts` | `node scripts/testar-agenda-ocupados.mjs` |
| Assistente de reuniões | mudou `lib/reunioes-*.ts`, `lib/ia/reuniao.ts` ou `app/api/reunioes/` | `node --env-file=.env scripts/jiti.mjs scripts/testar-reunioes-assistente.ts` |
| Documentos (envio direto) | mudou `lib/documentos.ts`, `app/documentos/acoes.ts` ou `urlDeEnvio`/`infoDoObjeto` em `lib/armazenamento.ts` | `node --env-file=.env scripts/jiti.mjs scripts/testar-documentos-envio.ts` |
| Número secundário | mudou `lib/uazapi-reserva.ts`, `lib/uazapi-estado.ts`, `lib/conversa-envio.ts`, `lib/automacoes/conversa-da-cadencia.ts` ou `definirSecundaria`/`criarInstanciaNaUazapi` em `app/configuracoes/acoes-whatsapp.ts` | `node --env-file=.env scripts/jiti.mjs scripts/testar-instancia-secundaria.ts` |
| Extensão de reuniões | mudou `extensao-reunioes/` | `node scripts/testar-extensao-reunioes.mjs` (o service worker; o áudio de verdade só no Chrome, ver o LEIAME da pasta) |
| Atendimento humano | mudou `lib/atendimento-humano.ts`, `lib/automacoes/mover-pela-cadencia.ts`, `avancarPelaIa`/`passarParaHumano` em `lib/ia/atendente.ts` ou a pill em `lib/funil.ts` | `node --env-file=.env scripts/jiti.mjs scripts/testar-atendimento-humano.ts` |
| Hooks do Claude Code | mudou `.claude/hooks/` ou `.claude/settings.json` | `node scripts/testar-hooks.mjs` |
| Build | mudou `next.config.ts`, `proxy.ts`, `app/layout.tsx`, `package.json` ou `tsconfig.json`; rota ou página nova; alvo `build` ou `tudo` | `npm run build` |

Os scripts simulam rede e serviços. O de eventos da Meta usa o banco DEV numa transação desfeita e devolve a etapa
ao valor original. O de atendimento humano cria no DEV um funil de teste marcado e o apaga no fim; o do assistente de
reuniões, um contato marcado, com a Anthropic falsa num servidor local. O motor e a IA do
construtor de campanhas usam o DEV com cenário marcado e apagado no fim, com a Graph e a uazapi falsas (nenhuma
chamada à Anthropic). O de hooks usa uma
pasta temporária com um `.env` falso. Nenhum outro script de `scripts/` entra aqui: `testar-gsc.ts` e `testar-login.ts` falam com
serviço ou conta de verdade, e `rodar-sql.ts`, `criar-usuario.ts` e `carimbar-campanhas.ts` são operações
que gravam dados.

## 3. Rodar

- Tipos, lint e scripts são independentes: rode em paralelo quando der. O build vai por último e sozinho.
- Não pare na primeira falha. Rode tudo o que foi escolhido.
- Não corrija nada aqui. Correção é da tarefa em curso ou do usuário.

## 4. Relatar

Uma tabela com uma linha por verificação escolhida:

| Verificação | Comando | Resultado |
|---|---|---|

O resultado é "passou", "falhou" com a contagem de erros, ou "não rodou" com o motivo. Abaixo da tabela, o trecho
real da saída de cada falha, até 30 linhas. Depois, uma linha com o que esta verificação não cobre: conferência
visual da tela, comportamento na produção e integrações reais (WhatsApp, Meta, n8n).

## Critério de conclusão

- Cada verificação que a tabela do passo 2 pede rodou, ou aparece como "não rodou" com o motivo.
- Nenhum "passou" sem execução nesta chamada.
- As falhas aparecem com a saída real.
