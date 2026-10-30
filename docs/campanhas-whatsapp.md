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
| Motor: a porta que as rotas importam, e o cabeçalho que explica o motor | `lib/campanhas-whatsapp.ts` |
| Motor por assunto (divisão de 2026-10-28): campanha (inscrição, pausar/editar/retomar), rodada, envios, ações, controle (condição, horário, passagem), respostas, avisos, totais, base | `lib/campanhas-whatsapp-*.ts` |
| Envio pela conversa (texto livre e arquivo da biblioteca, o mesmo do chat) | `lib/conversa-envio.ts` |
| Agendador no n8n | `lib/campanhas-workflow.ts` |
| Rotas | `app/api/meta/whatsapp/campanhas/**`, `/processar`, `/webhook` |
| IA do construtor | `lib/ia/campanhas-construtor.ts`, `lib/ia/campanhas-construtor-formato.ts` |
| Verificação | `scripts/testar-campanhas-fluxo.ts`, `testar-campanhas-motor.ts`, `testar-campanhas-construtor.ts` |

## Blocos e estados

Blocos: Enviar template, Aguardar resposta, Enviar texto (só depois de uma
resposta: a janela de 24 horas), Esperar, Tag, Segmento, Criar oportunidade,
Mover oportunidade, Registrar conversão, Avisar a equipe e Passar para a IA. Desde
2026-10-28 também Enviar arquivo, Horário de envio, Condição e Permissão de
passagem, e desde 2026-10-30 o Alternar (ver "Os blocos de controle e o arquivo").
Sem laço: nenhum caminho volta a um bloco anterior; "reenviar até responder" se
monta em sequência. Até 60 blocos, e até 25 imediatos seguidos por rodada.

Estados de cada execução (`campanha_whatsapp_execucoes.estado`):

| Estado | Quer dizer |
|---|---|
| `na_fila` | inscrita, ainda sem rodar |
| `enviando` | reservada por uma rodada (15 min; presa além disso vira `falhou`, sem reenvio) |
| `aguardando_resposta` | parada num Aguardar até responder ou vencer o prazo |
| `em_andamento` | `bloco_atual` roda quando `prazo_resposta` chegar: depois de uma resposta, parada num Esperar, num Horário de envio fora da janela, numa Permissão de passagem cheia, ou estacionada por pausa |
| `concluida`, `falhou` | finais (`respondeu` e `expirou` são do formato antigo) |

Cada bloco deixa um evento `bloco` com frase fixa, nunca o texto que o contato
escreveu. É pelo evento que o motor sabe se um envio já foi tentado e se um
Esperar já começou: por isso um id que já rodou não muda de tipo nem volta
depois de apagado (ver "Pausar, editar e retomar").

## Os blocos de controle e o arquivo (desde 2026-10-28)

Pedido dele ("crie mais blocos"). Nenhuma tabela nova: cada um usa o estado, o
prazo e os eventos que o motor já tinha (`lib/campanhas-whatsapp-controle.ts` e
`-envios.ts`).

| Bloco | O que faz | Estado e eventos |
|---|---|---|
| Condição | pergunta sobre o contato na hora em que ele chega: tem a tag, está no segmento, a oportunidade aberta mais recente dele no funil está na etapa, ou um campo personalizado do contato (`contatos.campos`) está preenchido, é igual ou contém o valor (sem acento e sem maiúscula). Duas saídas, `sim` e `nao` | imediato; evento `bloco` com `saida` `sim` ou `nao` (as métricas contam cada caminho) |
| Horário de envio | só deixa passar nos dias (0 = domingo … 6 = sábado) e entre `das` e `ate` (HH:MM, fuso de Brasília). Fora, espera a próxima abertura, inclusive na virada da semana | dentro: `bloco` com `saida`; fora: `bloco` sem saída na chegada, `em_andamento` com `prazo_resposta` = a abertura. Ao vencer confere de novo: uma pausa longa não solta ninguém de madrugada |
| Permissão de passagem | deixa passar `quantidade` contatos a cada `janela_segundos` (1 s a 30 dias), por campanha e bloco. Quem excede espera a vez, na ordem de chegada | com vaga: evento `passagem` {bloco} e `bloco` com `saida`; cheia: `bloco` sem saída na chegada, `em_andamento` com `prazo_resposta` = quando a vaga abre |
| Alternar (2026-10-30) | reveza os contatos entre 2 e 10 caminhos (`saidas`), na ordem de chegada: o 1º vai pelo Caminho A, o 2º pelo B… e volta ao A. Uso típico: variar os templates de uma campanha, um Enviar template por caminho. Todo caminho tem de estar ligado | imediato; evento `bloco` com `saida` `caminho:<i>`, gravado sob `pg_advisory_xact_lock` da campanha+bloco junto da contagem (duas rodadas não pegam a mesma vez). A execução que já passou segue pelo caminho gravado, sem contar de novo |
| Enviar arquivo | imagem JPG ou PNG até 5 MB, vídeo MP4 ou 3GPP até 16 MB ou PDF até 100 MB, da biblioteca de Documentos (as regras da Cloud API, as mesmas do cabeçalho de mídia: `problemaDoArquivoDaCampanha`), com legenda opcional (as marcas do contato valem). Só com a janela de 24 h aberta, como o texto livre | `enviando` antes e `bloco` depois (com o `wamid`); não saiu, fica registrado e o contato segue |

**A vazão da Permissão de passagem.** A janela é deslizante: conta as passagens
(eventos `passagem`) dos últimos segundos da janela, sob `pg_advisory_xact_lock`
da campanha+bloco, para duas rodadas (ou a rodada e o webhook) não soltarem a
mesma vaga. O motor roda a cada minuto e anda as execuções em rajada, então:

- **Janela abaixo de 60 s vale pela mesma taxa por minuto:** `quantidade × 60 /
  janela` vagas (para baixo) a cada 60 s. "5 a cada 10 s" deixa passar até 30
  por minuto, numa rodada. Contar 10 s de verdade soltaria só 5 por minuto.
- **Folga de 15 s:** a vaga fica ocupada pela janela menos 15 s
  (`FOLGA_PASSAGEM_S`). As rodadas não caem exatamente a 60 s uma da outra e as
  passagens de uma rodada se espalham pelos segundos dela; sem a folga, a janela
  de um minuto ainda estaria cheia quando a rodada seguinte chega, e a vazão
  cairia até pela metade. Em janela de uma hora ou um dia a folga não se nota; na
  de um minuto, quem passa fora da rodada (pela resposta, no webhook) pode somar
  até a quantidade a cada 45 s.
- **O teto da rodada continua:** até 100 execuções e 45 s por chamada do
  `/processar`, por campanha. Pedir mais que isso por minuto não acelera.
- **Ordem de chegada:** cheia, a vaga abre quando sai da janela a passagem que
  estoura a conta (com a janela cheia, a mais antiga), e quem já espera naquele
  bloco passa a ter essa mesma hora. O empate sai pela ordem de inscrição, que é
  a de chegada quando a permissão vem logo no início do fluxo.

**O arquivo sai pelo mesmo caminho do chat.** O anexo da biblioteca do `/chat`
mudou para `lib/conversa-envio.ts` (`enviarDocumentoNaConversa`), e a campanha
chama a mesma função: linha `pendente` na conversa com o `documento_id` (o
arquivo não é copiado), o arquivo sobe à Meta por id e a resposta casa a linha.
O motor confere de novo, no envio, que o arquivo não foi arquivado.

**Validação** (`problemasDoFluxo`, `conferirFluxo`): dias não vazios, únicos e de
0 a 6; HH:MM com o fim depois do começo; quantidade inteira de 1 a 10 mil e
intervalo de 1 s a 30 dias; a regra da condição completa e com ids que existem
(tag, segmento, funil e etapa do mesmo funil, chave de `campos_personalizados`
do contato); o arquivo existente, não arquivado e imagem, PDF ou vídeo, e só
depois de uma resposta. Quem salva ou ativa um fluxo com Enviar arquivo precisa
ver o módulo Documentos; a Condição não pede nada além de Campanhas.

**A IA de atendimento calada** segue as duas saídas da Condição e todos os
caminhos do Alternar (basta um falar), conta o Enviar arquivo como mensagem e trata Horário e Permissão como
passagem, não como espera.

**Opções** (`lerOpcoesDaCampanha`): `documentos` (id, nome e tipo `imagem`,
`pdf` ou `video`, só os não arquivados e no formato e tamanho que a campanha
manda) e `camposContato` (chave e rótulo).

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
| `PUT …/[id]` | grava o fluxo de uma campanha pausada ou rascunho e, com `segmentoIds`, o público |
| `POST …/[id]/retomar` | pausada → ativa, revalidando tudo |

- **Resposta durante a pausa:** a saída fica gravada (`em_andamento`) e anda na
  retomada. O prazo do Aguardar segue correndo; o que venceu sai na primeira
  rodada depois de retomar.
- **Editar:** quem estava num bloco apagado termina como `concluida`, com
  evento. Trava de ids: um bloco que já existe na definição gravada não muda de
  tipo, e um id que já rodou nesta campanha e saiu da definição (aposentado)
  não volta. A recusa vem com `{ erro, problemas }`, conferida com a linha
  travada na mesma transação da gravação (`salvarEdicao`).
- **Trocar o público** (desde 2026-10-28, no nó de início do editor): o `PUT`
  com `segmentoIds` passa pelas conferências da criação (ao menos um segmento,
  todos existem, há contato com WhatsApp). Na mesma transação, troca
  `campanha_whatsapp_segmentos` e as colunas antigas `segmento_id` e
  `segmento_nome`. Quem não está em nenhum segmento da campanha e não terminou
  (`na_fila`, `em_andamento`, `aguardando_resposta`) vira `concluida`, com o
  evento `fora_do_publico`; isso vale também para quem saiu do segmento por
  conta própria. Quem entrou nos segmentos é inscrito quando a campanha vai ao
  ar (ativação ou retomada). A tela pede confirmação quando um segmento sai.
  Pela IA do construtor, o público só muda em campanha nova.
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
- **Cabeçalho de imagem, vídeo ou documento** (desde 2026-10-28): o arquivo vem
  da biblioteca, em `variaveis.midia` (id de `documentos`). Ao salvar e ativar,
  `conferirFluxo` confere que ele existe e serve ao cabeçalho que o template pede
  (`problemaDoArquivoDoCabecalho`: não arquivado, tipo, formato e tamanho). A IA
  do construtor vê em `listar_alvos_campanha` o `midia` de cada template e lê e
  devolve o mesmo id.

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

## Métricas e gasto (desde 2026-10-28)

`GET /api/meta/whatsapp/campanhas/[id]/metricas` (mesma tranca da listagem) devolve
`MetricasCampanha` (`lib/campanhas-metricas-tipos.ts`), montado em
`lib/campanhas-metricas.ts`. A tela pede ao abrir a campanha e no botão de atualizar,
sem polling.

- **Funil:** entraram, enviados, entregues e lidos, responderam, conversões, falhas e
  descadastros. Entregues e lidos casam o `wamid` do evento `bloco` do envio de
  template com `mensagens.id_externo`, pelo status que o webhook grava. Texto livre
  e arquivo ficam fora.
- **Por bloco:** agora e passaram; nos blocos Enviar template, também entregues e lidos.
- **Falhas por motivo:** o `erro` das execuções que falharam, agrupado. Substitui a
  lista que lia `campanhas_whatsapp.falhas`, coluna que nada escreve.
- **Gasto** (`lib/whatsapp-custo.ts`): é o custo real que a Meta informa.
  - Faz `GET /<WABA>/template_analytics` com COST e DELIVERED, em lotes de até 10
    ids de template, de `ativada_em` até amanhã, no máximo 90 dias. O id do template
    sai de `message_templates`.
  - O custo por entrega de cada template (gasto ÷ entregas da Meta no período)
    multiplica as entregas desta campanha.
  - Saem também o custo por resposta e por conversão, na moeda da conta.
  - Fica em cache de 1 h; falha não entra no cache.
  - Só leitura. As estatísticas de template precisam estar confirmadas na WABA, no
    WhatsApp Manager. Sem isso, a situação é `sem_estatisticas`. Conta que divide a
    linha de crédito de um parceiro não recebe custo e fica em `sem_custo`. O CRM nunca
    liga as estatísticas sozinho: é escrita irreversível na Meta.
- **Imprecisões conhecidas:**
  - a entrega de um bloco apagado conta no funil, mas não no gasto;
  - se um bloco trocou de template numa edição, as entregas antigas entram no
    template novo.

## A tela do construtor (refeita em 2026-10-28)

Pedido dele: "muito texto, sem condições".

- **Modo foco:** criando ou editando, somem as colunas de Canais e a lista; o Esc fecha
  o painel e depois sai, perguntando se há mudança não salva.
- **Paleta compacta e recolhível:** grupos Mensagem, Espera, Controle, CRM e Equipe; o
  nome completo e a descrição ficam no `title`.
- **Painel do bloco:** flutua sobre o canvas, sem encolhê-lo.
- **Cartões de 240 px**, com título text-sm. A pendência é um ponto âmbar, com a frase
  no `title`; a lista inteira só abre pela pílula de pendências.
- **Regras** num "?" com `title`. A janela de 24 h está só no selo "depois de uma
  resposta" do Enviar texto e do Enviar arquivo.
- **Métricas** na campanha aberta: a faixa do funil e do gasto, e entregues e lidos nos
  cartões de template.

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
