# Blog

O módulo escreve artigos de SEO a partir de notícias, passa cada um por revisão
humana e entrega os postados ao site do cliente. Reformulado em 2026-11-05.

## As telas

| Rota | O que é |
| --- | --- |
| `/blog` | os blogs em cartões: em revisão, postados, se está na automação; criar e configurar |
| `/blog/<id>` | o blog, em três abas (a aba fica em `?aba=`) |
| `/blog/<id>?demo=1` | a mesma tela com dados fictícios (`app/mock/blog.json`), só em desenvolvimento |

As três abas de `/blog/<id>` (`app/blog/[id]/tela-blog.tsx`):

- **Artigos**: o quadro **Pautas → Em revisão → Postado** (`quadro.tsx`). Pauta é
  notícia das fontes que ainda não virou artigo. Arrastar uma pauta para "Em
  revisão" (ou clicar em Gerar) escreve o artigo, e isso leva de 1 a 3 minutos.
  Arrastar de "Em revisão" para "Postado" publica: a rota pública passa a
  servir o artigo em até 5 minutos. Arrastar de volta tira do site. Os cartões
  de Postado mostram cliques, impressões e posição do Google.
- **Desempenho**: o site no Search Console (cliques, impressões, CTR e posição,
  contra o período anterior, e quanto disso é do blog), o dia a dia, as
  consultas e páginas do topo, e cada artigo postado (`desempenho.tsx`). Antes de
  conectar, a aba é o passo a passo de conexão (`conectar-google.tsx`).
- **Automação**: o robô do n8n (ligar, pausar, próxima rodada, últimas rodadas),
  o interruptor do blog dentro dele e as fontes de notícia, com sugestões
  conferidas e a saúde de cada feed (`automacao.tsx`).

Os estados no banco continuam `pendente` e `aprovado`; só os rótulos mudaram
(`ARTIGO_STATUS_LABEL` em `lib/artigo.ts`). A configuração do blog (nome,
descrição, endereço, autor) e a conexão com o site ficam na mesma gaveta
(`gaveta-blog.tsx`). A descrição é o campo que mais pesa: a IA a lê para
escolher as notícias e para dar o ângulo de cada artigo.

## Google (Search Console)

`lib/blog-google.ts`, sobre o cliente de `lib/search-console.ts` (conta de
serviço, `GOOGLE_SA_EMAIL` / `GOOGLE_SA_PRIVATE_KEY`).

- **Não há coluna "qual propriedade".** A propriedade é achada pelo endereço do
  blog entre as que a conta de serviço enxerga. Uma propriedade de domínio
  (`sc-domain:x`) vence uma de prefixo. Conectar um site é um passo só, feito no
  Google: adicionar o e-mail da conta como usuário **Restrito** em Configurações
  → Usuários e permissões. A aba mostra o e-mail e confere de novo com um botão.
- **O recorte do blog** vai como filtro para o Google (página contendo
  `host/caminho-do-blog`). O artigo é casado pela URL inteira ou pelo slug no fim
  do caminho, somando as variantes com e sem `www` e com e sem barra.
- **A janela** termina ontem, no fuso do Pacífico (o do Search Console), com
  dados frescos (`dataState: all`). O último dia ainda sobe, e o gráfico o
  desenha tracejado.
- **Guardado em memória** (`lembrar`, `lib/meta.ts`): propriedades por 5 min,
  números por 15 min, inspeção de indexação por 6 h. A inspeção tem cota de
  2.000 por dia por propriedade e só roda quando a aba Google de um artigo abre.
  Nada vai para o banco: guardar o histórico é decisão de modelagem em aberto.

Rotas (sessão + módulo Blog, só leitura): `GET /api/blogs/<id>/google?dias=7|28|90`
e `GET /api/artigos/<id>/google`. `&atualizar=1` força a ida ao Google.

## A automação de artigos

Um workflow só no n8n para o CRM inteiro, `[Chroma] Blog · artigos por RSS`
(`lib/blog-rss-workflow.ts`). A agenda fica em `AGENDA_AUTOMACAO`
(`lib/blog-automacao-tipos.ts`): **de segunda a sexta, às 7h de Brasília, 2
artigos por blog**. Até 2026-11-05 rodava toda segunda às 8h, com 10 por blog.

```
[Seg a sex, 7h] → POST /api/blogs/rss/pauta → um item por vez → POST /api/blogs/rss/gerar
```

1. **Pauta** (`lib/blog-pauta.ts`, `curar: true`): blogs com `rss_ativo` e fonte
   cadastrada. Entram as notícias das últimas 72 h que ainda não viraram artigo,
   escolhidas pela curadoria.
2. **Curadoria** (`lib/blog-curadoria.ts`): uma chamada ao Claude Opus 5.5, com
   esforço baixo, que lê só os títulos (como dado, `lib/ia/sanitizar.ts`) e a
   descrição do blog e devolve os números das notícias escolhidas, em ordem.
   Deixa de fora cotação do dia e assunto sem relação com o blog. Se falhar, ou
   se o blog não tiver descrição, vale a ordem por data.
3. **Geração** (`lib/artigo-geracao.ts`, a mesma do botão da tela): lê a matéria
   (Jina) e escreve o artigo, que nasce em "Em revisão". A pauta traz 3
   candidatos a mais que a cota, porque matéria com paywall falha antes de gastar
   token. A rota de geração para quando o blog completa a cota do dia
   (`artigosDeHoje`).

**Ligar e pausar** (`lib/blog-automacao.ts`, `POST /api/blogs/rss/workflow`):
pela aba Automação, quem tem Editar no Blog, **só em produção** (`VERCEL_ENV`).
A instância do n8n é a mesma para DEV e produção (e dividida com o SprintHub), e
o workflow é achado pelo nome. Por isso o endereço nos nós é sempre o domínio de
produção (`ENDERECO_DO_CRM`). Ligar é idempotente: cria se não existe; se
existe, pausa, reescreve com a forma atual e liga. É assim que uma mudança de
agenda chega ao n8n. A aba avisa "versão anterior" quando o workflow no n8n
difere do código.

**Fontes**: até 5 feeds por blog (`MAX_FEEDS`). As sugestões (`FONTES_SUGERIDAS`)
foram conferidas: o feed traz notícia do dia e a matéria abre sem paywall. O
leitor de feed respeita a codificação declarada (o de Mercado da Folha vem em
ISO-8859-1).

## Verificação

`node --env-file=.env scripts/jiti.mjs scripts/testar-blog.ts`. Usa um Search
Console, um n8n e uma API da Anthropic falsos (o `fetch` é interceptado e
nenhum endereço de fora é chamado). Contra o DEV, cria um blog marcado e o
apaga no fim. Confere a escolha da propriedade, o casamento página → artigo, a
janela, os estados de conexão, o desempenho e um artigo, a forma e o estado do
workflow, o ligar, a curadoria e a sua volta à ordem por data, a pauta da
rodada e a cota do dia.
