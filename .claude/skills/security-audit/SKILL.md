---
name: security-audit
description: Auditoria de segurança defensiva do AmaanOffice pelo subagente security-reviewer. Cobre autorização e escopo, segredos, injeção (SQL, n8n, prompt), SSRF, XSS, webhooks, rotas públicas, IA e dados pessoais. Alvo é o diff atual, um commit, uma branch, um módulo, uma rota ou um desenho proposto. Só lê; nada contra produção ou serviço real.
argument-hint: "[vazio = alterações locais | sha | branch | módulo ou rota | desenho proposto]"
context: fork
agent: security-reviewer
---

Audite: $ARGUMENTS

## Escopo

- **Vazio:** as alterações não commitadas (`git status --short`, `git diff HEAD`, arquivos não rastreados).
- **sha ou branch:** `git show <sha>` ou `git diff master...<branch>`.
- **Módulo** (por exemplo `chat` ou `app/chat`): `page.tsx`, ações, `dados.ts` e rotas em `app/api/` do módulo, e o
  que cada um chama em `lib/`.
- **Rota:** o `route.ts`, a entrada dela na lista do `proxy.ts` e tudo o que ela alcança.
- **Desenho proposto:** o texto recebido. Avalie antes de existir código e diga o que o código precisa garantir.

## Passos

1. **Mapeie a superfície** numa tabela: entrada, quem chama (usuário, n8n, Meta, uazapi, site, claude.ai), tranca,
   dado ou efeito alcançado.
2. **Ataque no papel** com cada ator do seu papel: sem sessão, logado de outro departamento, escopo próprio,
   remetente de webhook forjado, mensagem maliciosa lida pela IA.
3. **Prove** seguindo o código até o dado ou o efeito. Sem caminho concreto, marque como plausível.
4. Responda no formato do seu papel.

## Limites desta auditoria

- Defensiva: nada de requisição contra produção, contra o app rodando ou contra serviço externo.
- Não leia o `.env`. Se achar segredo escrito no código ou no histórico, cite `arquivo:linha` e o tipo do segredo,
  nunca o valor.
- Banco só o DEV, só leitura, e só se a sessão principal pedir.

## Critério de conclusão

- A tabela de superfície cobre todas as entradas do escopo.
- Cada achado tem ator, caminho, alcance, correção mínima e confiança.
- O que só se confirma na produção ou na configuração externa (Vercel, Meta, n8n) está em "Pedidos ao usuário".
