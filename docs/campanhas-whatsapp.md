# Campanhas oficiais de WhatsApp

Uma campanha é um fluxo contínuo por contato:

```text
template → aguardar resposta → respondeu / expirou → ações do ramo
```

Ela pode acompanhar vários segmentos. Ao ativar, os contatos atuais são
inscritos uma vez e a campanha continua ativa: qualquer associação futura a um
dos segmentos (ou preenchimento posterior do WhatsApp) cria uma nova execução,
sem duplicar quem já participou.

Cada campanha ativada recebe um workflow executor próprio no n8n, fora da lista
do módulo Automações. O workflow chama somente a fila daquela campanha a cada
minuto; a definição dos blocos continua sendo a fonte da verdade no CRM.

## Entrada da Meta

Cadastre no app da Meta o callback público:

```text
https://SEU-DOMINIO/api/meta/whatsapp/webhook
```

Use no painel o mesmo valor de `META_WEBHOOK_VERIFY_TOKEN` do `.env` e assine o
campo `messages` da WABA. `META_APP_SECRET` é obrigatório: o POST confere
`X-Hub-Signature-256` e fecha quando a chave falta.

## Processamento de fila e prazos

Chame a cada minuto:

```http
POST /api/meta/whatsapp/processar
Authorization: Bearer $CRM_SERVICE_TOKEN
```

A rota envia até 100 itens em fila e encerra até 500 esperas vencidas. Pode ser
agendada no n8n, Vercel Cron ou outro scheduler. É idempotente por estado: item
já enviado/respondido/expirado não é processado novamente, e cada item é
reservado (`na_fila` → `enviando`) antes do envio — duas execuções da fila ao
mesmo tempo não mandam a mesma mensagem duas vezes (corrigido em 2026-10-27).

## Variáveis do template

Cada `{{1}}`, `{{2}}`… do template recebe, na definição da campanha
(`definicao.variaveis`), um texto fixo (até 200 caracteres) ou um dado do
contato: `{{primeiro_nome}}`, `{{nome}}` ou `{{cidade}}`, trocado pelo dado de
cada pessoa no disparo. As regras ficam em `lib/templates-whatsapp.ts` e são
conferidas na criação, na ativação e de novo em cada disparo (o template pode
mudar na Meta enquanto a campanha inscreve gente).

- **Dado saneado:** nome e cidade vêm de formulário público e vão dentro da
  mensagem oficial. Com link, domínio, `@`, número, marca de formatação, nome
  provisório ("Sem nome") ou longo demais, contam como vazio.
- **Faltou o dado:** o contato não recebe; a execução fica `falhou` com o motivo
  ("Contato sem cidade para a {{2}}") e não é reinscrita.
- **E-mail e WhatsApp do contato** só vão pelo chat, onde alguém vê o valor
  antes de mandar: na campanha, um número reciclado levaria o dado de uma pessoa
  a outra.
- Template com cabeçalho de mídia, link variável ou variável com nome não sai
  pelo CRM (nem chat, nem campanha).

## Definição gravada como texto (até 2026-10-27)

A `definicao` era gravada com `JSON.stringify(...)::jsonb`, que grava uma
string JSON; lida de volta, as ações e o prazo eram ignorados (valiam os
padrões: sem ações, 1 dia). Desde a correção ela vai com `sql.json`. Campanhas
**já ativadas** antes disso continuam rodando com os padrões, de propósito: ler a
string faria campanhas no ar começarem a executar ações que nunca rodaram.
**Rascunhos** antigos, que nunca rodaram, são lidos de verdade na ativação e
regravados como objeto. A tela mostra cada campanha como ela roda.

## Ações disponíveis

- registrar lead/conversão;
- adicionar tag;
- adicionar segmento;
- criar oportunidade em funil e etapa escolhidos.

Cada ação gera evento próprio. Falhar uma ação não apaga a resposta do contato
nem impede as ações seguintes; o erro fica em `campanha_whatsapp_eventos`.
