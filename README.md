# Classa

Sistema de gestão escolar open source: alunos, matrículas, turmas, agenda de aulas, professores, financeiro, folha de pagamento e perfis de acesso.

> Projeto em construção. Todos os dados de exemplo são fictícios.

## Status

Fase 0 (fundação) em andamento. O plano completo está em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Rodando localmente

Requisitos: Node 24 e Docker.

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev:up        # Postgres 17 + Mailpit
pnpm db:migrate    # aplica as migrations
pnpm build         # gera o frontend servido pelo Worker
pnpm --filter @classa/api dev   # http://localhost:8787
```

Para desenvolver o frontend com recarga automática, rode também `pnpm --filter @classa/web dev` (http://localhost:5173).

Testes: `pnpm test`. Os testes de banco usam PGlite (Postgres em memória) e não precisam de Docker.

## Stack

React + Vite · Hono em Cloudflare Workers · PostgreSQL (Neon) · Drizzle ORM · Better Auth · Cloudflare R2

## Licença

[MIT](LICENSE)
