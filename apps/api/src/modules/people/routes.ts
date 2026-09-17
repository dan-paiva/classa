import { and, company, eq, lessonStudent, person, ROOM_KINDS, sql, student, STUDENT_STATUSES } from "@classa/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { invalid } from "../../http/errors.ts";
import { isoDate, uuid } from "../../http/query.ts";
import {authorize, requireAdmin} from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import { contextFrom } from "../../services/context.ts";
import { listEnrollments } from "../../services/enrollments.ts";
import { listInstallments } from "../../services/finance.ts";
import {
  createRoom,
  createStudent,
  createTeacher,
  getStudentRow,
  getTeacherRow,
  listRooms,
  listTeachers,
  setStudentStatus,
  setTeacherActive,
  updatePerson,
  updateStudentAvailability,
  updateTeacher,
} from "../../services/people.ts";
import { listClassGroups, listLessons } from "../../services/schedule.ts";

const personInput = z.object({
  name: z.string({ error: "Informe o nome" }),
  email: z.string().nullish(),
  cpf: z.string().nullish(),
  phone: z.string().nullish(),
  birthDate: isoDate.nullish(),
});
const availability = z.array(z.number().int());
const teacherCourses = z.array(z.object({ courseId: uuid, moduleIds: z.array(uuid).nullable() }));

const days = (n: number) => new Date(Date.now() + n * 86400_000);

export const peopleRoutes = new Hono<AppEnv>()

  /* ---------------------------------------------------------------- professores */
  .get("/teachers", authorize("professores", "ver"), async (c) => c.json({ teachers: await listTeachers(contextFrom(c)) }))

  .get("/teachers/:id", authorize("professores", "ver"), async (c) => {
    const ctx = contextFrom(c);
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) throw invalid("id", "Professor não encontrado");
    await getTeacherRow(ctx.db, ctx, id.data);
    const teacher = (await listTeachers(ctx)).find((t) => t.id === id.data)!;
    const classGroups = await listClassGroups(ctx, { teacherId: id.data });
    const lessons = await listLessons(ctx, { from: days(-14), to: days(21), teacherId: id.data });
    return c.json({ teacher, classGroups, lessons });
  })

  .post("/teachers", authorize("professores", "editar"), async (c) => {
    const { data, error } = await parseBody(
      c,
      z.object({
        personId: uuid.optional(),
        person: personInput.optional(),
        weeklyLimit: z.number().int().optional(),
        hourlyRateCents: z.number().int().min(0).nullish(),
        availability: availability.optional(),
        courses: teacherCourses.optional(),
      }),
    );
    if (error) return error;
    return c.json({ teacher: await createTeacher(contextFrom(c), data) }, 201);
  })

  .patch("/teachers/:id", authorize("professores", "editar"), async (c) => {
    const { data, error } = await parseBody(
      c,
      z.object({
        person: personInput.optional(),
        weeklyLimit: z.number().int().min(1, "Teto semanal precisa ser maior que zero").optional(),
        hourlyRateCents: z.number().int().min(0).nullish(),
        availability: availability.optional(),
        courses: teacherCourses.optional(),
      }),
    );
    if (error) return error;
    const ctx = contextFrom(c);
    const t = await getTeacherRow(ctx.db, ctx, c.req.param("id"));
    if (data.person) await updatePerson(ctx, t.personId, data.person);
    const { person: _p, ...rest } = data;
    return c.json({ teacher: await updateTeacher(ctx, t.id, rest) });
  })

  .post("/teachers/:id/:action{deactivate|reactivate}", authorize("professores", "inativar"), async (c) =>
    c.json({ teacher: await setTeacherActive(contextFrom(c), c.req.param("id"), c.req.param("action") === "reactivate") }),
  )

  /* --------------------------------------------------------------------- alunos */
  .get("/students", authorize("alunos", "ver"), async (c) => {
    const ctx = contextFrom(c);
    const q = c.req.query("q")?.trim();
    const status = c.req.query("status");
    const rows = await ctx.db
      .select({
        student,
        person,
        companyName: sql<string | null>`(select c.name from company c where c.id = ${student.companyId})`,
        activeEnrollments: sql<number>`(select count(*)::int from enrollment e where e.student_id = ${student.id} and e.ended_at is null)`,
        balance: sql<number>`(select coalesce(sum(ce.amount), 0)::int from credit_entry ce join enrollment e on e.id = ce.enrollment_id where e.student_id = ${student.id} and e.ended_at is null)`,
        overdue: sql<number>`(select count(*)::int from installment i join contract k on k.id = i.contract_id join enrollment e on e.id = k.enrollment_id
          where e.student_id = ${student.id} and i.cancelled_at is null and i.due_date < (now() at time zone ${ctx.timezone})::date
          and i.amount_cents > coalesce((select sum(p.amount_cents) from payment p where p.installment_id = i.id), 0))`,
      })
      .from(student)
      .innerJoin(person, eq(person.id, student.personId))
      .where(
        and(
          eq(student.tenantId, ctx.tenantId),
          status && (STUDENT_STATUSES as readonly string[]).includes(status) ? eq(student.status, status as (typeof STUDENT_STATUSES)[number]) : undefined,
          q ? sql`(${person.name} ilike ${`%${q}%`} or ${person.email} ilike ${`%${q}%`} or ${person.cpf} like ${`%${q.replace(/\D/g, "") || "-"}%`})` : undefined,
        ),
      )
      .orderBy(person.name);
    return c.json({
      students: rows.map((r) => ({ ...r.student, person: r.person, companyName: r.companyName, activeEnrollments: r.activeEnrollments, balance: r.balance, overdueInstallments: r.overdue })),
    });
  })

  .get("/students/:id", authorize("alunos", "ver"), async (c) => {
    const ctx = contextFrom(c);
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) throw invalid("id", "Aluno não encontrado");
    const s = await getStudentRow(ctx.db, ctx, id.data);
    const [p] = await ctx.db.select().from(person).where(eq(person.id, s.personId));
    const [co] = s.companyId ? await ctx.db.select({ id: company.id, name: company.name, model: company.model }).from(company).where(eq(company.id, s.companyId)) : [];
    const enrollments = await listEnrollments(ctx, { studentId: s.id });
    const installments = await listInstallments(ctx, { studentId: s.id });
    const lessons = await listLessons(ctx, { from: days(-30), to: days(21), studentId: s.id });
    const attendance = await ctx.db
      .select({ lessonId: lessonStudent.lessonId, status: lessonStudent.status, cancelledInTime: lessonStudent.cancelledInTime })
      .from(lessonStudent)
      .where(eq(lessonStudent.studentId, s.id));
    const byLesson = new Map(attendance.map((a) => [a.lessonId, a]));
    return c.json({
      student: { ...s, person: p, company: co ?? null },
      enrollments,
      installments,
      lessons: lessons.map((l) => ({ ...l, myStatus: byLesson.get(l.id)?.status ?? null, cancelledInTime: byLesson.get(l.id)?.cancelledInTime ?? null })),
    });
  })

  .post("/students", authorize("alunos", "editar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ personId: uuid.optional(), person: personInput.optional(), availability: availability.optional() }));
    if (error) return error;
    return c.json({ student: await createStudent(contextFrom(c), data) }, 201);
  })

  .patch("/students/:id", authorize("alunos", "editar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ person: personInput.optional(), availability: availability.optional() }));
    if (error) return error;
    const ctx = contextFrom(c);
    const s = await getStudentRow(ctx.db, ctx, c.req.param("id"));
    if (data.person) await updatePerson(ctx, s.personId, data.person);
    if (data.availability) await updateStudentAvailability(ctx, s.id, data.availability);
    return c.json({ student: await getStudentRow(ctx.db, ctx, s.id) });
  })

  .post("/students/:id/status", authorize("alunos", "inativar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ status: z.enum([...STUDENT_STATUSES, "reativar"]) }));
    if (error) return error;
    return c.json({ student: await setStudentStatus(contextFrom(c), c.req.param("id"), data.status) });
  })

  /* ---------------------------------------------------------------------- salas */
  .get("/rooms", authorize("turmas", "ver"), async (c) => c.json({ rooms: await listRooms(contextFrom(c)) }))

  .post("/rooms", requireAdmin, async (c) => {
    const { data, error } = await parseBody(
      c,
      z.object({ name: z.string({ error: "Informe o nome" }), kind: z.enum(ROOM_KINDS, { error: "Escolha o tipo de sala" }), link: z.string().nullish(), capacity: z.number().int().positive().nullish() }),
    );
    if (error) return error;
    return c.json({ room: await createRoom(contextFrom(c), data) }, 201);
  });
