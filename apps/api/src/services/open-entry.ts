import { and, classGroup, course, courseModule, eq, isNull, lesson, lessonStudent, sql, teacher, person, room } from "@classa/db";
import { cancelledInTime, dateInZone } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { invalid, notFound, unprocessable } from "../http/errors.ts";
import type { Db, ServiceContext } from "./context.ts";
import { balanceOf, getEnrollmentRow } from "./enrollments.ts";
import { getStudentRow } from "./people.ts";

/**
 * Open-entry: a escola publica os horários e o aluno ocupa as vagas, uma aula
 * por vez, sempre dentro do nível da matrícula dele (DOMINIO.md §5.9).
 *
 * A oferta open-entry é uma turma como qualquer outra — tem professor, sala,
 * grade e vagas, e gera aulas pelo mesmo job. O que muda é que ninguém está
 * matriculado nela: o assento é a linha em `lesson_student`, a mesma do regime
 * regular. Por isso cancelar, faltar e debitar crédito continuam iguais.
 */

/** Situações que não podem marcar aula nova (DOMINIO.md §3.2). */
const BLOQUEIA_AGENDAMENTO = ["cancelado", "inativo", "suspenso", "congelado", "inadimplente"];

/** Assentos ocupados: quem cancelou libera a vaga, mas a linha fica para o débito. */
const takenSeatsSql = sql<number>`(
  select count(*)::int from lesson_student ls
  where ls.lesson_id = "lesson"."id" and ls.status <> 'cancelou'
)`;

/**
 * Saldo que sobra depois do que já está reservado e ainda não aconteceu.
 * O crédito só é debitado quando a aula acontece (5.5), então olhar só o saldo
 * deixaria o aluno reservar o ano inteiro com uma aula no pacote.
 */
export async function availableCredits(ctx: ServiceContext, enrollmentId: string) {
  const saldo = await balanceOf(ctx.db, enrollmentId);
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(lessonStudent)
    .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
    .where(
      and(
        eq(lessonStudent.enrollmentId, enrollmentId),
        eq(lessonStudent.status, "inscrito"),
        eq(lesson.state, "agendada"),
        sql`${lesson.startsAt} >= ${ctx.now.toISOString()}`,
      ),
    );
  return saldo - (row?.n ?? 0);
}

async function openEntryEnrollment(ctx: ServiceContext, enrollmentId: string) {
  const e = await getEnrollmentRow(ctx.db, ctx, enrollmentId);
  if (e.regime !== "open_entry") throw unprocessable("Esta matrícula não é open-entry: as aulas dela já vêm da turma.");
  if (e.endedAt) throw unprocessable("A matrícula está encerrada.");
  return e;
}

/**
 * Aulas que esta matrícula pode reservar: do mesmo curso e do mesmo módulo, em
 * oferta open-entry, ainda por acontecer e dentro do período do contrato.
 */
export async function listOpenSlots(ctx: ServiceContext, enrollmentId: string, filters: { from?: string; to?: string } = {}) {
  const e = await openEntryEnrollment(ctx, enrollmentId);
  const rows = await ctx.db
    .select({
      id: lesson.id,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      className: classGroup.name,
      moduleName: courseModule.name,
      teacherName: person.name,
      roomName: room.name,
      modality: classGroup.modality,
      capacity: classGroup.capacity,
      taken: takenSeatsSql,
      mine: sql<boolean>`exists (
        select 1 from lesson_student ls
        where ls.lesson_id = "lesson"."id" and ls.enrollment_id = ${enrollmentId} and ls.status <> 'cancelou'
      )`,
    })
    .from(lesson)
    .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
    .innerJoin(course, eq(course.id, lesson.courseId))
    .leftJoin(courseModule, eq(courseModule.id, lesson.moduleId))
    .leftJoin(teacher, eq(teacher.id, lesson.teacherId))
    .leftJoin(person, eq(person.id, teacher.personId))
    .leftJoin(room, eq(room.id, lesson.roomId))
    .where(
      and(
        eq(lesson.tenantId, ctx.tenantId),
        eq(classGroup.regime, "open_entry"),
        isNull(classGroup.deactivatedAt),
        eq(lesson.courseId, e.courseId),
        eq(lesson.moduleId, e.moduleId!),
        eq(lesson.state, "agendada"),
        sql`${lesson.startsAt} >= ${(filters.from ? new Date(`${filters.from}T00:00:00Z`) : ctx.now).toISOString()}`,
        // não oferece o que a reserva vai recusar: a janela de antecedência do curso já passou
        sql`${lesson.startsAt} >= ${ctx.now.toISOString()}::timestamptz + make_interval(hours => ${course.cancelNoticeHours})`,
        filters.to ? sql`${lesson.startsAt} < ${new Date(`${filters.to}T23:59:59Z`).toISOString()}` : undefined,
        sql`(${lesson.startsAt} at time zone ${ctx.timezone})::date between ${e.startsOn} and ${e.endsOn}`,
      ),
    )
    .orderBy(lesson.startsAt);
  return rows.map((r) => ({ ...r, seatsLeft: r.capacity - r.taken, full: r.taken >= r.capacity }));
}

/** Choque com outra aula do próprio aluno, considerando a duração inteira. */
async function clashesForStudent(db: Db, studentId: string, startsAt: Date, endsAt: Date, ignoreLessonId?: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lessonStudent)
    .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
    .where(
      and(
        eq(lessonStudent.studentId, studentId),
        sql`${lessonStudent.status} <> 'cancelou'`,
        sql`${lesson.state} <> 'cancelada'`,
        ignoreLessonId ? sql`${lesson.id} <> ${ignoreLessonId}` : undefined,
        sql`tstzrange(${lesson.startsAt}, ${lesson.endsAt}) && tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz)`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Reserva uma vaga. Valida em ordem, e o primeiro erro bloqueia — nível, janela,
 * choque, vaga e saldo. A vaga é conferida com a aula travada, para duas
 * reservas simultâneas não passarem das vagas.
 */
export async function reserveLesson(ctx: ServiceContext, enrollmentId: string, lessonId: string) {
  const e = await openEntryEnrollment(ctx, enrollmentId);
  const s = await getStudentRow(ctx.db, ctx, e.studentId);
  if (BLOQUEIA_AGENDAMENTO.includes(s.status)) throw unprocessable(`Aluno ${s.status} não pode marcar aula nova.`);

  const [l] = await ctx.db
    .select({ lesson, regime: classGroup.regime, capacity: classGroup.capacity, className: classGroup.name, cancelNoticeHours: course.cancelNoticeHours })
    .from(lesson)
    .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(and(eq(lesson.id, lessonId), eq(lesson.tenantId, ctx.tenantId)));
  if (!l) throw notFound("Aula");
  if (l.regime !== "open_entry") throw unprocessable("Esta aula é de uma turma fechada; a inscrição vem da matrícula.");
  if (l.lesson.state !== "agendada") throw unprocessable("A aula não está mais aberta para reserva.");
  if (l.lesson.courseId !== e.courseId) throw unprocessable("A aula é de outro curso.");
  if (l.lesson.moduleId !== e.moduleId) throw unprocessable("A aula é de outro nível. Você só reserva no nível da sua matrícula.");

  const dia = dateInZone(l.lesson.startsAt, ctx.timezone);
  if (dia < e.startsOn || dia > e.endsOn) throw unprocessable("A aula está fora do período do seu contrato.");
  // mesma antecedência do cancelamento: quem não pode desmarcar também não marca em cima da hora (decisão D13)
  if (!cancelledInTime(ctx.now, l.lesson.startsAt, l.cancelNoticeHours)) {
    throw unprocessable(`A reserva fecha ${l.cancelNoticeHours}h antes da aula.`);
  }
  if ((await availableCredits(ctx, e.id)) <= 0) {
    throw unprocessable("Sem saldo de aulas nesta matrícula, contando as que você já reservou.");
  }

  return ctx.db.transaction(async (tx) => {
    // trava a aula: sem isso, duas reservas ao mesmo tempo passam das vagas
    await tx.execute(sql`select id from lesson where id = ${l.lesson.id} for update`);

    const [existente] = await tx
      .select({ id: lessonStudent.id, status: lessonStudent.status })
      .from(lessonStudent)
      .where(and(eq(lessonStudent.lessonId, l.lesson.id), eq(lessonStudent.enrollmentId, e.id)));
    if (existente && existente.status !== "cancelou") throw unprocessable("Você já tem essa aula reservada.");

    if (await clashesForStudent(tx, e.studentId, l.lesson.startsAt, l.lesson.endsAt, l.lesson.id)) {
      throw unprocessable("Você já tem outra aula nesse horário.");
    }

    const [seats] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(lessonStudent)
      .where(and(eq(lessonStudent.lessonId, l.lesson.id), sql`${lessonStudent.status} <> 'cancelou'`));
    if ((seats?.n ?? 0) >= l.capacity) throw unprocessable(`A aula está cheia (${l.capacity} vagas).`);

    // quem tinha cancelado volta para a mesma linha, para não perder o histórico
    const [row] = existente
      ? await tx.update(lessonStudent).set({ status: "inscrito", cancelledInTime: null }).where(eq(lessonStudent.id, existente.id)).returning()
      : await tx
          .insert(lessonStudent)
          .values({ tenantId: ctx.tenantId, lessonId: l.lesson.id, enrollmentId: e.id, studentId: e.studentId })
          .returning();
    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      entity: "lesson_student",
      entityId: row!.id,
      action: "create",
      after: { ...row, reserva: "open_entry", className: l.className, startsAt: l.lesson.startsAt },
    });
    return row!;
  });
}
