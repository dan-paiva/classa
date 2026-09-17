import {
  and,
  asc,
  classGroup,
  course,
  desc,
  eq,
  isNull,
  lesson,
  payrollLine,
  payrollPeriod,
  person,
  sql,
  teacher,
  type SupportReason,
} from "@classa/db";
import { dateInZone, lessonPayValue, monthStatus, nextMonthStart, payrollSituation, type PayrollSituation } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { invalid, notFound, unprocessable } from "../http/errors.ts";
import type { Db, ServiceContext } from "./context.ts";

const today = (ctx: ServiceContext) => dateInZone(ctx.now, ctx.timezone);
const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export async function currentPeriod(db: Db, ctx: ServiceContext, month: string) {
  const [row] = await db
    .select()
    .from(payrollPeriod)
    .where(and(eq(payrollPeriod.tenantId, ctx.tenantId), eq(payrollPeriod.month, month), isNull(payrollPeriod.reopenedAt)));
  return row ?? null;
}

/** Aulas de uma competência fechada não mudam: presença, professor, cancelamento, valor e suporte. */
export async function assertMonthOpen(db: Db, ctx: ServiceContext, startsAt: Date) {
  const month = dateInZone(startsAt, ctx.timezone).slice(0, 7);
  if (await currentPeriod(db, ctx, month)) {
    throw unprocessable(`A folha de ${month.slice(5)}/${month.slice(0, 4)} está fechada. Reabra a competência para alterar aulas desse mês.`);
  }
}

export type PayrollLesson = {
  lessonId: string;
  startsAt: Date;
  className: string;
  courseName: string;
  state: string;
  situation: PayrollSituation;
  valueCents: number;
  minutes: number;
  individual: boolean;
  overridden: boolean;
  supportReason: SupportReason | null;
  substitute: boolean;
  present: number;
  absent: number;
};

async function monthLessons(ctx: ServiceContext, month: string) {
  const from = `${month}-01`;
  const to = nextMonthStart(month);
  const rows = await ctx.db
    .select({
      lesson,
      className: classGroup.name,
      individual: classGroup.individual,
      classRateCents: classGroup.teacherRateCents,
      courseName: course.name,
      hourlyRateCents: teacher.hourlyRateCents,
      teacherName: person.name,
      present: sql<number>`(select count(*)::int from lesson_student ls where ls.lesson_id = ${lesson.id} and ls.status = 'presente')`,
      absent: sql<number>`(select count(*)::int from lesson_student ls where ls.lesson_id = ${lesson.id} and ls.status = 'falta')`,
    })
    .from(lesson)
    .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
    .innerJoin(course, eq(course.id, lesson.courseId))
    .leftJoin(teacher, eq(teacher.id, lesson.teacherId))
    .leftJoin(person, eq(person.id, teacher.personId))
    .where(
      and(
        eq(lesson.tenantId, ctx.tenantId),
        sql`(${lesson.startsAt} at time zone ${ctx.timezone})::date >= ${from}::date`,
        sql`(${lesson.startsAt} at time zone ${ctx.timezone})::date < ${to}::date`,
        sql`${lesson.startsAt} <= ${ctx.now.toISOString()}`,
      ),
    )
    .orderBy(asc(lesson.startsAt));
  return rows.map((r) => {
    const minutes = Math.round((r.lesson.endsAt.getTime() - r.lesson.startsAt.getTime()) / 60000);
    return {
      teacherId: r.lesson.teacherId,
      teacherName: r.teacherName,
      item: {
        lessonId: r.lesson.id,
        startsAt: r.lesson.startsAt,
        className: r.className,
        courseName: r.courseName,
        state: r.lesson.state,
        situation: payrollSituation(r.lesson),
        valueCents: lessonPayValue({
          individual: r.individual,
          classRateCents: r.classRateCents,
          overrideCents: r.lesson.rateOverrideCents,
          hourlyRateCents: r.hourlyRateCents,
          minutes,
        }),
        minutes,
        individual: r.individual,
        overridden: r.lesson.rateOverrideCents != null,
        supportReason: r.lesson.supportReason,
        substitute: !!r.lesson.originalTeacherId,
        present: r.present,
        absent: r.absent,
      } satisfies PayrollLesson,
    };
  });
}

export type PayrollTeacherLine = {
  teacherId: string;
  teacherName: string;
  paidLessons: number;
  discountedLessons: number;
  pendingLessons: number;
  minutes: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  lessons: PayrollLesson[];
  lineId?: string;
  paidOn?: string | null;
};

/** Folha do mês calculada a partir das aulas, ou o retrato gravado se a competência está fechada. */
export async function computePayroll(ctx: ServiceContext, month: string) {
  if (!isMonth(month)) throw invalid("month", "Competência no formato AAAA-MM");
  const period = await currentPeriod(ctx.db, ctx, month);
  const items = await monthLessons(ctx, month);

  const byTeacher = new Map<string, PayrollTeacherLine>();
  let pending = 0;
  for (const { teacherId, teacherName, item } of items) {
    if (item.situation === "fora" || !teacherId) continue;
    const line =
      byTeacher.get(teacherId) ??
      byTeacher
        .set(teacherId, { teacherId, teacherName: teacherName ?? "—", paidLessons: 0, discountedLessons: 0, pendingLessons: 0, minutes: 0, grossCents: 0, discountCents: 0, netCents: 0, lessons: [] })
        .get(teacherId)!;
    line.lessons.push(item);
    if (item.situation === "pendente") {
      line.pendingLessons++;
      pending++;
      continue;
    }
    line.minutes += item.minutes;
    line.grossCents += item.valueCents;
    if (item.situation === "descontada") {
      line.discountedLessons++;
      line.discountCents += item.valueCents;
    } else {
      line.paidLessons++;
    }
    line.netCents = line.grossCents - line.discountCents;
  }

  let lines = [...byTeacher.values()];
  if (period) {
    const stored = await ctx.db
      .select({ line: payrollLine, teacherName: person.name })
      .from(payrollLine)
      .innerJoin(teacher, eq(teacher.id, payrollLine.teacherId))
      .innerJoin(person, eq(person.id, teacher.personId))
      .where(eq(payrollLine.periodId, period.id));
    lines = stored.map(({ line, teacherName }) => ({
      teacherId: line.teacherId,
      teacherName,
      paidLessons: line.paidLessons,
      discountedLessons: line.discountedLessons,
      pendingLessons: 0,
      minutes: line.minutes,
      grossCents: line.grossCents,
      discountCents: line.discountCents,
      netCents: line.netCents,
      lessons: byTeacher.get(line.teacherId)?.lessons ?? [],
      lineId: line.id,
      paidOn: line.paidOn,
    }));
  }
  lines.sort((a, b) => b.pendingLessons - a.pendingLessons || b.netCents - a.netCents);

  const totals = lines.reduce(
    (t, l) => ({
      paidLessons: t.paidLessons + l.paidLessons,
      discountedLessons: t.discountedLessons + l.discountedLessons,
      pendingLessons: t.pendingLessons + l.pendingLessons,
      minutes: t.minutes + l.minutes,
      grossCents: t.grossCents + l.grossCents,
      discountCents: t.discountCents + l.discountCents,
      netCents: t.netCents + l.netCents,
    }),
    { paidLessons: 0, discountedLessons: 0, pendingLessons: 0, minutes: 0, grossCents: 0, discountCents: 0, netCents: 0 },
  );

  return {
    month,
    status: monthStatus(month, today(ctx), pending, !!period),
    period,
    lines,
    totals,
  };
}

export async function closeMonth(ctx: ServiceContext, month: string) {
  const payroll = await computePayroll(ctx, month);
  if (payroll.status === "fechada") throw unprocessable("Esta competência já está fechada.");
  if (payroll.status === "em_andamento") throw unprocessable("Só dá para fechar um mês que já terminou.");
  if (payroll.status === "travada") {
    throw unprocessable(`Há ${payroll.totals.pendingLessons} aulas não finalizadas neste mês. Registre a presença e conclua antes de fechar.`);
  }
  return ctx.db.transaction(async (tx) => {
    const [period] = await tx
      .insert(payrollPeriod)
      .values({
        tenantId: ctx.tenantId,
        month,
        closedAt: ctx.now,
        closedBy: ctx.actorId,
        grossCents: payroll.totals.grossCents,
        discountCents: payroll.totals.discountCents,
        netCents: payroll.totals.netCents,
        lessons: payroll.totals.paidLessons + payroll.totals.discountedLessons,
      })
      .returning();
    if (payroll.lines.length) {
      await tx.insert(payrollLine).values(
        payroll.lines.map((l) => ({
          tenantId: ctx.tenantId,
          periodId: period!.id,
          teacherId: l.teacherId,
          paidLessons: l.paidLessons,
          discountedLessons: l.discountedLessons,
          minutes: l.minutes,
          grossCents: l.grossCents,
          discountCents: l.discountCents,
          netCents: l.netCents,
          details: l.lessons.map((x) => ({ lessonId: x.lessonId, valueCents: x.valueCents, situation: x.situation })),
        })),
      );
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "payroll_period", entityId: period!.id, action: "create", after: { ...period, teachers: payroll.lines.length } });
    return period!;
  });
}

export async function reopenMonth(ctx: ServiceContext, month: string, justification: string) {
  const period = await currentPeriod(ctx.db, ctx, month);
  if (!period) throw unprocessable("Esta competência não está fechada.");
  if (justification.trim().length < 5) throw invalid("justification", "Reabrir a folha exige justificativa");
  const [row] = await ctx.db
    .update(payrollPeriod)
    .set({ reopenedAt: ctx.now, reopenedBy: ctx.actorId, reopenJustification: justification.trim() })
    .where(eq(payrollPeriod.id, period.id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "payroll_period", entityId: period.id, action: "reactivate", before: period, after: row });
  return row!;
}

export async function markLinePaid(ctx: ServiceContext, lineId: string, paidOn: string) {
  const [line] = await ctx.db
    .select({ line: payrollLine, reopenedAt: payrollPeriod.reopenedAt })
    .from(payrollLine)
    .innerJoin(payrollPeriod, eq(payrollPeriod.id, payrollLine.periodId))
    .where(and(eq(payrollLine.id, lineId), eq(payrollLine.tenantId, ctx.tenantId)));
  if (!line) throw notFound("Linha da folha");
  if (line.reopenedAt) throw unprocessable("A competência foi reaberta. Feche de novo antes de pagar.");
  if (paidOn > today(ctx)) throw invalid("paidOn", "Data de pagamento no futuro");
  const [row] = await ctx.db.update(payrollLine).set({ paidOn, paidBy: ctx.actorId }).where(eq(payrollLine.id, lineId)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "payroll_line", entityId: lineId, action: "update", before: line.line, after: row });
  return row!;
}

/* ------------------------------------------------------------ ajustes na aula */

async function getLesson(db: Db, ctx: ServiceContext, id: string) {
  const [row] = await db
    .select({ lesson, individual: classGroup.individual })
    .from(lesson)
    .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
    .where(and(eq(lesson.id, id), eq(lesson.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Aula");
  return row;
}

/** Pedido de suporte do professor: a aula é descontada da folha. */
export async function requestSupport(ctx: ServiceContext, lessonId: string, input: { reason: SupportReason; detail?: string } | null) {
  const { lesson: l } = await getLesson(ctx.db, ctx, lessonId);
  if (l.state === "cancelada") throw unprocessable("A aula foi cancelada.");
  if (!l.teacherId) throw unprocessable("A aula não tem professor.");
  if (dateInZone(l.startsAt, ctx.timezone) > today(ctx)) throw unprocessable("Suporte só pode ser pedido no dia da aula ou depois.");
  await assertMonthOpen(ctx.db, ctx, l.startsAt);
  const [row] = await ctx.db
    .update(lesson)
    .set(
      input
        ? { supportReason: input.reason, supportDetail: input.detail?.trim() || null, supportRequestedAt: ctx.now }
        : { supportReason: null, supportDetail: null, supportRequestedAt: null },
    )
    .where(eq(lesson.id, l.id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "lesson", entityId: l.id, action: "update", before: l, after: row });
  return row!;
}

/** Valor pago ao professor só nesta aula (aula particular), com motivo. null volta ao valor da turma. */
export async function overrideLessonRate(ctx: ServiceContext, lessonId: string, input: { cents: number; reason: string } | null) {
  const { lesson: l, individual } = await getLesson(ctx.db, ctx, lessonId);
  if (!individual) throw unprocessable("Só aulas particulares têm valor por aula. Nas turmas, o valor vem do valor hora do professor.");
  if (l.state === "cancelada") throw unprocessable("A aula foi cancelada.");
  await assertMonthOpen(ctx.db, ctx, l.startsAt);
  if (input) {
    if (!Number.isInteger(input.cents) || input.cents < 0) throw invalid("cents", "Valor inválido");
    if (input.reason.trim().length < 3) throw invalid("reason", "Informe o motivo da alteração");
  }
  const [row] = await ctx.db
    .update(lesson)
    .set(input ? { rateOverrideCents: input.cents, rateOverrideReason: input.reason.trim() } : { rateOverrideCents: null, rateOverrideReason: null })
    .where(eq(lesson.id, l.id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "lesson", entityId: l.id, action: "update", before: l, after: row });
  return row!;
}

/** Valor fixo por aula da turma particular. */
export async function setClassGroupTeacherRate(ctx: ServiceContext, classGroupId: string, cents: number | null) {
  const [cg] = await ctx.db.select().from(classGroup).where(and(eq(classGroup.id, classGroupId), eq(classGroup.tenantId, ctx.tenantId)));
  if (!cg) throw notFound("Turma");
  if (!cg.individual) throw unprocessable("Valor por aula só existe em aula particular.");
  if (cents != null && (!Number.isInteger(cents) || cents < 0)) throw invalid("cents", "Valor inválido");
  const [row] = await ctx.db.update(classGroup).set({ teacherRateCents: cents }).where(eq(classGroup.id, cg.id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "class_group", entityId: cg.id, action: "update", before: cg, after: row });
  return row!;
}

/** Histórico de fechamentos, do mais recente ao mais antigo. */
export async function listPeriods(ctx: ServiceContext) {
  return ctx.db.select().from(payrollPeriod).where(eq(payrollPeriod.tenantId, ctx.tenantId)).orderBy(desc(payrollPeriod.closedAt));
}

