import { MODALITIES } from "@classa/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { invalid } from "../../http/errors.ts";
import { isoDate, uuid } from "../../http/query.ts";
import { requireAdmin, requireTenant } from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import { contextFrom } from "../../services/context.ts";
import { listEnrollments } from "../../services/enrollments.ts";
import {
  cancelLesson,
  cancelStudentLesson,
  changeLessonTeacher,
  concludeLesson,
  lessonRoster,
  markUnfinishedLessons,
  setAttendance,
  startLesson,
} from "../../services/lessons.ts";
import {
  addRecess,
  createClassGroup,
  generateLessons,
  importNationalHolidays,
  listClassGroups,
  listHolidays,
  listLessons,
} from "../../services/schedule.ts";

const schedules = z.array(z.object({ weekday: z.number().int(), startTime: z.string() }), { error: "Informe os horários" });

function parseRange(from?: string, to?: string) {
  const f = from ? new Date(from) : new Date(Date.now() - 86400_000);
  const t = to ? new Date(to) : new Date(f.getTime() + 7 * 86400_000);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw invalid("from", "Período inválido");
  if (t.getTime() - f.getTime() > 62 * 86400_000) throw invalid("to", "Período de no máximo 62 dias");
  return { from: f, to: t };
}

export const scheduleRoutes = new Hono<AppEnv>()
  .use("*", requireTenant)

  /* --------------------------------------------------------------------- turmas */
  .get("/class-groups", async (c) =>
    c.json({ classGroups: await listClassGroups(contextFrom(c), { courseId: c.req.query("courseId"), teacherId: c.req.query("teacherId") }) }),
  )

  .get("/class-groups/:id", async (c) => {
    const ctx = contextFrom(c);
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) throw invalid("id", "Turma não encontrada");
    const [classGroup] = await listClassGroups(ctx, { id: id.data });
    if (!classGroup) return c.json({ error: "not_found", message: "Turma não encontrada." }, 404);
    const enrollments = await listEnrollments(ctx, { classGroupId: id.data });
    const lessons = await listLessons(ctx, { from: new Date(Date.now() - 21 * 86400_000), to: new Date(Date.now() + 28 * 86400_000), classGroupId: id.data });
    return c.json({ classGroup, enrollments, lessons });
  })

  .post("/class-groups", requireAdmin, async (c) => {
    const { data, error } = await parseBody(
      c,
      z.object({
        courseId: uuid,
        moduleId: uuid.nullish(),
        name: z.string({ error: "Informe o nome" }),
        teacherId: uuid.nullish(),
        roomId: uuid.nullish(),
        modality: z.enum(MODALITIES).optional(),
        capacity: z.number().int().optional(),
        startsOn: isoDate,
        endsOn: isoDate,
        schedules,
        generateWeeks: z.number().int().min(0).max(26).optional(),
      }),
    );
    if (error) return error;
    const ctx = contextFrom(c);
    const { generateWeeks = 8, ...input } = data;
    const result = await createClassGroup(ctx, input);
    const today = new Date().toISOString().slice(0, 10);
    const generation = generateWeeks
      ? await generateLessons(ctx, result.classGroup.id, {
          from: input.startsOn > today ? input.startsOn : today,
          to: new Date(Date.now() + generateWeeks * 7 * 86400_000).toISOString().slice(0, 10),
        })
      : null;
    return c.json({ ...result, generation }, 201);
  })

  .post("/class-groups/:id/generate", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ from: isoDate, to: isoDate }));
    if (error) return error;
    return c.json({ generation: await generateLessons(contextFrom(c), c.req.param("id"), data) });
  })

  /* ---------------------------------------------------------------------- aulas */
  .get("/lessons", async (c) => {
    const ctx = contextFrom(c);
    await markUnfinishedLessons(ctx);
    const range = parseRange(c.req.query("from"), c.req.query("to"));
    return c.json({
      lessons: await listLessons(ctx, {
        ...range,
        teacherId: c.req.query("teacherId") || undefined,
        courseId: c.req.query("courseId") || undefined,
        classGroupId: c.req.query("classGroupId") || undefined,
        studentId: c.req.query("studentId") || undefined,
      }),
    });
  })

  .get("/lessons/:id", async (c) => {
    const ctx = contextFrom(c);
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) throw invalid("id", "Aula não encontrada");
    const [lesson] = await listLessons(ctx, { from: new Date(0), to: new Date(0), id: id.data });
    if (!lesson) return c.json({ error: "not_found", message: "Aula não encontrada." }, 404);
    return c.json({ lesson, roster: await lessonRoster(ctx, id.data) });
  })

  .post("/lessons/:id/attendance", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ entries: z.array(z.object({ enrollmentId: uuid, status: z.enum(["presente", "falta"]) })) }));
    if (error) return error;
    await setAttendance(contextFrom(c), c.req.param("id"), data.entries);
    return c.json({ ok: true });
  })

  .post("/lessons/:id/start", requireAdmin, async (c) => c.json({ lesson: await startLesson(contextFrom(c), c.req.param("id")) }))
  .post("/lessons/:id/conclude", requireAdmin, async (c) => c.json({ lesson: await concludeLesson(contextFrom(c), c.req.param("id")) }))

  .post("/lessons/:id/cancel", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ reason: z.string().default(""), undo: z.boolean().default(false) }));
    if (error) return error;
    return c.json({ lesson: await cancelLesson(contextFrom(c), c.req.param("id"), data.reason, data.undo) });
  })

  .post("/lessons/:id/teacher", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ teacherId: uuid }));
    if (error) return error;
    return c.json({ lesson: await changeLessonTeacher(contextFrom(c), c.req.param("id"), data.teacherId) });
  })

  .post("/lessons/:id/students/:enrollmentId/cancel", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ undo: z.boolean().default(false) }));
    if (error) return error;
    return c.json({ entry: await cancelStudentLesson(contextFrom(c), c.req.param("id"), c.req.param("enrollmentId"), data.undo) });
  })

  /* ------------------------------------------------------------------- feriados */
  .get("/holidays", async (c) => {
    const year = Number(c.req.query("year") ?? new Date().getFullYear());
    return c.json({ holidays: await listHolidays(contextFrom(c), `${year}-01-01`, `${year}-12-31`) });
  })

  .post("/holidays/import", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ year: z.number().int().min(2000).max(2100) }));
    if (error) return error;
    return c.json({ holidays: await importNationalHolidays(contextFrom(c), data.year) });
  })

  .post("/holidays/recess", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ from: isoDate, to: isoDate, name: z.string().min(2) }));
    if (error) return error;
    return c.json({ holidays: await addRecess(contextFrom(c), data) }, 201);
  });
