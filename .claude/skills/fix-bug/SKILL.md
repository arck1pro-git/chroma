---
name: fix-bug
description: Investiga um bug do AmaanOffice até a causa raiz, corrige com a menor mudança e prova a correção com a mesma reprodução. Só quando o usuário chama.
argument-hint: "<sintoma: o que, onde, desde quando, DEV ou produção>"
disable-model-invocation: true
---

Sintoma: $ARGUMENTS

Se faltar o essencial (o que acontece, em que tela ou rota, DEV ou produção), pergunte e pare.

## 1. Reproduzir

- Reproduza no DEV: script pelo runner (`CLAUDE.md`, seção 5), consulta de leitura no banco DEV ou o dev server.
- Guarde o comando e a saída que mostram a falha. Essa é a prova de antes.
- Sem reprodução, o que vem depois é hipótese, e o relatório diz isso.
- Se a resposta só existe na produção, pare e diga qual consulta ou log o usuário precisa olhar. Produção não se
  acessa, nem para leitura.

## 2. Achar a causa

- Evidência antes de teoria: erro e stack, log, linhas no DEV, `git log -S`, `git log -L`, `git blame`.
- Liste as hipóteses concorrentes e o teste que separa cada uma. Desconfie da primeira que encaixa.
- Chegue à linha e ao mecanismo.
- Investigação longa pode ir para um agente: servidor para o `backend-engineer`, tela para o `frontend-engineer`,
  busca larga para o `Explore`.

## 3. Corrigir

- Corrija a causa, não o sintoma, com a menor mudança, pelo dono do arquivo (`CLAUDE.md`, seção 10).
- Procure o mesmo padrão no resto do código com `Grep`. Corrija o que está no escopo e liste o resto como
  pendência.
- Nada de esconder o erro, afrouxar tipo ou desligar regra de lint.

## 4. Provar

1. Rode de novo a reprodução do passo 1. Ela tem que passar agora.
2. Rode a skill `/verify` no que mudou.
3. Mande o diff ao `code-reviewer`. Mande também ao `security-reviewer` quando a causa ou a correção tocar acesso,
   rota, integração, IA ou dados pessoais.
4. Achado crítico ou alto volta para correção. No máximo duas rodadas; o que sobrar vira pendência.

## Relatório

- Sintoma e reprodução, com a saída de antes.
- Causa raiz: mecanismo, evidência e hipóteses descartadas.
- Correção: arquivos e o porquê de cada mudança.
- Prova: a mesma reprodução passando, e a tabela do `/verify`.
- Outros lugares com o mesmo padrão e o que foi feito com eles.
- Pendências: o que precisa ser conferido na produção, migration ou variável a aplicar.

## Critério de conclusão

- A reprodução falhava antes e passa depois, ou o relatório diz por que não foi possível reproduzir.
- `/verify` sem erro novo e revisão sem achado crítico ou alto aberto.
- Nada commitado.
