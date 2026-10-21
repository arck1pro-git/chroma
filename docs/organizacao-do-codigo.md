# Organização do código: diagnóstico e proposta

Levantamento de 2026-10-21, sobre o commit `cff464f`. Serve de mapa para quem for mexer na estrutura: o que está
bom e deve ficar, o que atrapalha a manutenção e o trabalho de agentes de IA, e a forma de corrigir aos poucos.

As seções 1 a 4 são o levantamento como foi feito, antes de qualquer mudança. O que já foi resolvido está no quadro
logo abaixo. O resto continua proposta: cada item só vira mudança com autorização do dono do produto, sem mudar
comportamento.

## Situação depois da limpeza de 2026-10-21

| Item | Situação |
|---|---|
| 3.1 Erro esperado lançado em server action | **Resolvido.** `lib/resultado-acao.ts`; conferido no build de produção (Tags, Segmentos, Acessos, Webhooks). |
| 3.2 Arquivos grandes | **Em parte.** `app/configuracoes/actions.ts` virou `acoes-funis`, `-tags-segmentos`, `-usuarios`, `-campos` e `-whatsapp` (o maior com 670 linhas). Os componentes de tela grandes ficaram: dividir exige conferência visual. Dois deles passaram de 1.000 linhas com o tratamento de erro novo (`app/webhooks/configuracao.tsx`, `app/configuracoes/secoes/funis.tsx`). |
| 3.3 `lib/` importando `app/` | **Em parte.** De 7 para 2. Leitura do quadro, métricas, leitura de webhooks, tipos e formatação foram para `lib/` (`funil.ts`, `metricas-funil.ts`, `webhooks-dados.ts`, `entidades.ts`, `formato.ts`). Ficaram as duas ferramentas de IA que escrevem pelas ações da tela; mudá-las tira a guarda de módulo desse caminho e pede revisão de segurança antes. |
| 3.4 Tipos dentro do mock | **Resolvido.** Tipos em `lib/entidades.ts`; mock de e-mails em `app/emails/mock.ts`; o resto do mock (morto) saiu com `app/data.ts`. |
| 3.5 Nomes inconsistentes | **Em parte.** Configurações segue `acoes-<assunto>.ts`. Os `actions.ts` antigos de outros módulos não foram renomeados (só junto de mudança no módulo). |
| 3.6 Validação repetida | **Resolvido para uuid.** `ehUuid` em `lib/validacao.ts` substituiu as ~50 cópias (72 usos). zod continua só onde já estava. |
| 3.7 Helpers e tipos duplicados | **Em parte.** `SqlPermissivo` num lugar só; `app/formato.ts` em `lib/formato.ts`; o `dataCurta` de Contatos, que era outra função com o mesmo nome (recebe instante, não data pura), virou `dataDoInstante` em `lib/formato.ts`, ao lado de `dataCurta`, e cada uma aponta a outra. As formatações de data avulsas (`toLocale*`, `Intl`) em ~29 arquivos ficaram. |
| 3.8 Sem `error.tsx`/`not-found.tsx` | Pendente (mudança funcional). |
| 3.9 Sem testes | Pendente (decisão do dono). |
| 3.10 Raiz carregada | **Em parte.** README reescrito e `scripts/tmp-cadencia.ts` removido. A pasta `migrations/` para as novas segue como proposta. |
| 3.11 Comentários desatualizados | **Resolvido** nos citados (`lib/db.ts`, tipos) e nos caminhos que mudaram com a limpeza. |

**Código morto removido**, conferido como sem uso em todo o histórico do Git ou desde a troca que o aposentou:
`app/blog/modal-artigo.tsx` (nunca importado), `app/contatos/filtros.ts`, `lib/supabase.ts` (o Realtime antigo; o
pacote `@supabase/supabase-js` e as variáveis `NEXT_PUBLIC_SUPABASE_*` saíram junto) e as funções `Paginacao`,
`moduloPorChave`, `documentoPorId`, `buscarVideo`, `corDaEtapa` e `passoDaCadencia`, com o CSS `.subetapa` e
`.subetapa-faixa` de `app/globals.css` que só elas alimentavam.

**Verificação que voltou a rodar:** `scripts/testar-cadencia-responsavel.mjs` estava quebrado desde 2026-10-15 (o
carregador não tratava `server-only` e o teste esperava a assinatura antiga de `enviarTexto`). Corrigido, ele passa
inteiro: cadência, publicação, envio, anexos, avisos e cadastro de instância vinculado.

Medido depois: tipos, lint (sem nenhum aviso) e build de produção limpos; nenhum ciclo de import; as 24 telas
principais respondem 200 no build de produção.

---

## 1. Estado medido

| Medida | Valor |
|---|---|
| Arquivos TS/TSX | 377 (268 em `app/`, 109 em `lib/`) |
| Páginas, layouts | 31 `page.tsx`, 2 `layout.tsx` |
| Rotas de API | 50 `route.ts` |
| Arquivos de server actions | 20 (`"use server"`) |
| Componentes cliente | 120 arquivos com `"use client"` |
| `npx tsc --noEmit -p .` | 0 erros (cerca de 15 s) |
| `npm run lint` | 0 problemas (cerca de 24 s) |
| Ciclos de import (valor) | 0 |
| Testes automatizados | nenhum |
| Arquivos acima de 1000 linhas | 8 |
| Arquivos entre 601 e 1000 linhas | 19 |

## 2. O que está bom e deve ficar

- **Segurança em duas camadas, documentada.** `proxy.ts` fecha tudo por padrão e a DAL (`lib/auth/dal.ts`) confere
  no banco a cada render. Guardas aparecem em 138 chamadas de `exigirModulo`, 41 de `exigirModuloApi` e nas demais.
- **Um único ponto de conexão com o banco** (`lib/db.ts`) e uma conexão separada, sem escrita, para a IA
  (`lib/ia/db.ts`).
- **Comentários que explicam o porquê**, com data e motivo. É o que permite a um agente entender uma decisão sem
  reabrir a discussão. `docs/` registra as decisões maiores.
- **Tipos e lint limpos**, sem ciclos de import, poucos `eslint-disable` (29, quase todos justificados no próprio
  comentário) e nenhum `@ts-ignore`.
- **Convenção de módulo reconhecível:** `app/<modulo>/page.tsx` + `dados.ts` + arquivo de ações + componentes.

A estrutura não precisa de reorganização geral. Os problemas abaixo são localizados e se resolvem aos poucos.

## 3. Problemas encontrados

Ordem: do que mais atrapalha (ou mais arrisca) para o que menos.

### 3.1 Erros esperados lançados com `throw` em server actions (resolvido em 2026-10-21)

Os arquivos `"use server"` têm 86 `throw new Error("mensagem para o usuário")` e 212 retornos `{ ok, erro }`. As
telas mostram `e.message` no `catch`. O guia do Next desta versão
(`node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md`) manda devolver erro esperado como
valor. O código do Next (`server/app-render/create-error-handler.js`) mostra que, em produção, a mensagem de erro
lançado no servidor é trocada por uma genérica ("...omitted in production builds..."), com um `digest`.

**Confirmado em 2026-10-21**, com `npm run build` e `npm run start` locais contra o banco DEV. Em Configurações ›
Tags, criar uma tag com nome que já existe (nada é gravado) dá resultados diferentes conforme o modo:

| Modo | O que a tela mostra |
|---|---|
| Produção (`next start`) | "Minified React error #441; visit https://react.dev/errors/441 for the full message or use the non-minified dev environment for full errors and additional helpful warnings." |
| Desenvolvimento (`next dev`) | "Já existe uma tag com esse nome" |

O log do servidor de produção registra a mensagem certa com um `digest`. Só o navegador recebe a genérica. Toda
tela que mostra `e.message` de um `throw` de server action tem o mesmo problema em produção. Por isso ele não
aparece no desenvolvimento.

**Corrigido em 2026-10-21.** O contrato está em `lib/resultado-acao.ts`:

- `ResultadoAcao<T>`: `{ ok: true, ...dados } | { ok: false, erro }`.
- `Recusa`: erro esperado lançado por uma função auxiliar, convertido na saída da ação.
- `comoResultado(fazer, { duplicado })`: roda o corpo, converte `Recusa` e o índice único (23505) em
  `{ ok: false, erro }` e deixa subir o resto, inclusive o `redirect()` do Next.

As ações de Configurações, Acessos, Webhooks, Funil (mover e criar oportunidade), Automações (criar fluxo e salvar
rascunho), Contatos (anotação, criar e atualizar) e Cadência devolvem o erro como valor. As telas e as ferramentas de
IA que as chamam (`lib/ia/tags-segmentos.ts`, `lib/ia/webhooks.ts`) leem `r.ok` e `r.erro`. As duas cópias locais
de `Recusa` (Configurações e Formulários) saíram em favor da compartilhada.

Conferido no build de produção local: Tags, Segmentos e Acessos mostram a mensagem certa, e o log do servidor fica
sem erro, porque recusa deixou de ser exceção.

**O que continua igual, de propósito:**
- Erro inesperado (banco fora, bug) segue lançado. Em produção a tela mostra a frase genérica do React para ele. Trocar
  essa frase por uma em português nas telas é outra mudança.
- Dois `throw` com mensagem ficaram em funções auxiliares cujos chamadores já capturam e devolvem como valor:
  `credenciaisDoMotor` em `app/automacoes/acoes.ts` e `templatesDoCanal` em `app/chat/actions.ts`.

### 3.2 Arquivos grandes com várias responsabilidades

| Arquivo | Linhas | O que mistura |
|---|---|---|
| `app/inicio/painel-subetapas.tsx` | 1561 | painel cliente inteiro: estado, efeitos, várias seções de tela |
| `lib/ia/atendente.ts` | 1484 | escolha da IA, histórico, áudio, chamada ao modelo, taxas da SCP, avisos |
| `app/inicio/inicio.tsx` | 1462 | tela raiz: quadro, gavetas, filtros, painéis |
| `lib/automacoes/motores/n8n/adaptador.ts` | 1442 | tradução de cada bloco para nó do n8n e cliente HTTP do n8n |
| `app/configuracoes/actions.ts` | 1206 | 30 ações de 7 assuntos: funis, etapas, tags, segmentos, usuários, campos, instâncias uazapi |
| `app/demandas/painel.tsx` | 1095 | duas abas de quadro, arrastar entre colunas, troca de visão, gaveta |
| `lib/automacoes/repositorio.ts` | 1082 | persistência de fluxos, versões e execuções |
| `lib/artigo.ts` | 1063 | tudo que deriva do markdown do artigo (coeso, apesar do tamanho) |

Arquivo grande custa caro para agente: ele precisa ler tudo para mudar uma parte, e a chance de conflito entre duas
mudanças paralelas cresce. **Proposta:** dividir só quando houver mudança funcional naquele trecho, pelo assunto que
já está marcado por comentário de seção. O precedente existe: `app/configuracoes/acoes-acessos.ts` já saiu do
`actions.ts`, e `app/configuracoes/secoes/` já separa as telas pelos mesmos assuntos. `lib/artigo.ts` não precisa
ser dividido.

### 3.3 `lib/` importando de `app/` (camada invertida)

`lib/` deveria ser a base que as telas usam, e não o contrário. Hoje há 7 imports no sentido errado:

| De | Para | Motivo |
|---|---|---|
| `lib/contatos-busca.ts` | `app/data.ts` | tipos de domínio |
| `lib/ia/ferramentas.ts` | `app/funil/dados.ts`, `app/inicio/metricas.ts`, `app/formato.ts` | leitura do funil, métricas, formatação |
| `lib/ia/tags-segmentos.ts` | `app/configuracoes/actions.ts` | cria tag e segmento pela ação da tela (decisão registrada no arquivo) |
| `lib/ia/webhooks.ts` | `app/webhooks/dados.ts`, `app/webhooks/acoes.ts` | leitura e escrita de webhooks |

A reutilização é intencional (mesma validação, mesmo `revalidatePath`). O problema é o sentido: a regra mora na
camada de tela. **Proposta:** quando o trecho for tocado, mover a regra para `lib/<dominio>` e fazer a ação da tela
e a ferramenta da IA chamarem a mesma função. A guarda de acesso continua na ação e na ferramenta.

### 3.4 Tipos de domínio dentro do arquivo de mock

`app/data.ts` (645 linhas) guarda os tipos das tabelas (`Contato`, `Oportunidade`, `Etapa`...), importados por 39
arquivos, junto com arrays de exemplo e um `USUARIO_ATUAL` fixo. Só `app/emails/lista.tsx` ainda usa os dados de
exemplo. O cabeçalho ainda diz "quando o banco entrar". **Proposta:** levar os tipos para um arquivo próprio em
`lib/` (só tipos, sem dado) e deixar o mock apenas para o módulo de e-mails enquanto ele não vai para o banco. É uma
mudança só de `import type`, sem efeito em execução.

### 3.5 Nomes inconsistentes

- Arquivo de server actions: `actions.ts` (6) e `acoes.ts`/`acoes-*.ts` (14).
- Arquivo de tipos: `tipos.ts`, `*-tipos.ts` e `data.ts`.
- `lib/` mistura pastas por domínio (`auth/`, `ia/`, `automacoes/`, `mcp/`, `social/`) com 80 arquivos soltos
  agrupados por prefixo (`meta-*` 8, `blog-*` 7, `artigo-*` 4, `google-*` 3, `demandas-*` 3, `contatos-*` 3).

**Proposta:** arquivo novo de ações se chama `acoes.ts` (maioria, e em português). Domínio novo com três ou mais
arquivos nasce em pasta. Nada é renomeado em massa: renomear só junto de uma mudança naquele módulo.

### 3.6 Validação repetida e sem padrão

A regex de uuid aparece 48 vezes em duas formas: a frouxa `[0-9a-f-]{36}` (33 vezes em 24 arquivos), que aceita 36
hífens, e a completa (15 vezes em 14 arquivos). Não há helper comum. zod está em 13 arquivos (IA, MCP, Meta Ads,
login, configurações); o resto valida à mão. **Proposta:** um helper único de validação em `lib/` (uuid, texto
cortado, enum) usado no código novo e no que for tocado; zod para corpo de rota e ferramenta de IA.

### 3.7 Helpers e tipos duplicados

- `dataCurta` existe em `app/formato.ts` e em `app/contatos/pecas.tsx`.
- `formatarTelefone` em `app/configuracoes/secoes/pecas.tsx` repete o papel de `telefoneLegivel` de
  `lib/telefone.ts`.
- O tipo `SqlPermissivo` está copiado em `lib/db.ts` e `lib/ia/db.ts`.
- 29 arquivos formatam data por conta própria (`toLocale*`, `Intl.DateTimeFormat`), o que abre espaço para erro de
  fuso na virada do dia.
- `app/formato.ts` é usado por `lib/` (ver 3.3).

**Proposta:** formatação de data, dinheiro e telefone num lugar só em `lib/`, com o fuso de Brasília explícito.
Trocar os usos ao tocar cada tela.

### 3.8 Sem `error.tsx`, `not-found.tsx` e `loading.tsx`

Nenhuma rota tem fronteira de erro ou estado de carregamento próprio. Um erro não tratado numa página cai na tela
padrão do Next. **Proposta:** um `app/error.tsx` e um `app/not-found.tsx` globais, no estilo do app. É mudança
funcional pequena e precisa de autorização.

### 3.9 Sem testes automatizados

A verificação de lógica depende de scripts manuais em `scripts/testar-*`, com dois jeitos de rodar (o `jiti-cli`
direto e o `scripts/jiti.mjs`). Lógica pura e crítica não tem rede: compilador de automações, cálculo de cadência,
normalização de telefone, montagem de escopo e permissões. **Proposta (decisão do dono):** `node:test`, que já vem
no Node, rodado pelo `scripts/jiti.mjs`, sem dependência nova, começando pelos módulos puros. Até lá, a verificação
segue o formato de script descrito no `CLAUDE.md`.

### 3.10 Raiz do repositório carregada

- 51 `migration-*.sql` e 2 `schema*.sql` na raiz, sem ordem no nome e sem registro de quais já rodaram no DEV e na
  produção. O nome delas é citado 99 vezes em código e docs, então mover as antigas quebraria referências.
- `README.md` ainda é o padrão do create-next-app.
- `scripts/tmp-cadencia.ts` é um script temporário versionado.

**Proposta:** migrations novas em `migrations/` com data no nome (`AAAA-MM-DD-assunto.sql`); as antigas ficam onde
estão. O registro de aplicação (tabela no banco ou lista em doc) é decisão do dono. O `README.md` passa a apontar
para o `CLAUDE.md`. O script temporário sai num commit de limpeza.

### 3.11 Comentários desatualizados

O cabeçalho de `lib/db.ts` ainda descreve o pooler do Supabase, mas o banco é o Neon (a configuração continua
válida). `app/data.ts` ainda se apresenta como mock à espera do banco. Comentário errado engana agente mais do que
falta de comentário. **Proposta:** corrigir junto da próxima mudança em cada arquivo.

### 3.12 Telas que dependem de outras telas (não é problema)

`app/inicio` importa 13 arquivos de `app/funil`. É esperado: a rota raiz junta Dashboard, quadro e contatos, e
`app/funil/` virou a pasta de recursos do quadro (não tem `page.tsx`). Fica registrado para ninguém "corrigir".

## 4. Organização proposta

Adequada ao Next 16 e ao que já existe. Não é um destino para atingir de uma vez: é a direção para o código novo e
para o que for tocado.

```
app/<modulo>/page.tsx      servidor: exigirModulo → carrega dados → compõe a tela
app/<modulo>/dados.ts      servidor: leituras da tela
app/<modulo>/acoes.ts      "use server": guarda → validação → chama lib/ → revalidatePath → { ok, erro }
app/<modulo>/*.tsx         componentes da tela; "use client" só onde há interação
app/components/            kit visual compartilhado, sem regra de negócio nem SQL
app/api/**/route.ts        entrada HTTP: tranca → validação → chama lib/ → Response
lib/<dominio>/ ou lib/<dominio>-*.ts
                           regra de negócio, consultas, integrações; nunca importa app/
lib/db.ts, lib/auth/       infraestrutura de banco e acesso
migrations/                migrations novas, com data no nome
scripts/                   operação e verificação (runner jiti)
docs/                      decisões e arquitetura
```

Fronteiras:

- `app/components/` não importa de `app/<modulo>/`, exceto tipos.
- `lib/` não importa de `app/`.
- Componente cliente não importa módulo com `server-only`.
- SQL fica em `lib/` e em `dados.ts`. Ação com SQL simples é tolerada no código existente; código novo passa pela
  função de `lib/`.

## 5. Ordem sugerida, se autorizado

Cada item em commit próprio, sem mudança de comportamento (exceto o 1 e o 6), com `tsc` e lint verdes.

1. ~~Trocar `throw` por retorno nas validações esperadas (3.1).~~ Feito em 2026-10-21.
2. ~~Tirar os tipos de domínio de `app/data.ts` (3.4).~~ Feito em 2026-10-21.
3. ~~Helper único de validação e de formatação (3.6, 3.7).~~ Feito para uuid e para o módulo de formatação; as
   formatações de data avulsas ficam para quando cada tela for tocada.
4. ~~Dividir `app/configuracoes/actions.ts` pelas seções que já existem (3.2).~~ Feito em 2026-10-21.
5. Mover para `lib/` as regras que a IA reutiliza das telas (3.3): feito para a leitura; falta a escrita das duas
   ferramentas de IA, depois de uma revisão de segurança do caminho sem a guarda da ação.
6. `app/error.tsx` e `app/not-found.tsx` (3.8).
7. Testes de lógica pura com `node:test` (3.9), se o dono quiser.
8. Limpeza da raiz: ~~`README.md`, script temporário~~ feitos; falta decidir a pasta `migrations/` (3.10).
9. Dividir os componentes de tela acima de 1.000 linhas, um por vez, com conferência visual.
