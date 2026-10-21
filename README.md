# AmaanOffice

CRM interno da AMAAN e da Arck1Pro: funis e oportunidades, contatos, chat de WhatsApp com IA de atendimento,
cadências executadas no n8n, campanhas e anúncios da Meta, blog, demandas da equipe e agenda.

Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 e Postgres no Neon via `postgres.js`.

## Rodar

```bash
npm install
cp .env.example .env    # preencha: o .env aponta para o banco DEV
npm run dev             # http://localhost:3000
```

## Verificar

```bash
npx tsc --noEmit -p .
npm run lint
npm run build
```

Não há suíte de testes: a lógica de servidor se confere com scripts em `scripts/`, rodados por
`node --env-file=.env scripts/jiti.mjs scripts/<arquivo>.ts`.

## Onde ler antes de mexer

- [CLAUDE.md](CLAUDE.md): estrutura, fluxo, convenções, comandos e o que exige autorização. Vale para gente e para
  agentes de IA.
- [docs/organizacao-do-codigo.md](docs/organizacao-do-codigo.md): diagnóstico da estrutura e a direção de organização.
- [docs/](docs/): decisões por assunto (acesso, automações, n8n, campanhas).
