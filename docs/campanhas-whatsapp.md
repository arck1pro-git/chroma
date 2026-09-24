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
já enviado/respondido/expirado não é processado novamente.

## Ações disponíveis

- registrar lead/conversão;
- adicionar tag;
- adicionar segmento;
- criar oportunidade em funil e etapa escolhidos.

Cada ação gera evento próprio. Falhar uma ação não apaga a resposta do contato
nem impede as ações seguintes; o erro fica em `campanha_whatsapp_eventos`.
