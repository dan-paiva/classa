import { and, eq, isNull, membership, tenant } from "@classa/db";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.ts";

/**
 * Resolve a escola pelo :slug e confirma que o usuário tem vínculo ativo com ela.
 * Quem não tem vínculo recebe 404, para não revelar que a escola existe.
 */
export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const slug = c.req.param("slug");
  if (!slug) return c.json({ error: "not_found" }, 404);

  const [row] = await c.var.db
    .select({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      role: membership.role,
      timezone: tenant.timezone,
      settings: tenant.settings,
    })
    .from(tenant)
    .innerJoin(membership, eq(membership.tenantId, tenant.id))
    .where(
      and(
        eq(tenant.slug, slug),
        eq(membership.userId, user.id),
        isNull(tenant.deactivatedAt),
        isNull(membership.deactivatedAt),
      ),
    )
    .limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);

  c.set("tenant", row);
  await next();
});

/** Por enquanto toda escrita exige admin; a matriz de perfis substitui isto depois. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.tenant.role !== "admin") return c.json({ error: "forbidden" }, 403);
  await next();
});
