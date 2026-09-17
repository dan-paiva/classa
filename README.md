# Classa

Sistema de gestão escolar open source: alunos, matrículas, turmas, agenda de aulas, professores, financeiro, folha de pagamento e perfis de acesso.

> Projeto em construção. Todos os dados de exemplo são fictícios.

## Status

Fase 0 (fundação): login com e-mail e senha e criação da escola funcionando. O plano completo está em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Rodando localmente

Requisitos: Node 24 e Docker.

```bash
corepack enable
pnpm install
cp .env.example .env
cp apps/api/.dev.vars.example apps/api/.dev.vars   # troque o BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm dev:up        # Postgres 17 + Mailpit
pnpm db:migrate    # aplica as migrations
pnpm dev           # API em :8787 e frontend em http://localhost:5173
```

Abra http://localhost:5173, crie uma conta e depois a sua escola.

Testes: `pnpm test`. Os testes usam PGlite (Postgres em memória) com as migrations reais e não precisam de Docker.

## Stack

React + Vite · Hono em Cloudflare Workers · PostgreSQL (Neon) · Drizzle ORM · Better Auth · Cloudflare R2

## Licença

[MIT](LICENSE)
