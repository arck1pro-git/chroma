# Cadência de etapa — as "subetapas" são uma automação

## A ideia

O painel de subetapas da raiz não desenha uma entidade própria. Ele desenha
**um fluxo de automação amarrado a uma etapa**, projetado em colunas:

```text
__entrada__ → [esperar] → mensagem 1 → esperar 1d → mensagem 2 → esperar 2d → mensagem 3
                              ↓                          ↓                        ↓
                          coluna 1                   coluna 2                 coluna 3
                           (dia 0)                    (dia 1)                  (dia 3)
```

Uma fonte só. O que a coluna escreve é o mesmo JSON que o builder de
`/automacoes/<id>` abre, o mesmo que o compilador publica e o mesmo que a IA
grava por prompt. Não existe formato paralelo para divergir.

A tradução mora em `lib/automacoes/cadencia.ts`:

| | |
|---|---|
| `lerCadencia(definicao)` | fluxo → colunas. Soma as esperas; cada bloco de mensagem vira uma coluna, no dia acumulado. |
| `escreverCadencia(colunas)` | colunas → fluxo. As diferenças de `dia` viram blocos de espera. |

### Quando a projeção não cabe

Nem todo fluxo é uma corrente. Um `se`, um `alternador`, duas arestas saindo do
mesmo bloco ou um nó órfão fazem `lerCadencia` devolver `linear: false`. O painel
então mostra o aviso e manda para o builder, em vez de desenhar colunas que
esconderiam metade do fluxo — e salvar dali apagaria o resto.

## O ciclo, na ordem dos botões

```text
escrever (à mão ou por prompt) → Salvar → [Rodando | Pausada] → Disparar
```

- **Salvar** grava a versão (`fluxo_versoes`) **e leva ao n8n**: cria ou
  atualiza o workflow lá, com o webhook e os blocos prontos. Não há botão
  "Publicar" separado — a cadência **é** a automação do motor, não uma lista que
  vira automação depois.
- **O interruptor** liga e desliga esse workflow (`activate`/`deactivate`).
  Cadência nova nasce **pausada**; salvar de novo não liga sozinha o que estava
  parado, nem para o que estava rodando.
- **Disparar** inscreve as oportunidades **abertas** da etapa: uma linha em
  `fluxo_execucoes` por oportunidade e um POST no webhook por inscrição. É a
  única ação em lote, e só funciona com a cadência rodando — pausada, o motor
  nem reconhece o webhook (404).

Clicar duas vezes em Disparar não duplica envio: quem já está dentro do fluxo é
barrado pelo índice parcial `ux_execucao_ativa_por_entidade` — o segundo clique
pega só quem entrou na etapa desde o primeiro.

## Onde a oportunidade cai

Duas fontes, nesta ordem de confiança (`app/inicio/subetapas.ts`):

1. **O último bloco que o motor executou para ela** (`posicaoNaCadencia`, em
   `lib/automacoes/repositorio.ts`). É fato.
2. **A régua de dias**, para quem nunca entrou no fluxo: a última mensagem cujo
   `dia` já venceu para a idade da oportunidade. É previsão — onde ela cairia se
   a cadência disparasse agora.

Com uma cadência nos dias `[0, 1, 3, 10]` e ninguém inscrito ainda:

| idade | coluna |
|---|---|
| hoje (0) | 1ª |
| 1 dia | 2ª |
| 2 dias | 2ª — a 3ª só sai no dia 3 |
| 3 dias | 3ª |
| 40 dias | 4ª, contada em "já passaram da última" |

A régua sozinha era a regra antiga, de quando a posição não podia ser mudada.
Ela mentiria para quem está dentro do fluxo: a oportunidade de 40 dias movida
para a 2ª mensagem continuaria desenhada na última.

## Tirar uma oportunidade da cadência

O botão no card (`removerDaCadencia`) cancela a inscrição dela e a espera
pendurada nela. A partir dali nada mais é enviado para aquele contato por este
fluxo. Ele só aparece para quem **está** no fluxo: para quem nunca entrou, a
coluna é previsão e não há inscrição para cancelar.

Isso exige **duas pontas**, e as duas precisam existir:

- **No CRM**, o cancelamento da linha em `fluxo_execucoes` (e da espera em
  `fluxo_esperas`).
- **No executor** (`lib/automacoes/executor.ts`), a recusa de bloco cuja
  inscrição não está mais viva: `pulado`, sem gravar passo. Do lado do motor a
  execução continua parada num Wait e um dia acorda — sem essa trava, "removi
  da cadência" duraria até o próximo despertar do n8n.

Sair **não é "nunca mais"**: o próximo Disparar inscreve as oportunidades
abertas da etapa, esta inclusive. Uma exclusão permanente pediria uma coluna
para guardar quem não deve voltar.

### O que foi tentado antes: arrastar entre mensagens

O quadro chegou a arrastar. Soltar um card em outra coluna cancelava a
inscrição, criava outra e chamava o webhook com `comecar_em`; um Switch logo
depois do Webhook (modo `expression`) mandava a execução direto para aquele
bloco. Funcionou de ponta a ponta — foi verificado no n8n, com a execução
entrando na 3ª mensagem e pulando as duas primeiras.

Saiu mesmo assim, e o motivo é de produto, não técnico: **mover promete uma
precisão que a cadência não tem**. A coluna é onde o motor chegou, não um lugar
onde se põe alguém; e "empurrar" um contato para a 4ª mensagem significava
mandar aquele texto na hora, fora de qualquer régua de dias. Remover é o que
resolve o caso real — tirar alguém do caminho de uma sequência que já está
rodando — e é uma promessa que o sistema cumpre inteira.

Com ele saíram o `entrada.alternativas` do compilador e o Switch do adaptador.
O que ficou dessa rodada, e continua valendo por si, é a recusa de bloco de
execução morta no executor.

## De qual número sai

**Uma instância por mensagem**, escolhida no formulário da coluna entre as
registradas em Configurações (`instancias_uazapi`). O id vai na config daquele
bloco (`instancia_id`), e o executor resolve base_url/token no servidor — o
token nunca chega ao navegador nem ao motor.

É por mensagem, e não por cadência, porque é assim que uma sequência começa no
número do SDR e termina no do closer. O cabeçalho de cada coluna mostra o nome
da instância: com uma por mensagem, ler a cadência de fora é a única forma de
perceber que a 5ª sai por outro número.

Sem escolha, cai na instância do `.env`. Se a instância escolhida for apagada em
Configurações depois de publicada, o bloco **falha** em vez de cair no `.env`
calado: cair no `.env` mandaria a mensagem pelo número compartilhado com o
SprintHub.

## Os canais, sem promessa a mais

| coluna | bloco | o que acontece de verdade |
|---|---|---|
| WhatsApp | `enviar_whatsapp_web` | envia pela uazapi; a mensagem aparece no `/chat` do contato |
| Ligação | `enviar_notificacao` | vira linha no histórico do contato — o motor não disca |
| E-mail | `enviar_email` | **não sai**: o motor pula o bloco e registra o motivo |

## Variáveis do texto

`{{nome}}`, `{{primeiro_nome}}`, `{{oportunidade}}`, `{{valor}}`.

Lista fechada de propósito. `{{sobrenome}}` sai **literal** no WhatsApp do
cliente — é o aviso mais barato de que a variável não existe. Trocar por vazio
esconderia o erro.

## As travas antes do primeiro disparo real

A instância uazapi é compartilhada com o SprintHub (`docs/automacoes-n8n.md`
§5.1). Duas travas, em `lib/automacoes/servico.ts`:

- `AUTOMACOES_DISPARAR` — enquanto não for exatamente `"true"`, o executor
  resolve o contato, monta o texto e grava o passo, e **não** chama a uazapi.
  Nada é gravado em `mensagens`: conversa falsa no `/chat` seria pior que não
  ter registro. Vale para o arraste também.
- `AUTOMACOES_MSGS_POR_MINUTO` — teto do CRM inteiro, padrão 12, contado sobre
  os passos do último minuto.

## Antes de ligar

1. Rodar `migration-cadencia-etapa.sql` (`fluxos.etapa_id` + as partições de
   `fluxo_execucao_passos`, que existiam só até julho/2026).
2. `N8N_BASE_URL`, `N8N_API_KEY` e um `CRM_BASE_URL` que o n8n alcance. O
   `CRM_SERVICE_TOKEN` já está no `.env` e é o que autentica os nós de volta
   (docs/automacoes-n8n.md §3) — nada a cadastrar no motor.
3. Salvar a cadência **depois** de conferir a instância de cada mensagem: sem
   ela escolhida, o bloco cai na do `.env` — o número compartilhado com o
   SprintHub. Salvar é o que republica no motor.
4. Disparar **em simulação** e conferir o texto de uma prévia.
5. Só então `AUTOMACOES_DISPARAR=true`.
