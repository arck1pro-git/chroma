# Login e proteção de rotas

Como o CRM decide quem entra, e o que fazer quando algo dá errado.

Até 2026-09-15 não havia login nenhum: quem alcançasse a URL via tudo — funil,
contatos, conversas de WhatsApp, chaves de blog. Este documento descreve o que
substituiu isso.

## As peças

| Arquivo | Papel |
|---|---|
| `proxy.ts` | Porta da rua. Roda antes de toda rota e **fecha por padrão** |
| `lib/auth/sessao.ts` | Assina e lê o cookie de sessão (JWT HS256, 7 dias) |
| `lib/auth/senha.ts` | Hash de senha (scrypt, `node:crypto`) |
| `lib/auth/dal.ts` | `exigirLogin()` / `exigirModulo()` / `exigirLoginApi()` |
| `lib/auth/modulos.ts` | O catálogo do que existe (ver [acessos.md](acessos.md)) |
| `app/login/` | Tela e ações de entrar/sair |
| `migration-auth.sql` | Colunas de credencial em `usuarios` |

## Duas checagens, não uma

O `proxy.ts` faz a checagem **otimista**: lê o cookie, confere a assinatura e
acredita. Não vai ao banco, porque ele roda em toda requisição — inclusive nos
prefetch que o `<Link>` dispara ao aparecer na tela.

A DAL faz a checagem **de verdade**: vai ao banco e confere se a pessoa ainda
existe e ainda está `ativo`. É o que corta o acesso de um usuário desativado
que ainda tem cookie válido na mão.

Por isso `exigirModulo()` fica em **cada `page.tsx`**, e não no layout: com
Partial Rendering o layout não re-renderiza a cada navegação, então uma
checagem lá deixaria de rodar justamente quando a pessoa troca de tela.

A DAL também é quem responde **o que** a pessoa pode ver — módulo a módulo, pelo
departamento dela. Isso está em [acessos.md](acessos.md); aqui fica só o login.

Cobertura hoje: 22 páginas, 21 handlers de API, 84 server actions.

## Quem responde sem sessão

Estão listadas em `proxy.ts`. Cada uma tem outra tranca no lugar:

| Rota | Tranca |
|---|---|
| `/login` | é a tela de entrar |
| `/api/publico/*` | chave do blog na própria URL |
| `/api/webhooks/*` | slug do webhook; é captação de formulário de site |
| `/api/uazapi/webhook` | `UAZAPI_WEBHOOK_SECRET` na querystring |
| `/api/blogs/rss/gerar`, `/api/blogs/rss/pauta`, `/api/midia/fila` | `Authorization: Bearer $CRM_SERVICE_TOKEN` |

Rota nova nasce **protegida**. Para abrir uma, é preciso editar essa lista — e
esse é o ponto.

Dois 401 diferentes, e a diferença ajuda a depurar:
`{"erro":"não autenticado"}` vem do proxy (falta cookie);
`{"erro":"não autorizado"}` vem de `lib/automacoes/servico.ts` (falta o Bearer).

## Operação

**Criar usuário ou trocar senha de alguém** (é o mesmo comando — ele atualiza
quando o email já existe, então serve de "esqueci a senha" enquanto não houver
redefinição na tela). O último argumento é o **slug do departamento**
(`comercial`, `admin`, `ti`, …) e assume `ti` quando omitido. Conta que já existe
mantém o departamento que tinha — trocar a senha de alguém não o reclassifica;
mover é na tela de Acessos:

```bash
# a senha vem de ARQUIVO: argumento de linha de comando fica no histórico do
# shell e na lista de processos da máquina
node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs \
  scripts/criar-usuario.ts <email> "<Nome Completo>" <arquivo-com-a-senha>
```

**Tirar o acesso de alguém sem apagar o histórico dela:**

```sql
UPDATE usuarios SET ativo = false WHERE lower(email) = 'fulano@exemplo.com';
```

O corte vale no próximo carregamento de página, mesmo com o cookie ainda
válido — é a DAL que pega.

**Deslogar todo mundo agora** (suspeita de vazamento): troque `SESSION_SECRET`
no `.env` e reinicie. Não há tabela de sessão para revogar uma a uma; a troca da
chave invalida todas de uma vez.

## O que isto ainda não é

Coisas que faltam, ditas na cara em vez de descobertas depois:

- **Sem redefinição de senha pela tela.** Só o script acima.
- **Sem 2FA.**
- **Freio de força bruta é em memória**, por instância (`app/login/acoes.ts`).
  Com várias instâncias a contagem se divide entre elas. Derruba dicionário
  simples; não é defesa contra ataque distribuído. Freio de verdade é no banco
  ou numa borda (Cloudflare).
- **Sem registro de acesso** além de `usuarios.ultimo_acesso`. Em particular,
  mudança de permissão não deixa rastro: não dá pra saber depois quem tirou o
  módulo de quem, nem quando.

`usuarios.papel` (`admin`/`operador`) **não é mais lido por ninguém** — quem
restringe é o departamento, desde `migration-departamentos.sql`. A coluna
continua na tabela à espera de uma migração de limpeza própria.
