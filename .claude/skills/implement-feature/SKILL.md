---
name: implement-feature
description: Planeja, implementa, verifica e revisa uma mudança no AmaanOffice com os subagentes do projeto (backend-engineer, frontend-engineer, code-reviewer, security-reviewer). Só quando o usuário chama.
argument-hint: "<o que construir>"
disable-model-invocation: true
---

Pedido: $ARGUMENTS

Se o pedido estiver vazio, pergunte o que construir e pare. As regras de convenção, segurança e autorização estão no
`CLAUDE.md` (seções 4, 6 e 10); esta skill só define a ordem do trabalho.

## 1. Entender, sem editar

- Localize os módulos envolvidos. Busca larga vai para o agente `Explore`; arquivo conhecido, leia direto.
- Leia o cabeçalho, os contratos e os chamadores de cada módulo tocado.
- Para cada API do Next que entrar no código, leia a página em `node_modules/next/dist/docs/`.
- Tabela ou coluna que o usuário não especificou: descreva a necessidade e as opções e pare.
- Ambiguidade que muda o resultado: pergunte. Detalhe de rotina: decida e registre no relatório.

## 2. Plano

Escreva um plano curto com:

- os arquivos de cada dono, numa tabela (`backend-engineer`, `frontend-engineer` ou a sessão principal);
- o contrato servidor e tela: assinatura da ação ou rota, tipo de retorno (`ResultadoAcao<T>`) e erros;
- a verificação prevista (skill `/verify`) e os riscos.

Mudança em acesso, rota pública, integração externa, IA ou dados pessoais: mande o plano ao `security-reviewer`
antes de implementar.

Mudança pequena, de um ou dois arquivos numa camada só, a sessão principal faz sem subagente. O resto do fluxo vale
igual.

## 3. Implementar

- Chame cada agente pelo Agent tool com `subagent_type` igual ao nome dele. Se o tipo não existir na sessão, use
  `general-purpose` e mande seguir `.claude/agents/<nome>.md` como papel.
- Cada agente recebe o pedido, o contrato, a lista exata de arquivos que pode editar, o que não pode tocar e a
  verificação esperada.
- Nunca dois agentes no mesmo arquivo. Mudança na área do outro volta para a sessão principal.
- Backend antes quando a tela depende do contrato. Em paralelo só com contrato fechado e listas de arquivos
  disjuntas.
- Trabalho paralelo grande ou arriscado: proponha ao usuário uma branch ou worktree por frente (`CLAUDE.md`,
  seção 10).

## 4. Verificar e revisar

1. Rode a skill `/verify` no que mudou.
2. Mande o diff inteiro ao `code-reviewer`. Mande também ao `security-reviewer` quando tocar acesso, rota,
   integração, IA ou dados pessoais.
3. Achado crítico ou alto volta ao agente dono do arquivo, seguido de nova verificação.
4. No máximo duas rodadas de correção. O que sobrar vai para o relatório como pendência, com a saída real.

## 5. Fechar

- Atualize a documentação viva (`CLAUDE.md`, seção 11) ou aponte o que falta.
- Relate o que foi feito, arquivos e donos, contrato, verificação com saída real, achados da revisão e o destino de
  cada um, e pendências (migration a aplicar, variável nova, conferência visual).
- Nada de commit, push, migration ou deploy sem pedido explícito.

## Critério de conclusão

- `tsc` e `eslint` sem erro novo nos arquivos tocados, e os scripts relevantes de `/verify` passando.
- Nenhum achado crítico ou alto aberto sem justificativa dita ao usuário.
- Documentação atualizada ou pendência apontada.
- Nada commitado.
