import { and, asc, course, courseMaterial, courseModule, enrollment, eq, isNull, materialDelivery, or, sql } from "@classa/db";
import { audit } from "../http/audit.ts";
import { invalid, notFound, unprocessable } from "../http/errors.ts";
import type { ServiceContext } from "./context.ts";
import { getEnrollmentRow } from "./enrollments.ts";

/**
 * Material do aluno (DOMINIO.md §4.5): um link por curso, e opcionalmente por
 * nível. O Acadêmico cadastra; o CX entrega no pós-venda da entrada (§7.5.1),
 * e o que foi entregue aparece na área do aluno.
 */

export type MaterialInput = { courseId: string; moduleId?: string | null; title: string; url: string; notes?: string | null };

async function validate(ctx: ServiceContext, input: MaterialInput) {
  const title = input.title.trim();
  if (!title) throw invalid("title", "Informe o título");
  const url = input.url.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw invalid("url", "Informe o link completo, começando com http:// ou https://");
  const [c] = await ctx.db.select({ id: course.id }).from(course).where(and(eq(course.id, input.courseId), eq(course.tenantId, ctx.tenantId)));
  if (!c) throw invalid("courseId", "Curso não encontrado");
  if (input.moduleId) {
    const [m] = await ctx.db.select({ id: courseModule.id }).from(courseModule).where(and(eq(courseModule.id, input.moduleId), eq(courseModule.courseId, c.id)));
    if (!m) throw invalid("moduleId", "O nível precisa ser do curso escolhido");
  }
  return { courseId: c.id, moduleId: input.moduleId || null, title, url, notes: input.notes?.trim() || null };
}

export async function listMaterials(ctx: ServiceContext, filters: { courseId?: string } = {}) {
  return ctx.db
    .select({
      id: courseMaterial.id,
      courseId: courseMaterial.courseId,
      moduleId: courseMaterial.moduleId,
      title: courseMaterial.title,
      url: courseMaterial.url,
      notes: courseMaterial.notes,
      deactivatedAt: courseMaterial.deactivatedAt,
      courseName: course.name,
      moduleName: courseModule.name,
    })
    .from(courseMaterial)
    .innerJoin(course, eq(course.id, courseMaterial.courseId))
    .leftJoin(courseModule, eq(courseModule.id, courseMaterial.moduleId))
    .where(and(eq(courseMaterial.tenantId, ctx.tenantId), filters.courseId ? eq(courseMaterial.courseId, filters.courseId) : undefined))
    .orderBy(asc(course.name), sql`${courseModule.position} nulls first`, asc(courseMaterial.title));
}

async function getRow(ctx: ServiceContext, id: string) {
  const [row] = await ctx.db.select().from(courseMaterial).where(and(eq(courseMaterial.id, id), eq(courseMaterial.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Material");
  return row;
}

export async function createMaterial(ctx: ServiceContext, input: MaterialInput) {
  const values = await validate(ctx, input);
  const [row] = await ctx.db
    .insert(courseMaterial)
    .values({ tenantId: ctx.tenantId, ...values })
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "course_material", entityId: row!.id, action: "create", after: row });
  return row!;
}

export async function updateMaterial(ctx: ServiceContext, id: string, input: MaterialInput) {
  const before = await getRow(ctx, id);
  const values = await validate(ctx, input);
  const [row] = await ctx.db.update(courseMaterial).set(values).where(eq(courseMaterial.id, id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "course_material", entityId: id, action: "update", before, after: row });
  return row!;
}

/** Inativar tira o material das próximas entregas; quem já recebeu continua vendo. */
export async function setMaterialActive(ctx: ServiceContext, id: string, active: boolean) {
  const before = await getRow(ctx, id);
  const [row] = await ctx.db
    .update(courseMaterial)
    .set({ deactivatedAt: active ? null : ctx.now })
    .where(eq(courseMaterial.id, id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "course_material", entityId: id, action: active ? "reactivate" : "deactivate", before, after: row });
  return row!;
}

/**
 * Entrega à matrícula o material ativo do curso: o do curso todo e o do nível
 * dela. Entregar de novo não duplica. Sem material cadastrado, recusa: o CX
 * precisa ter o que mandar.
 */
export async function deliverMaterials(ctx: ServiceContext, enrollmentId: string) {
  const e = await getEnrollmentRow(ctx.db, ctx, enrollmentId);
  if (e.levelPending) throw unprocessable("A matrícula ainda aguarda o nivelamento: sem nível, não há material para mandar.");
  const materials = await ctx.db
    .select({ id: courseMaterial.id, title: courseMaterial.title })
    .from(courseMaterial)
    .where(
      and(
        eq(courseMaterial.tenantId, ctx.tenantId),
        eq(courseMaterial.courseId, e.courseId),
        isNull(courseMaterial.deactivatedAt),
        e.moduleId ? or(isNull(courseMaterial.moduleId), eq(courseMaterial.moduleId, e.moduleId)) : isNull(courseMaterial.moduleId),
      ),
    );
  if (materials.length === 0) throw unprocessable("Não há material cadastrado para o curso e o nível deste aluno. O Acadêmico cadastra em Materiais.");
  await ctx.db
    .insert(materialDelivery)
    .values(materials.map((m) => ({ tenantId: ctx.tenantId, enrollmentId: e.id, materialId: m.id, deliveredAt: ctx.now, deliveredBy: ctx.actorId })))
    .onConflictDoNothing();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "enrollment", entityId: e.id, action: "update", after: { materiaisEntregues: materials.map((m) => m.title) } });
  return materials;
}

/** Material que o aluno recebeu, em todas as matrículas dele. */
export async function studentMaterials(ctx: ServiceContext, studentId: string) {
  return ctx.db
    .select({
      id: courseMaterial.id,
      title: courseMaterial.title,
      url: courseMaterial.url,
      notes: courseMaterial.notes,
      courseName: course.name,
      moduleName: courseModule.name,
      deliveredAt: materialDelivery.deliveredAt,
    })
    .from(materialDelivery)
    .innerJoin(enrollment, eq(enrollment.id, materialDelivery.enrollmentId))
    .innerJoin(courseMaterial, eq(courseMaterial.id, materialDelivery.materialId))
    .innerJoin(course, eq(course.id, courseMaterial.courseId))
    .leftJoin(courseModule, eq(courseModule.id, courseMaterial.moduleId))
    .where(and(eq(materialDelivery.tenantId, ctx.tenantId), eq(enrollment.studentId, studentId), isNull(enrollment.endedAt)))
    .orderBy(asc(course.name), asc(courseMaterial.title));
}
