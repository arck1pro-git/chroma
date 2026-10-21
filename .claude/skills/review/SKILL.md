---
name: review
description: Revisão de código do AmaanOffice pelo subagente code-reviewer. Revisa as alterações locais, um commit, uma branch ou arquivos e devolve achados priorizados com arquivo, linha, cenário de falha e correção. Use depois de mudança não trivial e antes de commit ou deploy. Só lê.
argument-hint: "[vazio = alterações locais | sha | branch | caminho]"
context: fork
agent: code-reviewer
---

Revise: $ARGUMENTS

## Escopo

- **Vazio:** tudo o que ainda não foi commitado. Use `git status --short`, `git diff HEAD` e os arquivos novos de
  `git ls-files --others --exclude-standard`.
- **sha:** `git show <sha>`.
- **branch:** `git diff master...<branch>`.
- **caminho:** os arquivos ou a pasta indicados, lidos inteiros.

Se não houver nada no escopo, diga isso em uma linha e pare.

## Passos

1. Liste os arquivos do escopo. Leia cada um e quem chama as funções alteradas.
2. Rode as verificações e guarde a saída real:
   - `npx tsc --noEmit -p .`
   - `npx eslint --no-warn-ignored --max-warnings=0 <arquivos .ts, .tsx, .js e .mjs do escopo>`
3. Revise pelos eixos do seu papel e prove cada achado com um cenário concreto.
4. Responda no formato do seu papel.

## Critério de conclusão

- Todos os arquivos do escopo foram lidos e aparecem listados no fim.
- A saída de `tsc` e `eslint` está no relatório, ou o motivo de não terem rodado.
- Cada achado tem severidade, `arquivo:linha`, cenário de falha, correção e confiança.
- O veredito diz se a mudança também precisa de `/security-audit`.

Não edite arquivo, não faça commit, não chame serviço externo.
