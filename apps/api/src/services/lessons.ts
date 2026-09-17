import {
  and,
  course,
  creditEntry,
  eq,
  inArray,
  lesson,
  lessonStudent,
  lt,
  person,
  sql,
  student,
  teacher,
} from "@classa/db";
import { cancelledInTime, creditForAttendance, dateInZone, fitsAvailability, weekdayOf } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { invalid, notFound, unprocessable } from "../http/errors.ts";
import type { Db, ServiceContext } from "./context.ts";
import { isQualified } from "./people.ts";

export async function getLessonRow(db: Db, ctx: ServiceContext, id: string) {
  const [row] = await db
    .select()
    .from(lesson)
    .where(and(eq(lesson.id, id), eq(lesson.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Aula");
  return row;
}

const isToday = (ctx: ServiceContext, d: Date) => dateInZone(d, ctx.timezone) === dateInZone(ctx.now, ctx.timezone);
const started = (ctx: ServiceContext, l: { startsAt: Date }) => l.startsAt <= ctx.now;

export async function lessonRoster(ctx: ServiceContext, lessonId: string) {
  await getLessonRow(ctx.db, ctx, lessonId);
  return ctx.db
    .select({
      id: lessonStudent.id,
      enrollmentId: lessonStudent.enrollmentId,
      studentId: lessonStudent.studentId,
      studentName: person.name,
      status: lessonStudent.status,
      cancelledInTime: lessonStudent.cancelledInTime,
      balance: sql<number>`(select coalesce(sum(ce.amount), 0)::int from credit_entry ce where ce.enrollment_id = ${lessonStudent.enrollmentId})`,
    })
    .from(lessonStudent)
    .innerJoin(student, eq(student.id, lessonStudent.studentId))
    .innerJoin(person, eq(person.id, student.personId))
    .where(eq(lessonStudent.lessonId, lessonId))
    .orderBy(person.name);
}

/** Presença ou falta. Abre no dia da aula; não vale para aula cancelada ou concluída. */
export async function setAttendance(ctx: ServiceContext, lessonId: string, entries: { enrollmentId: string; status: "presente" | "falta" }[]) {
  const l = await getLessonRow(ctx.db, ctx, lessonId);
  if (l.state === "cancelada") throw unprocessable("A aula foi cancelada.");
  if (l.state === "concluida") throw unprocessable("A aula já foi concluída.");
  if (dateInZone(l.startsAt, ctx.timezone) > dateInZone(ctx.now, ctx.timezone)) throw unprocessable("A lista de presença abre no dia da aula.");
  return ctx.db.transaction(async (tx) => {
    for (const e of entries) {
      const [row] = await tx
        .update(lessonStudent)
        .set({ status: e.status, cancelledInTime: null })
        .where(and(eq(lessonStudent.lessonId, l.id), eq(lessonStudent.enrollmentId, e.enrollmentId)))
        .returning();
      if (!row) throw invalid("enrollmentId", "Aluno não está inscrito nesta aula");
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "lesson", entityId: l.id, action: "update", after: { attendance: entries } });
  });
}

/** O aluno deixa de ir a uma aula. Dentro da antecedência do curso não gasta crédito. */
export async function cancelStudentLesson(ctx: ServiceContext, lessonId: string, enrollmentId: string, undo = false) {
  const l = await getLessonRow(ctx.db, ctx, lessonId);
  if (l.state !== "agendada" || started(ctx, l)) throw unprocessable("Só dá para mudar o agendamento antes de a aula começar.");
  const [c] = await ctx.db.select({ cancelNoticeHours: course.cancelNoticeHours }).from(course).where(eq(course.id, l.courseId));
  const inTime = cancelledInTime(ctx.now, l.startsAt, c!.cancelNoticeHours);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(lessonStudent)
      .set(undo ? { status: "inscrito", cancelledInTime: null } : { status: "cancelou", cancelledInTime: inTime })
      .where(and(eq(lessonStudent.lessonId, l.id), eq(lessonStudent.enrollmentId, enrollmentId)))
      .returning();
    if (!row) throw invalid("enrollmentId", "Aluno não está inscrito nesta aula");
    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      entity: "lesson_student",
      entityId: row.id,
      action: undo ? "reactivate" : "cancel",
      after: { ...row, cancelNoticeHours: c!.cancelNoticeHours },
    });
    return row;
  });
}

export async function startLesson(ctx: ServiceContext, lessonId: string) {
  const l = await getLessonRow(ctx.db, ctx, lessonId);
  if (l.state !== "agendada" && l.state !== "nao_finalizada") throw unprocessable("A aula não pode ser iniciada neste estado.");
  if (!isToday(ctx, l.startsAt)) throw unprocessable("A aula só pode ser iniciada no dia.");
  const [row] = await ctx.db.update(lesson).set({ state: "em_andamento" }).where(eq(lesson.id, l.id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "lesson", entityId: l.id, action: "transition", before: l, after: row });
  return row!;
}

/**
 * Conclui a aula: exige presença ou falta de todos os inscritos e lança no extrato
 * o que a política manda (presença, falta, cancelamento tardio). Idempotente por aula.
 */
export async function concludeLesson(ctx: ServiceContext, lessonId: string) {
  const l = await getLessonRow(ctx.db, ctx, lessonId);
  if (l.state === "cancelada") throw unprocessable("A aula foi cancelada.");
  if (l.state === "concluida") throw unprocessable("A aula já foi concluída.");
  if (dateInZone(l.startsAt, ctx.timezone) > dateInZone(ctx.now, ctx.timezone)) throw unprocessable("A aula ainda não aconteceu.");
  if (!l.teacherId) throw unprocessable("Defina o professor que deu a aula antes de concluir.");
  const roster = await ctx.db.select().from(lessonStudent).where(eq(lessonStudent.lessonId, l.id));
  const pending = roster.filter((r) => r.status === "inscrito");
  if (pending.length) throw unprocessable(`Marque presença ou falta de todos antes de concluir: falta${pending.length > 1 ? "m" : ""} ${pending.length}.`);

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.update(lesson).set({ state: "concluida" }).where(eq(lesson.id, l.id)).returning();
    const already = await tx
      .select({ enrollmentId: creditEntry.enrollmentId })
      .from(creditEntry)
      .where(and(eq(creditEntry.lessonId, l.id), inArray(creditEntry.kind, ["presenca", "falta", "cancelamento_tardio"])));
    const done = new Set(already.map((a) => a.enrollmentId));
    const entries = roster
      .filter((r) => !done.has(r.enrollmentId))
      .map((r) => ({ r, credit: creditForAttendance(r.status, r.cancelledInTime, ctx.settings.policies) }))
      .filter((x) => x.credit)
      .map(({ r, credit }) => ({
        tenantId: ctx.tenantId,
        enrollmentId: r.enrollmentId,
        kind: credit!.kind,
        amount: credit!.amount,
        lessonId: l.id,
        actorId: ctx.actorId,
      }));
    if (entries.length) await tx.insert(creditEntry).values(entries);
    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      entity: "lesson",
      entityId: l.id,
      action: "transition",
      before: l,
      after: { ...row, presentes: roster.filter((r) => r.status === "presente").length, faltas: roster.filter((r) => r.status === "falta").length },
    });
    return row!;
  });
}

/** Cancela a aula inteira antes do início. Ninguém perde crédito. */
export async function cancelLesson(ctx: ServiceContext, lessonId: string, reason: string, undo = false) {
  const l = await getLessonRow(ctx.db, ctx, lessonId);
  if (started(ctx, l)) throw unprocessable("Só dá para cancelar ou desfazer antes de a aula começar.");
  if (!undo) {
    if (l.state !== "agendada") throw unprocessable("Só aula agendada pode ser cancelada.");
    if (reason.trim().length < 3) throw invalid("reason", "Informe o motivo do cancelamento");
  } else if (l.state !== "cancelada") {
    throw unprocessable("A aula não está cancelada.");
  }
  const [row] = await ctx.db
    .update(lesson)
    .set(undo ? { state: "agendada", cancelReason: null } : { state: "cancelada", cancelReason: reason.trim() })
    .where(eq(lesson.id, l.id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "lesson", entityId: l.id, action: undo ? "reactivate" : "cancel", before: l, after: row });
  return row!;
}

/** Troca o professor de uma aula futura. Valida habilitação e disponibilidade; o banco barra choque de horário. */
export async function changeLessonTeacher(ctx: ServiceContext, lessonId: string, teacherId: string) {
  const l = await getLessonRow(ctx.db, ctx, lessonId);
  if (l.state !== "agendada" || started(ctx, l)) throw unprocessable("Só dá para trocar o professor de aula que ainda não começou. Para aula passada, use o fluxo de substituição.");
  if (l.teacherId === teacherId) throw invalid("teacherId", "Este já é o professor da aula");
  if (!(await isQualified(ctx.db, teacherId, l.courseId, l.moduleId))) throw invalid("teacherId", "Professor inativo ou não habilitado neste curso/módulo");
  const [t] = await ctx.db.select().from(teacher).where(eq(teacher.id, teacherId));
  const [c] = await ctx.db.select({ lessonMinutes: course.lessonMinutes }).from(course).where(eq(course.id, l.courseId));
  const date = dateInZone(l.startsAt, ctx.timezone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(l.startsAt);
  if (!fitsAvailability(t!.availability, weekdayOf(date), time, c!.lessonMinutes)) {
    throw invalid("teacherId", "Horário fora da disponibilidade do professor");
  }
  const originalTeacherId = l.originalTeacherId ?? l.teacherId;
  const [row] = await ctx.db
    .update(lesson)
    .set({ teacherId, originalTeacherId: originalTeacherId === teacherId ? null : originalTeacherId })
    .where(eq(lesson.id, l.id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "lesson", entityId: l.id, action: "update", before: l, after: row });
  return row!;
}

/** Job: aula cujo horário passou sem ser concluída vira "não finalizada". */
export async function markUnfinishedLessons(ctx: ServiceContext) {
  const rows = await ctx.db
    .update(lesson)
    .set({ state: "nao_finalizada" })
    .where(and(eq(lesson.tenantId, ctx.tenantId), inArray(lesson.state, ["agendada", "em_andamento"]), lt(lesson.endsAt, ctx.now)))
    .returning({ id: lesson.id });
  return rows.length;
}
