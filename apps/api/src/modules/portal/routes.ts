import { and, eq, lessonStudent, person, student } from "@classa/db";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { DomainError } from "../../http/errors.ts";
import {} from "../../http/require-tenant.ts";
import { contextFrom } from "../../services/context.ts";
import { listEnrollments } from "../../services/enrollments.ts";
import { listInstallments } from "../../services/finance.ts";
import { cancelStudentLesson } from "../../services/lessons.ts";
import { listLessons } from "../../services/schedule.ts";
import { primaryEmailSql } from "../../services/people.ts";

/**
 * A área do aluno é do vínculo de aluno, não da pessoa: quem entrou pelo acesso
 * de trabalho não chega aqui, mesmo sendo aluno da escola pelo outro acesso.
 * Sem isso, o colaborador-aluno entraria pelos dois lados (DOMINIO.md §3.4).
 */
function ownStudentId(c: { var: AppEnv["Variables"] }) {
  const t = c.var.tenant;
  if (t.profileType !== "aluno") return null;
  return t.studentId;
}

/** Área do aluno: só os próprios dados, a própria agenda e o próprio financeiro. */
export const portalRoutes = new Hono<AppEnv>()
  .get("/minha-area", async (c) => {
    const ctx = contextFrom(c);
    const studentId = ownStudentId(c);
    if (!studentId) throw new DomainError(404, "not_found", "Seu usuário não está ligado a um aluno desta escola.");
    const [s] = await ctx.db
      .select({ id: student.id, status: student.status, name: person.name, email: primaryEmailSql })
      .from(student)
      .innerJoin(person, eq(person.id, student.personId))
      .where(eq(student.id, studentId));
    const enrollments = await listEnrollments(ctx, { studentId });
    const installments = await listInstallments(ctx, { studentId });
    const lessons = await listLessons(ctx, { from: new Date(Date.now() - 60 * 86400_000), to: new Date(Date.now() + 28 * 86400_000), studentId });
    const mine = await ctx.db
      .select({ lessonId: lessonStudent.lessonId, enrollmentId: lessonStudent.enrollmentId, status: lessonStudent.status, cancelledInTime: lessonStudent.cancelledInTime })
      .from(lessonStudent)
      .where(eq(lessonStudent.studentId, studentId));
    const byLesson = new Map(mine.map((m) => [m.lessonId, m]));
    return c.json({
      student: s,
      enrollments: enrollments.map(({ studentStatus: _s, ...e }) => e),
      installments,
      lessons: lessons.map((l) => ({
        id: l.id,
        startsAt: l.startsAt,
        endsAt: l.endsAt,
        state: l.state,
        className: l.className,
        courseName: l.courseName,
        courseColor: l.courseColor,
        teacherName: l.teacherName,
        roomName: l.roomName,
        roomLink: l.roomLink,
        enrollmentId: byLesson.get(l.id)?.enrollmentId,
        myStatus: byLesson.get(l.id)?.status,
        cancelledInTime: byLesson.get(l.id)?.cancelledInTime,
      })),
    });
  })
  .post("/minha-area/aulas/:lessonId/:action{cancelar|reagendar}", async (c) => {
    const ctx = contextFrom(c);
    const studentId = ownStudentId(c);
    if (!studentId) throw new DomainError(404, "not_found", "Seu usuário não está ligado a um aluno desta escola.");
    const [own] = await ctx.db
      .select({ enrollmentId: lessonStudent.enrollmentId })
      .from(lessonStudent)
      .where(and(eq(lessonStudent.lessonId, c.req.param("lessonId")), eq(lessonStudent.studentId, studentId)));
    if (!own) throw new DomainError(404, "not_found", "Aula não encontrada.");
    return c.json({ entry: await cancelStudentLesson(ctx, c.req.param("lessonId"), own.enrollmentId, c.req.param("action") === "reagendar") });
  });
