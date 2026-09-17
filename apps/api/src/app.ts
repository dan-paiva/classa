import type { Database, MembershipRole, TenantSettings } from "@classa/db";
import { Hono } from "hono";
import type { Auth } from "./auth.ts";
import { DomainError } from "./http/errors.ts";
import { pgErrorCode } from "./http/pg-errors.ts";
import { companyRoutes } from "./modules/companies/routes.ts";
import { courseRoutes } from "./modules/courses/routes.ts";
import { financeRoutes } from "./modules/finance/routes.ts";
import { payrollRoutes } from "./modules/payroll/routes.ts";
import { peopleRoutes } from "./modules/people/routes.ts";
import { scheduleRoutes } from "./modules/schedule/routes.ts";
import { workflowRoutes } from "./modules/workflows/routes.ts";
import { tenantRoutes } from "./modules/tenants/routes.ts";

export type SessionUser = { id: string; name: string; email: string };

export type TenantContext = {
  id: string;
  name: string;
  slug: string;
  role: MembershipRole;
  timezone: string;
  settings: TenantSettings;
};

export type AppVariables = {
  db: Database;
  auth: Auth;
  user: SessionUser | null;
  /** Preenchido pelo middleware `requireTenant` nas rotas /api/t/:slug/*. */
  tenant: TenantContext;
};

export type AppEnv = { Variables: AppVariables };

/** O que cada requisição precisa. No Worker vem das bindings; nos testes, do PGlite. */
export type Services = { db: Database; auth: Auth; dispose?: () => Promise<void> };

export function createApp(resolve: (env: unknown) => Services) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", async (c, next) => {
    const { db, auth, dispose } = resolve(c.env);
    c.set("db", db);
    c.set("auth", auth);
    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      c.set("user", session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null);
      await next();
    } finally {
      if (dispose) {
        // no Worker, a conexão fecha depois que a resposta sai
        try {
          c.executionCtx.waitUntil(dispose());
        } catch {
          await dispose();
        }
      }
    }
  });

  app.on(["GET", "POST"], "/auth/*", (c) => c.var.auth.handler(c.req.raw));

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: err.code, message: err.message, issues: err.issues }, err.status);
    }
    const pg = pgErrorCode(err);
    if (pg === "23P01") {
      return c.json({ error: "conflict", message: "Choque de horário: professor ou sala já tem aula nesse horário." }, 409);
    }
    console.error(err);
    return c.json({ error: "internal", message: "Erro inesperado. Tente de novo." }, 500);
  });

  const routes = app
    .get("/health", (c) => c.json({ status: "ok", service: "classa-api" }))
    .route("/", tenantRoutes)
    .route("/t/:slug", courseRoutes)
    .route("/t/:slug", peopleRoutes)
    .route("/t/:slug", scheduleRoutes)
    .route("/t/:slug", financeRoutes)
    .route("/t/:slug", payrollRoutes)
    .route("/t/:slug", companyRoutes)
    .route("/t/:slug", workflowRoutes);

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
