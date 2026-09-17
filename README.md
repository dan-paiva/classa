# Classa

Sistema de gestão escolar open source: alunos, matrículas, turmas, agenda de aulas, professores, financeiro, folha de pagamento e perfis de acesso.

> Projeto em construção. Todos os dados de exemplo são fictícios.

## Status

Funciona hoje: login, escolas, cursos e módulos, professores (habilitação e disponibilidade), alunos, salas, feriados, turmas com geração de aulas, agenda semanal, presença e conclusão de aula, matrículas com extrato de créditos, contratos, parcelas, pagamentos, estorno e inadimplência automática.

Também: folha de professores e fechamento do mês, empresas B2B/B2B2C com cobrança, leads, fluxos em kanban (substituição, nível, reposição, admissão, cobrança, renovação, retenção, campanhas), perfis de acesso por nível e área, convites e áreas do professor e do aluno, auditoria de todas as alterações, painel de alertas e relatórios (financeiro, frequência, professores e matrículas) com exportação para planilha.

Próximo: o importador do protótipo (uso local).

Regras de negócio em [docs/DOMINIO.md](docs/DOMINIO.md); arquitetura em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

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

Para uma escola de demonstração com dados inventados (professores, turmas, alunos, aulas, presença e financeiro):

```bash
pnpm db:seed            # entra com admin@demo.classa.dev / classa-demo-123
# outros perfis (mesma senha): coordenacao@, financeiro@, professor@ e aluno@demo.classa.dev
pnpm db:seed -- --reset --member voce@exemplo.com   # recria e dá acesso também à sua conta local
```

Testes: `pnpm test`. Os testes usam PGlite (Postgres em memória) com as migrations reais e não precisam de Docker.

## Stack

React + Vite · Hono em Cloudflare Workers · PostgreSQL (Neon) · Drizzle ORM · Better Auth · Cloudflare R2

## Licença

[MIT](LICENSE)
