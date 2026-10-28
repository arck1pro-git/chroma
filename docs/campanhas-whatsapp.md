# Campanhas oficiais de WhatsApp

Uma campanha é um FLUXO EM BLOCOS por contato, montado no construtor da tela
Campanhas (ou pela IA): os contatos dos segmentos entram pelo início, andam pelos
blocos imediatos e param nos de espera. Ela acompanha os segmentos enquanto está
ativa: quem entra num deles depois também é inscrito, uma vez só.

| O quê | Onde |
|---|---|
| Contrato (formato, catálogo, validação do grafo, saída de cada resposta) | `lib/campanhas-fluxo.ts` |
| Regra de cada envio, consequências fora do bloco, filtro da IA calada (puro, a tela usa) | `lib/campanhas-fluxo-envios.ts` |
| Forma da entrada, leitura do que está gravado, conferência, trava de ids | `lib/campanhas-fluxo-entrada.ts` |
| Opções dos blocos (tela e IA leem o mesmo) | `lib/campanhas-opcoes.ts` |
| Motor: inscrição, rodada, respostas, prazos, avisos, pausar/editar/retomar, métricas | `lib/campanhas-whatsapp.ts` |
| Agendador no n8n | `lib/campanhas-workflow.ts` |
| Rotas | `app/api/meta/whatsapp/campanhas/**`, `/processar`, `/webhook` |
| IA do construtor | `lib/ia/campanhas-construtor.ts`, `lib/ia/campanhas-construtor-formato.ts` |
| Verificação | `scripts/testar-campanhas-fluxo.ts`, `testar-campanhas-motor.ts`, `testar-campanhas-construtor.ts` |

## Blocos e estados

Blocos: Enviar template, Aguardar resposta, Enviar texto (só depois de uma
resposta: a janela de 24 horas), Esperar, Tag, Segmento, Criar oportunidade,
Mover oportunidade, Registrar conversão, Avisar a equipe e Passar para a IA.
Sem laço: nenhum caminho volta a um bloco anterior; "reenviar até responder" se
monta em sequência. Até 60 blocos, e até 25 imediatos seguidos por rodada.

Estados de cada execução (`campanha_whatsapp_execucoes.estado`):

| Estado | Quer dizer |
|---|---|
| `na_fila` | inscrita, ainda sem rodar |
| `enviando` | reservada por uma rodada (15 min; presa além disso vira `falhou`, sem reenvio) |
| `aguardando_resposta` | parada num Aguardar até responder ou vencer o prazo |
| `em_andamento` | `bloco_atual` roda quando `prazo_resposta` chegar: depois de uma resposta, parada num Esperar ou estacionada por pausa |
| `concluida`, `falhou` | finais (`respondeu` e `expirou` são do formato antigo) |

Cada bloco deixa um evento `bloco` com frase fixa, nunca o texto que o contato
escreveu. É pelo evento que o motor sabe se um envio já foi tentado e se um
Esperar já começou: por isso um id que já rodou não muda de tipo nem volta
depois de apagado (ver "Pausar, editar e retomar").

## Criar, ativar e a inscrição

- `POST /api/meta/whatsapp/campanhas` cria já ativa; `POST …/[id]/ativar` ativa
  um rascunho. As duas conferem o fluxo inteiro com a permissão de quem clica,
  os templates de hoje na Meta e o banco, e publicam um agendador próprio no n8n
  (fora do módulo Automações) que chama a fila daquela campanha a cada minuto.
- **Inscrição sem teto** (desde 2026-10-28): todos os contatos com WhatsApp dos
  segmentos entram numa instrução (`inscreverDosSegmentos`). Até então eram os
  250 primeiros por nome, e ninguém inscrevia o resto. O total que a tela mostra
  é o real.
- **Duplo clique em Ativar:** a ativação é uma transação que passa o rascunho a
  `ativa` só se ele ainda é rascunho; o segundo clique não publica um segundo
  workflow. Falhando a publicação no n8n, nada fica ativo.
- Depois de ativa, o gatilho do banco (`migration-campanhas-whatsapp-segmentos-n8n.sql`)
  inscreve quem entra num dos segmentos.

## A rodada (`/processar`)

```http
POST /api/meta/whatsapp/processar
Authorization: Bearer $CRM_SERVICE_TOKEN
{ "campanhaId": "<uuid>" }
```

Chamada pelo agendador da campanha, nesta ordem: execuções presas viram
`falhou`, prazos vencidos saem por "sem resposta" (até 500), a fila anda (até
100 execuções e 45 s por chamada) e os avisos à equipe saem juntos por pessoa. A
vazão é essa: até 100 contatos por minuto por campanha.

**Uma campanha falando por contato e número.** A execução na fila não começa
enquanto outra do mesmo contato, no mesmo número da Meta, estiver aguardando,
rodando ou em andamento (inclusive parada num Esperar), em campanha ativa ou
pausada. A reserva roda sob `pg_advisory_xact_lock` do par contato+número, e a
entrada do Aguardar confere de novo (adia 10 min se outra já aguarda). Sem isso
a resposta da pessoa não teria dono certo.

**Limite da Meta (tier do número), hoje:** toda recusa da Meta no envio do
template marca a execução como `falhou`, inclusive as de limite de envio
(throughput, tier, par empresa-contato). Ela não volta para a fila: o evento
`enviando` já gravado faria a próxima tentativa parar em "não reenviado". Tratar
esses códigos como "adiar" exige marcar a tentativa como resolvida sem envio;
está anotado como pendência.

## Como a resposta é casada

Uma mensagem nova no número oficial vai para a execução certa, nesta ordem:

1. **Botão:** o payload `cw:<execução>:<bloco>` — vale só se a execução é do
   contato e do número. Conta como BOTÃO só se o bloco do payload é o último
   template que a execução mandou; clique num template anterior vale como texto
   no Aguardar atual.
2. **Citação:** a mensagem citada é um envio da execução (template ou texto
   livre: o wamid fica no evento do bloco).
3. **Sem citação:** a aguardando mais recente do contato naquele número. Citou
   uma mensagem que não é de campanha: não casa.

A resposta precisa ser posterior ao envio (folga de 5 s de relógio), e a mesma
mensagem nunca anda o fluxo duas vezes (`resposta_id`, com índice único).
Reentrega da Meta não anda.

**Resposta adiantada:** a que chega enquanto a execução ainda está enviando (a
mesma rodada que manda o template e entra no Aguardar) não tem dono no webhook.
A entrada do Aguardar procura, na conversa do número, a mensagem do contato que
chegou nesta rodada, depois do último envio da execução, e que ninguém consumiu,
e sai por ela na hora. O texto do botão vale como clique. A conversa de antes da
rodada (num Esperar, por exemplo) não conta. Nesse caso a IA de atendimento já
respondeu a mensagem no webhook, porque ninguém a tinha consumido.

**Mídia** (desde 2026-10-28): toda mensagem nova é resposta, menos reação, aviso
de sistema e temporária. Áudio, foto e documento contam; sem texto que case com
botão ou palavra (a legenda vale), saem por "outra".

## A IA de atendimento e a campanha

Decisão de 2026-10-28. Na mensagem que a campanha consumiu, a IA fica calada só
quando o caminho que a resposta tomou MANDA mensagem ao contato (template ou
texto) antes da próxima espera: a campanha está falando, e os dois juntos
confundiriam a pessoa. Quando o caminho só faz ações de CRM, avisa a equipe ou
termina, e no formato antigo, a mensagem segue para a IA como antes. "Passar para
a IA" no caminho entrega a mensagem à IA de qualquer jeito. A regra é
`campanhaFalaAntesDeEsperar` e `iaResponde` (`lib/campanhas-fluxo-envios.ts`),
aplicada no webhook.

## Descadastro

Mensagem que é só "sair", "parar", "pare", "stop", "cancelar", "descadastrar" ou
"não quero mais" encerra TODA execução não final do contato naquele número, em
qualquer campanha e estado, com evento `descadastro`. A que aguardava sai por
"descadastro".

Isso não impede uma campanha FUTURA de inscrever o contato de novo. Descadastro
permanente pede modelagem, que é decisão dele. A necessidade é guardar, por
contato e número (ou conta) da Meta, que a pessoa pediu para sair e quando, e
conferir isso na inscrição e antes de cada envio. Opções: uma marca no contato,
uma lista própria de descadastros, ou uma tag reservada (sem mudança de schema,
mas qualquer pessoa com Contatos tira).

## Pausar, editar e retomar

| Rota | O que faz |
|---|---|
| `POST …/[id]/pausar` | ativa → pausada; nada anda (o agendador segue chamando) |
| `PUT …/[id]` | grava o fluxo de uma campanha pausada ou rascunho |
| `POST …/[id]/retomar` | pausada → ativa, revalidando tudo |

- **Resposta durante a pausa:** a saída fica gravada (`em_andamento`) e anda na
  retomada. O prazo do Aguardar segue correndo; o que venceu sai na primeira
  rodada depois de retomar.
- **Editar:** quem estava num bloco apagado termina como `concluida`, com
  evento. Trava de ids: um bloco que já existe na definição gravada não muda de
  tipo, e um id que já rodou nesta campanha e saiu da definição (aposentado)
  não volta. A recusa vem com `{ erro, problemas }`, conferida com a linha
  travada na mesma transação da gravação (`salvarEdicao`).
- **Retomar:** com a linha travada, confere que a definição gravada é a que foi
  conferida (outra aba pode ter salvo no meio: 409, retome de novo) e inscreve
  quem entrou nos segmentos durante a pausa.

## Aviso à equipe

O bloco só enfileira (`aviso_pendente`). A rodada junta numa mensagem só o que
cada pessoa tem para saber, por instância (`lib/aviso-equipe-whatsapp.ts`), com
teto de 20 linhas e 20 pessoas por aviso e 200 caracteres por linha. Sai por
uma instância uazapi escolhida no bloco (nunca a compartilhada com o SprintHub),
leva o texto do bloco, o nome do contato e o link da conversa, nunca telefone,
e-mail ou o que ele respondeu. Pausada, o aviso espera a retomada.

## Variáveis do template

Cada `{{1}}`, `{{2}}`… do template recebe um texto fixo (até 200 caracteres) ou
um dado do contato: `{{primeiro_nome}}`, `{{nome}}` ou `{{cidade}}`, trocado
pelo dado de cada pessoa no disparo. As regras ficam em
`lib/templates-whatsapp.ts` e são conferidas na criação, na ativação e de novo
em cada disparo (o template pode mudar na Meta).

- **Dado saneado:** nome e cidade vêm de formulário público. Com link, domínio,
  `@`, número, marca de formatação, nome provisório ou longo demais, contam como
  vazio.
- **Faltou o dado:** o contato não recebe; a execução fica `falhou` com o motivo.
- **E-mail e WhatsApp do contato** só vão pelo chat. A exceção é o WhatsApp no
  link de vídeo do CRM, num botão de link com variável.

## Definição gravada como texto (até 2026-10-27)

A `definicao` era gravada com `JSON.stringify(...)::jsonb`, que grava uma string
JSON. Campanhas já ativadas assim continuam com os padrões, de propósito.
Rascunhos antigos são lidos de verdade na ativação e regravados como objeto.
Campanhas no formato antigo (template → aguardar → ações) são convertidas para
blocos na leitura (`lerDefinicao`), sem migração de dados.

## Montar com IA no construtor (desde 2026-10-28)

No editor em blocos, a conversa ao lado do canvas faz POST em
`/api/ia/campanhas` com `construtor: "1"`, o `fluxo` aberto (JSON, sem
posições), a `waba` do editor e a `campanha` em edição (`""` quando é nova). A
IA (`lib/ia/campanhas-construtor.ts`) tem só três ferramentas, nenhuma grava:
`listar_alvos_campanha`, `ver_fluxo_aberto` e `desenhar_fluxo`. No fim da
resposta a rota emite `{ t: "fluxo", v: DesenhoDaIa }` com o último desenho que
passou nas travas, e a tela troca o canvas. Nada vai ao banco até a pessoa
clicar em Salvar ou Ativar, que conferem tudo de novo.

- **Guarda:** `campanhas` com `editar` (campanha salva) ou `criar` (nova). O
  desvio vem antes do modo completo do TI e não herda as ferramentas dele. O
  contexto da tela é montado no servidor; o `contexto` do corpo não entra.
- **Tetos:** corpo até 200 mil caracteres (413), fluxo aberto até 60 blocos,
  textos até 1000 caracteres e 50 KB reserializado (400; não corta). Até 6
  desenhos e 10 idas ao modelo por resposta; a Meta e as opções lidas uma vez.
- **Não desenha:** forma inválida, fluxo vazio, campanha que não está mais
  pausada ou rascunho, trava de ids (tipo trocado ou id aposentado; o
  `ver_fluxo_aberto` lista os aposentados) e link, telefone ou e-mail que a
  pessoa não escreveu na conversa nem estava no fluxo aberto. Link é qualquer
  palavra.tld; telefone conta com ponto; dinheiro com "R$" não.
- **Pendências** (o desenho vai assim mesmo; a IA corrige ou pergunta): a
  conferência de sempre, com a permissão de quem conversa, e segmento que não
  existe.
- **Eco:** público e quantos contatos (campanha nova), quem recebe aviso e por
  qual número, qual IA, e as consequências fora do bloco (`consequenciasDoFluxo`,
  a mesma lista do modal de ativação).
- A IA que grava rascunho (o modo de antes, sem `construtor`) continua sem os
  blocos de texto livre, aviso, IA e mover oportunidade. O `listar_campanhas`
  dela devolve nome e segmentos embrulhados e os blocos no formato da IA, nunca
  a definição crua.

## Entrada da Meta

Cadastre no app da Meta o callback público:

```text
https://SEU-DOMINIO/api/meta/whatsapp/webhook
```

Use no painel o mesmo valor de `META_WEBHOOK_VERIFY_TOKEN` do `.env` e assine o
campo `messages` da WABA. `META_APP_SECRET` é obrigatório: o POST confere
`X-Hub-Signature-256` e fecha quando a chave falta. O app precisa estar inscrito
na WABA (`subscribed_apps`): sem isso a Meta "aceita" e não entrega.

## Migration e a ordem com o deploy

`migration-campanhas-whatsapp-blocos.sql` vai ANTES do deploy do código em
blocos: cria `bloco_atual`, `resposta_saida` e `resposta_id`, troca o CHECK de
estado (`em_andamento`, `concluida`), o índice de eventos por execução e tipo e o
índice único parcial de `resposta_id`. Idempotente, numa transação. Sem ela, o
GET da lista responde qual falta. Num banco onde o código de blocos já rodou,
conferir antes se não há `resposta_id` repetida (a consulta está no arquivo).
