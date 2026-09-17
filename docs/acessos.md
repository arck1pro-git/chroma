# Acessos: departamentos e módulos

Quem vê o quê, e onde mudar isso. O login está em [auth.md](auth.md) — aqui é o
que vem **depois** de entrar.

Até 2026-09-16 não havia nada disto: quem tinha cookie válido via todos os
módulos — funil, automações, webhooks, chaves de blog, Configurações inteira.

## A ideia em uma frase

**Pessoa → departamento → módulos.** Nenhuma permissão está escrita em
TypeScript: a linha `departamento_modulos` é que manda, e o TI muda isso na tela
sem deploy.

## As peças

| Arquivo | Papel |
|---|---|
| `migration-departamentos.sql` | As duas tabelas e o acesso inicial |
| `lib/auth/modulos.ts` | O catálogo do que **existe** (código) |
| `lib/auth/dal.ts` | `exigirModulo()` / `exigirGerenciaAcessos()` |
| `app/configuracoes/acessos/` | A tela do TI |
| `app/configuracoes/acoes-acessos.ts` | As mutações, todas com guarda |

## Código diz o que existe; banco diz quem alcança

A divisão não é arbitrária. Um módulo **é** uma rota com `page.tsx`, e nenhuma
linha de banco cria `/agenda`. Então:

- `lib/auth/modulos.ts` lista o que existe. Muda por deploy.
- `departamento_modulos` diz quem alcança. Muda por clique.

Por isso `departamento_modulos.modulo` é `text` **sem CHECK e sem FK**: um CHECK
obrigaria uma migração a cada módulo novo, na ordem certa em relação ao deploy,
senão o INSERT falha. O preço é linha órfã quando um módulo sai do código — e
ela é peneirada contra o catálogo na leitura, em silêncio, nos dois lugares que
leem (`lib/auth/dal.ts` e `app/configuracoes/dados.ts`).

## Ausência de linha é negação

Não existe linha "negado". Departamento novo nasce **sem nada** e recebe o que
alguém marcar — mesmo princípio do `proxy.ts`, que fecha por padrão.

Módulo novo também nasce sem ninguém. Depois de criar o `page.tsx`, é preciso ir
em Configurações · Acessos e marcar quem recebe. Isso é de propósito: o esquecido
é invisível, não aberto.

## O acesso inicial

| | Comercial | Admin | TI |
|---|---|---|---|
| Dashboard, Chat, Agenda | ✓ | ✓ | ✓ |
| Métricas | ✓ *(só as dele)* | ✓ *(de todos)* | ✓ *(de todos)* |
| E-mails, Campanhas, Blog, Contextos, Meta, Integrações | | ✓ | ✓ |
| Automações, Webhooks, Configurações | | | ✓ |
| Administra acessos | | | ✓ |

Isto é o **seed**, não a regra: a tabela acima descreve o banco no dia em que a
migração rodou. A partir daí quem manda é a tela.

## Escopo: 'proprio' e 'todos'

`departamento_modulos.escopo` é o que separa "o comercial vê as métricas dele"
de "o admin vê as de todos" sem que isso seja um `if` em TypeScript.

O escopo tem que entrar **na consulta**. `exigirModulo()` devolve
`{ usuario, escopo }` e quem chama é obrigado a usar:

```ts
const { usuario, escopo } = await exigirModulo("metricas");
const dados = await carregarMetricas(escopo, usuario.id, periodo);
```

Filtrar na renderização não serve: o dado viajaria pro navegador do mesmo jeito,
e aí basta abrir o DevTools pra ler o número do colega.

Só oferece escopo o módulo marcado `escopavel` no catálogo — hoje, só Métricas.
O Dashboard **não** é escopável, e a razão é honesta: o quadro do funil mostra a
oportunidade de todo mundo e a gaveta de contatos idem. Marcar como escopável sem
filtrar de verdade prometeria na tela o que o dado não cumpre.

## Por que a permissão não é conferida no proxy

Mesma razão do login (ver [auth.md](auth.md)): o proxy roda em **toda**
requisição, inclusive nos prefetch que o `<Link>` dispara ao aparecer na tela.
Uma consulta ali seria uma por link visível.

E há uma segunda razão, mais forte: o cookie dura 7 dias. Uma cópia da permissão
dentro dele ficaria velha — alguém rebaixado continuaria entrando onde não devia
até o cookie expirar. Foi por isso que a claim `papel` **saiu** do JWT. Cookie
antigo que ainda a carrega continua valendo; a claim é ignorada.

## A portaria da portaria

`departamentos.gerencia_acessos` é uma coluna, **não** o módulo `configuracoes`.

Se a tela de Acessos fosse liberada por linha de `departamento_modulos`, quem
tivesse Configurações poderia se dar qualquer módulo — inclusive os três que o
Admin não tem. Separado assim, Configurações é uma coisa (funis, tags, usuários)
e "mexer em quem vê o quê" é outra.

### As travas contra se trancar do lado de fora

Não há tabela de sessão nem tela de recuperação: se todo mundo perder o acesso à
tela de Acessos, o conserto é `UPDATE` manual no banco. Daí estas quatro:

1. Você **não** tira `gerencia_acessos` do seu próprio departamento.
2. Ao menos **um** departamento tem que mantê-la.
3. Você **não** se move para um departamento que não administra acessos (mover
   *outra* pessoa pra fora é decisão administrativa legítima e passa).
4. Departamento `sistema` (Comercial, Admin, TI) não se apaga; nenhum
   departamento com gente dentro se apaga.

## Cadência: mora no Dashboard, pertence a Automações

O painel de subetapas aparece na raiz, mas o que ele faz é criar, publicar e
**disparar** fluxo de WhatsApp pela instância compartilhada. Então ele segue o
módulo `automacoes`, não o `inicio` que abriu a tela — tanto em
`app/inicio/acoes-cadencia.ts` quanto no carregamento em `app/page.tsx`, que nem
consulta quando a pessoa não tem o módulo.

Sem isso, tirar Automações do Admin não teria efeito nenhum: ele dispararia
cadência pelo dashboard.

## As duas exceções, e por quê

`/api/ia` e `app/components/acoes-ia.ts` ficaram em `exigirLogin`, sem módulo.
Não é esquecimento: o painel de IA abre em várias telas e a lista de conversas da
barra lateral junta análises de módulos diferentes. Prender qualquer um dos dois
a um módulo quebraria o recurso em todos os outros.

O que a IA alcança é limitado noutro lugar — as ferramentas de leitura em
`lib/ia/ferramentas.ts`. Se um dia uma delas devolver dado de módulo restrito, o
filtro entra **lá**, junto do dado.

## Operação

**Rodar a migração:**

```bash
node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs \
  scripts/rodar-sql.ts migration-departamentos.sql
```

É idempotente. O seed de módulos só roda para departamento que ainda não tem
nenhuma linha — rodar de novo **não** ressuscita acesso que o TI removeu na tela.

**Quem já tinha conta:** `papel='admin'` virou **TI**, o resto virou
**Comercial**. Admin foi pro TI de propósito: quem é admin hoje é quem montou
isto e precisa continuar alcançando Configurações depois da virada.

**Tirar o acesso de alguém sem apagar o histórico dela** continua sendo
`ativo = false` (ver [auth.md](auth.md)). Para tirar só um módulo, é a tela.

Os dois cortes valem no **próximo carregamento de página**, mesmo com o cookie
ainda válido — é a DAL que pega.

## O que isto ainda não é

- **Sem registro de quem mudou o quê.** Não dá pra saber depois quem tirou o
  módulo de quem, nem quando.
- **Permissão é por módulo, não por ação.** Quem alcança Blog pode publicar;
  não existe "só leitura" em lugar nenhum.
- **`nivel` não restringe nada.** Ordena a lista e documenta a hierarquia, e só.
  Não é ele que impede um departamento de mexer noutro — quem impede é
  `gerencia_acessos`, que só o TI tem.
- **Agenda é um módulo vazio.** Rota e permissão de pé, tela por fazer.
- **Métricas não tem ganhas/perdidas.** `oportunidades.status` é `'aberta'` em
  toda linha da base — nada escreve outro valor — e não existe registro de
  mudança de etapa. Os números da tela são os que o banco responde de verdade.
