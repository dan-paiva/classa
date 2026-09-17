import { and, eq, isNull, membership, student, teacher, tenant } from "@classa/db";
import { can, type Action, type Resource } from "@classa/domain";
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
      membershipId: membership.id,
      profileType: membership.profileType,
      level: membership.level,
      areas: membership.areas,
      personId: membership.personId,
      status: membership.status,
    })
    .from(tenant)
    .innerJoin(membership, eq(membership.tenantId, tenant.id))
    .where(and(eq(tenant.slug, slug), eq(membership.userId, user.id), isNull(tenant.deactivatedAt), isNull(membership.deactivatedAt)))
    .limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status === "bloqueado") return c.json({ error: "forbidden", message: "Seu acesso a esta escola está bloqueado." }, 403);

  // escopo: professor vê as próprias aulas; aluno, os próprios dados
  let teacherId: string | null = null;
  let studentId: string | null = null;
  if (row.personId) {
    const [t] = await c.var.db.select({ id: teacher.id }).from(teacher).where(and(eq(teacher.personId, row.personId), eq(teacher.tenantId, row.id)));
    const [s] = await c.var.db.select({ id: student.id }).from(student).where(and(eq(student.personId, row.personId), eq(student.tenantId, row.id)));
    teacherId = t?.id ?? null;
    studentId = s?.id ?? null;
  }

  const { status: _status, ...ctx } = row;
  c.set("tenant", { ...ctx, teacherId, studentId });
  await next();
});

/** Só o tipo de perfil Admin (criar escola, usuários e configurações). */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.tenant.profileType !== "admin") return c.json({ error: "forbidden", message: "Só administradores podem fazer isso." }, 403);
  await next();
});

export function hasPermission(c: { var: AppEnv["Variables"] }, resource: Resource, action: Action) {
  const t = c.var.tenant;
  return can({ profileType: t.profileType, level: t.level, areas: t.areas }, resource, action);
}

/** Exige a permissão (recurso × ação) do perfil do usuário nesta escola. */
export const authorize = (resource: Resource, action: Action) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!hasPermission(c, resource, action)) {
      return c.json({ error: "forbidden", message: "Seu perfil não permite esta ação." }, 403);
    }
    await next();
  });

/** Professor (prestador) só age nas próprias aulas. */
export function isOwnLessonOnly(c: { var: AppEnv["Variables"] }) {
  return c.var.tenant.profileType === "prestador";
}
