import type { Database } from "@classa/db";
import { Hono } from "hono";
import type { Auth } from "./auth.ts";
import { tenantRoutes } from "./modules/tenants/routes.ts";

export type SessionUser = { id: string; name: string; email: string };

export type AppVariables = {
  db: Database;
  auth: Auth;
  user: SessionUser | null;
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

  const routes = app
    .get("/health", (c) => c.json({ status: "ok", service: "classa-api" }))
    .route("/", tenantRoutes);

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
