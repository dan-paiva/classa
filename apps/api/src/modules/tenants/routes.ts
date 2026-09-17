import { and, auditLog, eq, isNull, membership, tenant } from "@classa/db";
import { permissionMap } from "@classa/domain";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { requireUser } from "../../http/require-user.ts";
import { isUniqueViolation } from "../../http/pg-errors.ts";

const createTenantInput = z.object({
  name: z.string().trim().min(3, "Nome precisa de pelo menos 3 caracteres").max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífen")
    .min(3)
    .max(40),
});

export const tenantRoutes = new Hono<AppEnv>()
  .get("/me", requireUser, async (c) => {
    const user = c.var.user!;
    const escolas = await c.var.db
      .select({
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        role: membership.role,
        profileType: membership.profileType,
        level: membership.level,
        areas: membership.areas,
        status: membership.status,
      })
      .from(membership)
      .innerJoin(tenant, eq(tenant.id, membership.tenantId))
      .where(and(eq(membership.userId, user.id), isNull(membership.deactivatedAt), isNull(tenant.deactivatedAt)))
      .orderBy(tenant.name);
    return c.json({
      user,
      memberships: escolas.map((m) => ({ ...m, permissions: permissionMap({ profileType: m.profileType, level: m.level, areas: m.areas }) })),
    });
  })
  .post("/tenants", requireUser, async (c) => {
    const parsed = createTenantInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "validation", issues: z.flattenError(parsed.error).fieldErrors }, 400);
    }
    const user = c.var.user!;
    try {
      const created = await c.var.db.transaction(async (tx) => {
        const [escola] = await tx.insert(tenant).values(parsed.data).returning();
        await tx.insert(membership).values({ tenantId: escola!.id, userId: user.id, role: "admin" });
        await tx.insert(auditLog).values({
          tenantId: escola!.id,
          actorId: user.id,
          entity: "tenant",
          entityId: escola!.id,
          action: "create",
          after: parsed.data,
        });
        return escola!;
      });
      return c.json({ tenant: { id: created.id, name: created.name, slug: created.slug } }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json({ error: "conflict", issues: { slug: ["Esse link já está em uso por outra escola"] } }, 409);
      }
      throw err;
    }
  });
