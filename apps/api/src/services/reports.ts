import { and, classGroup, course, enrollment, eq, gte, isNull, lesson, lessonStudent, lt, payment, person, sql, student, teacher } from "@classa/db";
import { addDays, dateInZone, nextMonthStart } from "@classa/domain";
import type { ServiceContext } from "./context.ts";
import { listCompanies } from "./companies.ts";
import { listInstallments } from "./finance.ts";
import { markUnfinishedLessons } from "./lessons.ts";
import { computePayroll } from "./payroll.ts";
import { renewalQueue } from "./workflows.ts";

const today = (ctx: ServiceContext) => dateInZone(ctx.now, ctx.timezone);
const monthOf = (date: string) => date.slice(0, 7);

/** Os últimos `n` meses, do mais antigo ao mês corrente. */
export function lastMonths(ctx: ServiceContext, n: number): string[] {
  const months: string[] = [monthOf(today(ctx))];
  while (months.length < n) {
    const [y, m] = months[0]!.split("-").map(Number);
    months.unshift(m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`);
  }
  return months;
}

/** Data (no fuso da escola) em que a aula começou, para agrupar por mês. */
const lessonMonth = (ctx: ServiceContext) => sql<string>`to_char(${lesson.startsAt} at time zone ${ctx.timezone}, 'YYYY-MM')`;

/* ================================================================ financeiro */

export async function financeReport(ctx: ServiceContext, months: number) {
  const list = lastMonths(ctx, months);
  const from = `${list[0]}-01`;
  const to = nextMonthStart(list.at(-1)!);

  const received = await ctx.db
    .select({ month: sql<string>`to_char(${payment.paidOn}, 'YYYY-MM')`, cents: sql<number>`sum(${payment.amountCents})::int` })
    .from(payment)
    .where(and(eq(payment.tenantId, ctx.tenantId), gte(payment.paidOn, from), lt(payment.paidOn, to)))
    .groupBy(sql`1`);

  const recognized = await ctx.db
    .select({
      month: lessonMonth(ctx),
      cents: sql<number>`sum(${course.lessonPriceCents})::int`,
      lessons: sql<number>`count(distinct ${lesson.id})::int`,
      students: sql<number>`count(distinct ${lessonStudent.studentId})::int`,
    })
    .from(lessonStudent)
    .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(
      and(
        eq(lesson.tenantId, ctx.tenantId),
        eq(lesson.state, "concluida"),
        sql`${lessonStudent.status} in ('presente', 'falta')`,
        sql`(${lesson.startsAt} at time zone ${ctx.timezone})::date >= ${from}::date`,
        sql`(${lesson.startsAt} at time zone ${ctx.timezone})::date < ${to}::date`,
      ),
    )
    .groupBy(sql`1`);

  const byMonth = <T extends { month: string }>(rows: T[]) => new Map(rows.map((r) => [r.month, r]));
  const rec = byMonth(received);
  const rcg = byMonth(recognized);

  const rows = [];
  for (const month of list) {
    // a folha reusa o cálculo da tela de folha, para os números baterem
    const payroll = await computePayroll(ctx, month);
    const receivedCents = rec.get(month)?.cents ?? 0;
    const recognizedCents = rcg.get(month)?.cents ?? 0;
    const payrollCents = payroll.totals.netCents;
    rows.push({
      month,
      receivedCents,
      recognizedCents,
      payrollCents,
      marginCents: recognizedCents - payrollCents,
      lessons: rcg.get(month)?.lessons ?? 0,
      students: rcg.get(month)?.students ?? 0,
      payrollStatus: payroll.status,
    });
  }
  return { months: rows };
}

/* ================================================================ frequência */

export async function attendanceReport(ctx: ServiceContext, range: { from: string; to: string }) {
  const where = and(
    eq(lesson.tenantId, ctx.tenantId),
    eq(lesson.state, "concluida"),
    sql`(${lesson.startsAt} at time zone ${ctx.timezone})::date >= ${range.from}::date`,
    sql`(${lesson.startsAt} at time zone ${ctx.timezone})::date <= ${range.to}::date`,
  );
  const counts = {
    present: sql<number>`count(*) filter (where ${lessonStudent.status} = 'presente')::int`,
    absent: sql<number>`count(*) filter (where ${lessonStudent.status} = 'falta')::int`,
    cancelledInTime: sql<number>`count(*) filter (where ${lessonStudent.status} = 'cancelou' and ${lessonStudent.cancelledInTime})::int`,
    cancelledLate: sql<number>`count(*) filter (where ${lessonStudent.status} = 'cancelou' and not ${lessonStudent.cancelledInTime})::int`,
  };

  const groups = await ctx.db
    .select({
      classGroupId: classGroup.id,
      className: classGroup.name,
      courseName: course.name,
      courseColor: course.color,
      lessons: sql<number>`count(distinct ${lesson.id})::int`,
      ...counts,
    })
    .from(lessonStudent)
    .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
    .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(where)
    .groupBy(classGroup.id, classGroup.name, course.name, course.color)
    .orderBy(sql`5 desc`);

  const students = await ctx.db
    .select({ studentId: student.id, studentName: person.name, ...counts })
    .from(lessonStudent)
    .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
    .innerJoin(student, eq(student.id, lessonStudent.studentId))
    .innerJoin(person, eq(person.id, student.personId))
    .where(where)
    .groupBy(student.id, person.name);

  const rate = (r: { present: number; absent: number }) => (r.present + r.absent ? Math.round((r.present / (r.present + r.absent)) * 100) : null);
  const totals = groups.reduce(
    (t, g) => ({
      lessons: t.lessons + g.lessons,
      present: t.present + g.present,
      absent: t.absent + g.absent,
      cancelledInTime: t.cancelledInTime + g.cancelledInTime,
      cancelledLate: t.cancelledLate + g.cancelledLate,
    }),
    { lessons: 0, present: 0, absent: 0, cancelledInTime: 0, cancelledLate: 0 },
  );

  return {
    range,
    totals: { ...totals, attendancePercent: rate(totals) },
    groups: groups.map((g) => ({ ...g, attendancePercent: rate(g) })),
    // alunos com mais faltas primeiro: são os candidatos a contato
    students: students
      .map((s) => ({ ...s, attendancePercent: rate(s) }))
      .filter((s) => s.absent > 0 || s.cancelledLate > 0)
      .sort((a, b) => b.absent + b.cancelledLate - (a.absent + a.cancelledLate))
      .slice(0, 15),
  };
}

/* =============================================================== professores */

export async function teacherReport(ctx: ServiceContext, range: { from: string; to: string }, withCost: boolean) {
  const rows = await ctx.db
    .select({
      teacherId: teacher.id,
      teacherName: person.name,
      weeklyLimit: teacher.weeklyLimit,
      lessons: sql<number>`count(*) filter (where ${lesson.state} = 'concluida')::int`,
      cancelled: sql<number>`count(*) filter (where ${lesson.state} = 'cancelada')::int`,
      unfinished: sql<number>`count(*) filter (where ${lesson.state} = 'nao_finalizada')::int`,
      minutes: sql<number>`coalesce(sum(extract(epoch from (${lesson.endsAt} - ${lesson.startsAt})) / 60) filter (where ${lesson.state} = 'concluida'), 0)::int`,
      substitutions: sql<number>`count(*) filter (where ${lesson.originalTeacherId} is not null and ${lesson.originalTeacherId} <> ${lesson.teacherId})::int`,
      support: sql<number>`count(*) filter (where ${lesson.supportReason} is not null)::int`,
    })
    .from(lesson)
    .innerJoin(teacher, eq(teacher.id, lesson.teacherId))
    .innerJoin(person, eq(person.id, teacher.personId))
    .where(
      and(
        eq(lesson.tenantId, ctx.tenantId),
        sql`(${lesson.startsAt} at time zone ${ctx.timezone})::date >= ${range.from}::date`,
        sql`(${lesson.startsAt} at time zone ${ctx.timezone})::date <= ${range.to}::date`,
      ),
    )
    .groupBy(teacher.id, person.name, teacher.weeklyLimit)
    .orderBy(sql`4 desc`);

  const weeks = Math.max(1, Math.round((Date.parse(range.to) - Date.parse(range.from)) / (7 * 86400_000)) || 1);
  const costByTeacher = new Map<string, number>();
  if (withCost) {
    const months = new Set<string>();
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) months.add(monthOf(d));
    for (const month of months) {
      const payroll = await computePayroll(ctx, month);
      for (const line of payroll.lines) {
        const inRange = line.lessons.filter((l) => {
          const day = dateInZone(l.startsAt, ctx.timezone);
          return day >= range.from && day <= range.to && l.situation === "paga";
        });
        costByTeacher.set(line.teacherId, (costByTeacher.get(line.teacherId) ?? 0) + inRange.reduce((s, l) => s + l.valueCents, 0));
      }
    }
  }

  return {
    range,
    weeks,
    teachers: rows.map((r) => ({
      ...r,
      hours: Math.round(r.minutes / 6) / 10,
      lessonsPerWeek: Math.round((r.lessons / weeks) * 10) / 10,
      // o limite é semanal: comparo com a média do período
      overLimit: r.weeklyLimit != null && r.lessons / weeks > r.weeklyLimit,
      costCents: withCost ? (costByTeacher.get(r.teacherId) ?? 0) : null,
    })),
  };
}

/* ================================================================ matrículas */

export async function enrollmentReport(ctx: ServiceContext, months: number) {
  const list = lastMonths(ctx, months);
  const from = `${list[0]}-01`;

  const started = await ctx.db
    .select({ month: sql<string>`to_char(${enrollment.startsOn}, 'YYYY-MM')`, n: sql<number>`count(*)::int` })
    .from(enrollment)
    .where(and(eq(enrollment.tenantId, ctx.tenantId), gte(enrollment.startsOn, from)))
    .groupBy(sql`1`);

  const ended = await ctx.db
    .select({
      month: sql<string>`to_char(${enrollment.endedAt} at time zone ${ctx.timezone}, 'YYYY-MM')`,
      n: sql<number>`count(*)::int`,
    })
    .from(enrollment)
    .where(and(eq(enrollment.tenantId, ctx.tenantId), sql`${enrollment.endedAt} >= ${from}::date`))
    .groupBy(sql`1`);

  const byStatus = await ctx.db
    .select({ status: student.status, n: sql<number>`count(*)::int` })
    .from(student)
    .where(eq(student.tenantId, ctx.tenantId))
    .groupBy(student.status);

  const byCourse = await ctx.db
    .select({
      courseName: course.name,
      courseColor: course.color,
      active: sql<number>`count(*)::int`,
      students: sql<number>`count(distinct ${enrollment.studentId})::int`,
    })
    .from(enrollment)
    .innerJoin(course, eq(course.id, enrollment.courseId))
    .where(and(eq(enrollment.tenantId, ctx.tenantId), isNull(enrollment.endedAt)))
    .groupBy(course.name, course.color)
    .orderBy(sql`3 desc`);

  const start = new Map(started.map((r) => [r.month, r.n]));
  const end = new Map(ended.map((r) => [r.month, r.n]));

  return {
    months: list.map((month) => ({ month, started: start.get(month) ?? 0, ended: end.get(month) ?? 0 })),
    byStatus,
    byCourse,
  };
}

/* ==================================================================== alertas */

export type Alert = {
  key: string;
  tone: "danger" | "warn" | "info";
  title: string;
  detail: string;
  count: number;
  /** Recurso necessário para ver o alerta; a rota filtra pelo perfil. */
  resource: "agenda" | "financeiro" | "folha" | "alunos" | "empresas" | "professores";
};

export async function alerts(ctx: ServiceContext, allowed: (resource: Alert["resource"]) => boolean) {
  const out: Alert[] = [];
  const day = today(ctx);
  const push = (a: Alert) => {
    if (a.count > 0 && allowed(a.resource)) out.push(a);
  };

  if (allowed("agenda")) {
    // a aula que passou da hora sem conclusão vira "não finalizada" antes da contagem
    await markUnfinishedLessons(ctx);
    const [agenda] = await ctx.db
      .select({
        unfinished: sql<number>`count(*) filter (where ${lesson.state} = 'nao_finalizada')::int`,
        noTeacher: sql<number>`count(*) filter (where ${lesson.teacherId} is null and ${lesson.startsAt} > ${ctx.now.toISOString()}::timestamptz and ${lesson.state} = 'agendada')::int`,
        noRoom: sql<number>`count(*) filter (where ${lesson.roomId} is null and ${lesson.startsAt} > ${ctx.now.toISOString()}::timestamptz and ${lesson.state} = 'agendada')::int`,
      })
      .from(lesson)
      .where(and(eq(lesson.tenantId, ctx.tenantId), gte(lesson.startsAt, new Date(`${addDays(day, -60)}T00:00:00Z`))));
    push({ key: "aulas-nao-finalizadas", tone: "danger", title: "Aulas sem presença registrada", detail: "Elas travam o fechamento da folha.", count: agenda?.unfinished ?? 0, resource: "agenda" });
    push({ key: "aulas-sem-professor", tone: "warn", title: "Aulas futuras sem professor", detail: "Defina um professor ou abra uma substituição.", count: agenda?.noTeacher ?? 0, resource: "agenda" });
    push({ key: "aulas-sem-sala", tone: "info", title: "Aulas futuras sem sala", detail: "Reserve uma sala para essas aulas.", count: agenda?.noRoom ?? 0, resource: "agenda" });
  }

  if (allowed("financeiro")) {
    const overdue = (await listInstallments(ctx, { status: "vencida" })).map((i) => ({ ...i, open: i.amountCents - i.paidCents }));
    const cents = overdue.reduce((s, i) => s + i.open, 0);
    const students = new Set(overdue.map((i) => i.studentId)).size;
    push({
      key: "parcelas-vencidas",
      tone: "danger",
      title: "Parcelas vencidas",
      detail: `${(cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em aberto, de ${students} aluno${students > 1 ? "s" : ""}.`,
      count: overdue.length,
      resource: "financeiro",
    });
  }

  if (allowed("alunos")) {
    const queue = await renewalQueue(ctx);
    const urgent = queue.filter((q) => q.urgent);
    push({ key: "renovacoes", tone: urgent.length ? "warn" : "info", title: "Matrículas a renovar", detail: `${urgent.length} vencem nos próximos 10 dias e ainda não têm card de renovação.`, count: queue.length, resource: "alunos" });

    const [packs] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(enrollment)
      .where(
        and(
          eq(enrollment.tenantId, ctx.tenantId),
          isNull(enrollment.endedAt),
          sql`(select coalesce(sum(ce.amount), 0) from credit_entry ce where ce.enrollment_id = ${enrollment.id}) <= 0`,
        ),
      );
    push({ key: "pacotes-zerados", tone: "warn", title: "Pacotes sem saldo", detail: "O aluno segue matriculado, mas já usou todas as aulas.", count: packs?.n ?? 0, resource: "alunos" });
  }

  if (allowed("folha")) {
    const prev = lastMonths(ctx, 2)[0]!;
    const payroll = await computePayroll(ctx, prev);
    if (payroll.status !== "fechada" && payroll.lines.length > 0) {
      push({
        key: "folha-aberta",
        tone: payroll.status === "travada" ? "danger" : "warn",
        title: `Folha de ${prev} em aberto`,
        detail: payroll.status === "travada" ? `${payroll.totals.pendingLessons} aulas do mês ainda não foram finalizadas.` : "O mês já terminou e a folha ainda não foi fechada.",
        count: payroll.lines.length,
        resource: "folha",
      });
    }
  }

  if (allowed("empresas")) {
    const companies = (await listCompanies(ctx)).filter((c) => !c.deactivatedAt);
    const expiring = companies.filter((c) => c.status !== "encerrado" && c.daysLeft <= 30).length;
    const overLicenses = companies.filter((c) => c.licensesInUse > c.licenses).length;
    push({ key: "empresas-vencendo", tone: "warn", title: "Contratos de empresa vencendo", detail: "Vencem nos próximos 30 dias.", count: expiring, resource: "empresas" });
    push({ key: "empresas-licencas", tone: "danger", title: "Empresas acima das licenças", detail: "Há mais funcionários matriculados do que o contrato prevê.", count: overLicenses, resource: "empresas" });
  }

  return out;
}
