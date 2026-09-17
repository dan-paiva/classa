import { and, auditLog, authUser, desc, eq, gte, lt, sql } from "@classa/db";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { requireAdmin } from "../../http/require-tenant.ts";
import { contextFrom } from "../../services/context.ts";

const PAGE = 50;

/** Campos que mudaram entre antes e depois (sem datas técnicas). */
function changedFields(before: unknown, after: unknown): string[] {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return [];
  const skip = new Set(["updatedAt", "createdAt", "stageChangedAt"]);
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  return Object.keys(b).filter((k) => !skip.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export const auditRoutes = new Hono<AppEnv>().get("/audit", requireAdmin, async (c) => {
  const ctx = contextFrom(c);
  const entity = c.req.query("entity") || undefined;
  const actorId = c.req.query("actorId") || undefined;
  const from = c.req.query("from");
  const to = c.req.query("to");
  const page = Math.max(0, Number(c.req.query("page") ?? 0) || 0);
  const where = and(
    eq(auditLog.tenantId, ctx.tenantId),
    entity ? (entity.endsWith("*") ? sql`${auditLog.entity} like ${entity.slice(0, -1) + "%"}` : eq(auditLog.entity, entity)) : undefined,
    actorId ? eq(auditLog.actorId, actorId) : undefined,
    from ? gte(auditLog.createdAt, new Date(from)) : undefined,
    to ? lt(auditLog.createdAt, new Date(to)) : undefined,
  );
  const rows = await ctx.db
    .select({ entry: auditLog, actorName: authUser.name, actorEmail: authUser.email })
    .from(auditLog)
    .leftJoin(authUser, eq(authUser.id, auditLog.actorId))
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(PAGE + 1)
    .offset(page * PAGE);
  const entities = await ctx.db
    .select({ entity: auditLog.entity, n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(eq(auditLog.tenantId, ctx.tenantId))
    .groupBy(auditLog.entity)
    .orderBy(auditLog.entity);
  return c.json({
    entries: rows.slice(0, PAGE).map(({ entry, actorName, actorEmail }) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      actorName: actorName ?? (entry.actorId ? "usuário removido" : "sistema"),
      actorEmail,
      justification: entry.justification,
      changed: changedFields(entry.before, entry.after),
      before: entry.before,
      after: entry.after,
    })),
    hasMore: rows.length > PAGE,
    entities,
  });
});
