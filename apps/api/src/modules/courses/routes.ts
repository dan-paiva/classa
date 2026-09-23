import { and, asc, COURSE_TYPES, course, courseModule, eq, MODALITIES, sql, type Database } from "@classa/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { audit } from "../../http/audit.ts";
import { isUniqueViolation } from "../../http/pg-errors.ts";
import {authorize} from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import { allowsModules, defaultRules } from "./domain.ts";

const PALETTE = ["#1e46c8", "#a14f9c", "#d13543", "#0f766e", "#b45309", "#6d28d9", "#345c66", "#df9f3e"];

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Cor em hexadecimal, como #1e46c8");
const number = () => z.number({ error: "Informe um número" });
const positiveInt = (label: string) =>
  number().int(`${label} precisa ser um número inteiro`).positive(`${label} precisa ser maior que zero`);

const rulesInput = z.object({
  capacity: positiveInt("Alunos por aula").max(500, "No máximo 500 alunos por aula"),
  lessonMinutes: positiveInt("Duração").max(600, "No máximo 600 minutos"),
  packageLessons: positiveInt("Aulas no pacote").max(1000, "No máximo 1000 aulas"),
  cancelNoticeHours: number().int("Use horas inteiras").min(0, "Antecedência não pode ser negativa").max(720, "No máximo 720 horas"),
  lessonPriceCents: number().int("Valor inválido").min(0, "Valor não pode ser negativo").max(100_000_00, "Valor alto demais"),
  modalities: z.array(z.enum(MODALITIES)).min(1, "Escolha ao menos uma modalidade").transform((m) => [...new Set(m)]),
  /** Quem reserva a vaga open-entry: o aluno ou só a secretaria (DOMINIO.md §5.9). */
  autoAgenda: z.boolean(),
});

const name = z.string({ error: "Informe o nome" }).trim().min(2, "Nome precisa de pelo menos 2 caracteres").max(120, "No máximo 120 caracteres");

const createCourseInput = z
  .object({ name, type: z.enum(COURSE_TYPES, { error: "Escolha um tipo de curso" }), color: color.optional() })
  .extend(rulesInput.partial().shape);

const updateCourseInput = z.object({ name, color }).extend(rulesInput.shape).partial();

const moduleInput = z.object({ name, color: color.optional() });
const updateModuleInput = z.object({ name, color, position: z.number().int().min(1) }).partial();

const idParam = z.uuid();

const conflict = (field: string, message: string) => ({ error: "conflict", issues: { [field]: [message] } }) as const;
const notFound = { error: "not_found" } as const;

function particularCapacityError(type: string, capacity: number | undefined) {
  return type === "particular" && capacity !== undefined && capacity !== 1
    ? { error: "validation", issues: { capacity: ["Curso particular tem sempre 1 aluno por aula"] } }
    : null;
}

async function findCourse(db: Database, tenantId: string, id: string) {
  if (!idParam.safeParse(id).success) return null;
  const [row] = await db.select().from(course).where(and(eq(course.id, id), eq(course.tenantId, tenantId)));
  return row ?? null;
}

async function listModules(db: Database, courseId: string) {
  return db.select().from(courseModule).where(eq(courseModule.courseId, courseId)).orderBy(asc(courseModule.position));
}

export const courseRoutes = new Hono<AppEnv>()

  .get("/courses", authorize("cursos", "ver"), async (c) => {
    const { db, tenant } = c.var;
    const courses = await db.select().from(course).where(eq(course.tenantId, tenant.id)).orderBy(asc(course.name));
    const modules = await db
      .select()
      .from(courseModule)
      .where(eq(courseModule.tenantId, tenant.id))
      .orderBy(asc(courseModule.position));
    return c.json({
      courses: courses.map((co) => ({ ...co, modules: modules.filter((m) => m.courseId === co.id) })),
    });
  })

  .get("/courses/:id", authorize("cursos", "ver"), async (c) => {
    const found = await findCourse(c.var.db, c.var.tenant.id, c.req.param("id"));
    if (!found) return c.json(notFound, 404);
    return c.json({ course: { ...found, modules: await listModules(c.var.db, found.id) } });
  })

  .post("/courses", authorize("cursos", "editar"), async (c) => {
    const { data, error } = await parseBody(c, createCourseInput);
    if (error) return error;
    const { db, tenant, user } = c.var;

    const capacityError = particularCapacityError(data.type, data.capacity);
    if (capacityError) return c.json(capacityError, 400);

    const [{ total } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(course)
      .where(eq(course.tenantId, tenant.id));
    const values = {
      ...defaultRules(data.type),
      ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
      color: data.color ?? PALETTE[total % PALETTE.length]!,
      tenantId: tenant.id,
    } as typeof course.$inferInsert;

    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx.insert(course).values(values).returning();
        await audit(tx, { tenantId: tenant.id, actorId: user!.id, entity: "course", entityId: row!.id, action: "create", after: row });
        return row!;
      });
      return c.json({ course: { ...created, modules: [] } }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(conflict("name", "Já existe um curso com esse nome"), 409);
      throw err;
    }
  })

  .patch("/courses/:id", authorize("cursos", "editar"), async (c) => {
    const { db, tenant, user } = c.var;
    const found = await findCourse(db, tenant.id, c.req.param("id"));
    if (!found) return c.json(notFound, 404);
    const { data, error } = await parseBody(c, updateCourseInput);
    if (error) return error;

    const capacityError = particularCapacityError(found.type, data.capacity);
    if (capacityError) return c.json(capacityError, 400);

    try {
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(course).set(data).where(eq(course.id, found.id)).returning();
        await audit(tx, { tenantId: tenant.id, actorId: user!.id, entity: "course", entityId: found.id, action: "update", before: found, after: row });
        return row!;
      });
      return c.json({ course: { ...updated, modules: await listModules(db, found.id) } });
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(conflict("name", "Já existe um curso com esse nome"), 409);
      throw err;
    }
  })

  .post("/courses/:id/:action{deactivate|reactivate}", authorize("cursos", "inativar"), async (c) => {
    const { db, tenant, user } = c.var;
    const found = await findCourse(db, tenant.id, c.req.param("id"));
    if (!found) return c.json(notFound, 404);
    const action = c.req.param("action") as "deactivate" | "reactivate";
    const deactivatedAt = action === "deactivate" ? (found.deactivatedAt ?? new Date()) : null;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(course).set({ deactivatedAt }).where(eq(course.id, found.id)).returning();
      await audit(tx, { tenantId: tenant.id, actorId: user!.id, entity: "course", entityId: found.id, action, before: found, after: row });
      return row!;
    });
    return c.json({ course: { ...updated, modules: await listModules(db, found.id) } });
  })

  .post("/courses/:id/modules", authorize("cursos", "editar"), async (c) => {
    const { db, tenant, user } = c.var;
    const found = await findCourse(db, tenant.id, c.req.param("id"));
    if (!found) return c.json(notFound, 404);
    if (!allowsModules(found.type)) {
      return c.json({ error: "unprocessable", message: "Este tipo de curso não se divide em módulos" }, 422);
    }
    const { data, error } = await parseBody(c, moduleInput);
    if (error) return error;

    const existing = await listModules(db, found.id);
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(courseModule)
          .values({
            tenantId: tenant.id,
            courseId: found.id,
            name: data.name,
            color: data.color ?? found.color,
            position: existing.length + 1,
          })
          .returning();
        await audit(tx, { tenantId: tenant.id, actorId: user!.id, entity: "course_module", entityId: row!.id, action: "create", after: row });
        return row!;
      });
      return c.json({ module: created }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(conflict("name", "Este curso já tem um módulo com esse nome"), 409);
      throw err;
    }
  })

  .patch("/courses/:id/modules/:moduleId", authorize("cursos", "editar"), async (c) => {
    const { db, tenant, user } = c.var;
    const moduleId = c.req.param("moduleId");
    const found = await findCourse(db, tenant.id, c.req.param("id"));
    if (!found || !idParam.safeParse(moduleId).success) return c.json(notFound, 404);
    const [mod] = await db
      .select()
      .from(courseModule)
      .where(and(eq(courseModule.id, moduleId), eq(courseModule.courseId, found.id)));
    if (!mod) return c.json(notFound, 404);
    const { data, error } = await parseBody(c, updateModuleInput);
    if (error) return error;

    try {
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(courseModule).set(data).where(eq(courseModule.id, mod.id)).returning();
        await audit(tx, { tenantId: tenant.id, actorId: user!.id, entity: "course_module", entityId: mod.id, action: "update", before: mod, after: row });
        return row!;
      });
      return c.json({ module: updated });
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(conflict("name", "Este curso já tem um módulo com esse nome"), 409);
      throw err;
    }
  })

  .post("/courses/:id/modules/:moduleId/:action{deactivate|reactivate}", authorize("cursos", "inativar"), async (c) => {
    const { db, tenant, user } = c.var;
    const moduleId = c.req.param("moduleId");
    const found = await findCourse(db, tenant.id, c.req.param("id"));
    if (!found || !idParam.safeParse(moduleId).success) return c.json(notFound, 404);
    const [mod] = await db
      .select()
      .from(courseModule)
      .where(and(eq(courseModule.id, moduleId), eq(courseModule.courseId, found.id)));
    if (!mod) return c.json(notFound, 404);
    const action = c.req.param("action") as "deactivate" | "reactivate";
    const deactivatedAt = action === "deactivate" ? (mod.deactivatedAt ?? new Date()) : null;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(courseModule).set({ deactivatedAt }).where(eq(courseModule.id, mod.id)).returning();
      await audit(tx, { tenantId: tenant.id, actorId: user!.id, entity: "course_module", entityId: mod.id, action, before: mod, after: row });
      return row!;
    });
    return c.json({ module: updated });
  });
