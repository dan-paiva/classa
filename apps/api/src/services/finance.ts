import {
  and,
  asc,
  contract,
  course,
  enrollment,
  eq,
  gte,
  inArray,
  installment,
  isNull,
  lesson,
  lessonStudent,
  lt,
  payment,
  person,
  sql,
  student,
  type PaymentMethod,
} from "@classa/db";
import { buildInstallments, dateInZone, daysLate, installmentStatus, type InstallmentStatus } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { invalid, notFound, unprocessable } from "../http/errors.ts";
import type { Db, ServiceContext, Tx } from "./context.ts";

const today = (ctx: ServiceContext) => dateInZone(ctx.now, ctx.timezone);

/** Emite o contrato da matrícula com as parcelas. Usa o valor da aula do curso de hoje. */
export async function issueContractTx(
  tx: Tx,
  ctx: ServiceContext,
  enrollmentId: string,
  input: { kind?: "matricula" | "renovacao"; lessons?: number; discountCents?: number; installments?: number; dueDay?: number; startsOn?: string } = {},
) {
  const [e] = await tx.select().from(enrollment).where(and(eq(enrollment.id, enrollmentId), eq(enrollment.tenantId, ctx.tenantId)));
  if (!e) throw notFound("Matrícula");
  const [c] = await tx.select().from(course).where(eq(course.id, e.courseId));
  const lessons = input.lessons ?? e.packageLessons;
  const count = input.installments ?? ctx.settings.policies.installments;
  const dueDay = input.dueDay ?? ctx.settings.policies.dueDay;
  const discountCents = input.discountCents ?? 0;
  if (count < 1 || count > 24) throw invalid("installments", "De 1 a 24 parcelas");
  if (dueDay < 1 || dueDay > 28) throw invalid("dueDay", "Dia de vencimento de 1 a 28");
  const gross = lessons * c!.lessonPriceCents;
  if (discountCents < 0 || discountCents > gross) throw invalid("discountCents", "Desconto maior que o valor do contrato");
  const totalCents = gross - discountCents;
  const issuedOn = input.startsOn ?? e.startsOn;

  const [row] = await tx
    .insert(contract)
    .values({
      tenantId: ctx.tenantId,
      enrollmentId: e.id,
      kind: input.kind ?? "matricula",
      lessons,
      lessonPriceCents: c!.lessonPriceCents,
      discountCents,
      totalCents,
      installmentsCount: count,
      dueDay,
      issuedOn,
    })
    .returning();
  const parts = buildInstallments(totalCents, count, dueDay, issuedOn);
  await tx.insert(installment).values(parts.map((p) => ({ ...p, tenantId: ctx.tenantId, contractId: row!.id })));
  await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "contract", entityId: row!.id, action: "create", after: { ...row, installments: parts } });
  return row!;
}

/** D10: ao encerrar a matrícula, parcelas em aberto que vencem depois de hoje são canceladas. */
export async function cancelFutureInstallmentsTx(tx: Tx, ctx: ServiceContext, enrollmentId: string) {
  const rows = await tx.execute(sql`
    update installment i set cancelled_at = ${ctx.now.toISOString()}
    from contract k
    where i.contract_id = k.id
      and k.enrollment_id = ${enrollmentId}
      and i.cancelled_at is null
      and i.due_date > ${today(ctx)}
      and coalesce((select sum(p.amount_cents) from payment p where p.installment_id = i.id), 0) = 0
    returning i.id
  `);
  return rows;
}

const paidSql = sql<number>`coalesce((select sum(p.amount_cents) from payment p where p.installment_id = ${installment.id}), 0)::int`;

async function installmentWithPaid(db: Db, ctx: ServiceContext, id: string) {
  const [row] = await db
    .select({ installment, paidCents: paidSql, enrollmentId: contract.enrollmentId })
    .from(installment)
    .innerJoin(contract, eq(contract.id, installment.contractId))
    .where(and(eq(installment.id, id), eq(installment.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Parcela");
  return row;
}

export async function registerPayment(ctx: ServiceContext, installmentId: string, input: { amountCents?: number; method: PaymentMethod; paidOn?: string }) {
  const { installment: i, paidCents, enrollmentId } = await installmentWithPaid(ctx.db, ctx, installmentId);
  if (i.cancelledAt) throw unprocessable("A parcela está cancelada.");
  const remaining = i.amountCents - paidCents;
  if (remaining <= 0) throw unprocessable("A parcela já está paga.");
  const amountCents = input.amountCents ?? remaining;
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw invalid("amountCents", "Valor precisa ser maior que zero");
  if (amountCents > remaining) throw invalid("amountCents", "Valor maior que o que falta pagar na parcela");
  const paidOn = input.paidOn ?? today(ctx);
  if (paidOn > today(ctx)) throw invalid("paidOn", "Data de pagamento no futuro");

  const row = await ctx.db.transaction(async (tx) => {
    const [p] = await tx
      .insert(payment)
      .values({ tenantId: ctx.tenantId, installmentId: i.id, amountCents, method: input.method, paidOn, actorId: ctx.actorId })
      .returning();
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "payment", entityId: p!.id, action: "create", after: p });
    return p!;
  });
  await refreshDelinquencyForEnrollment(ctx, enrollmentId);
  return row;
}

export async function reversePayment(ctx: ServiceContext, paymentId: string, justification: string) {
  const [p] = await ctx.db.select().from(payment).where(and(eq(payment.id, paymentId), eq(payment.tenantId, ctx.tenantId)));
  if (!p) throw notFound("Pagamento");
  if (p.amountCents < 0 || p.reversalOfId) throw unprocessable("Este registro já é um estorno.");
  if (justification.trim().length < 5) throw invalid("justification", "Estorno exige justificativa");
  const [already] = await ctx.db.select({ id: payment.id }).from(payment).where(eq(payment.reversalOfId, p.id));
  if (already) throw unprocessable("Este pagamento já foi estornado.");
  const { enrollmentId } = await installmentWithPaid(ctx.db, ctx, p.installmentId);
  const row = await ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .insert(payment)
      .values({
        tenantId: ctx.tenantId,
        installmentId: p.installmentId,
        amountCents: -p.amountCents,
        method: p.method,
        paidOn: today(ctx),
        reversalOfId: p.id,
        justification: justification.trim(),
        actorId: ctx.actorId,
      })
      .returning();
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "payment", entityId: p.id, action: "cancel", before: p, after: r });
    return r!;
  });
  await refreshDelinquencyForEnrollment(ctx, enrollmentId);
  return row;
}

/* ------------------------------------------------------------- inadimplência */

async function overdueByStudent(db: Db, ctx: ServiceContext, studentIds?: string[]) {
  const limit = ctx.settings.policies.delinquencyDays;
  const cutoff = new Date(`${today(ctx)}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - limit);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  return db
    .select({ studentId: enrollment.studentId, n: sql<number>`count(*)::int` })
    .from(installment)
    .innerJoin(contract, eq(contract.id, installment.contractId))
    .innerJoin(enrollment, eq(enrollment.id, contract.enrollmentId))
    .where(
      and(
        eq(installment.tenantId, ctx.tenantId),
        isNull(installment.cancelledAt),
        lt(installment.dueDate, cutoffDate),
        sql`${installment.amountCents} > ${paidSql}`,
        studentIds ? inArray(enrollment.studentId, studentIds) : undefined,
      ),
    )
    .groupBy(enrollment.studentId);
}

/**
 * D8: aluno ativo com parcela vencida há mais de N dias vira inadimplente;
 * inadimplente sem parcela nessa situação volta a ativo.
 */
export async function refreshDelinquency(ctx: ServiceContext, studentIds?: string[]) {
  const overdue = new Set((await overdueByStudent(ctx.db, ctx, studentIds)).map((o) => o.studentId));
  const candidates = await ctx.db
    .select({ id: student.id, status: student.status })
    .from(student)
    .where(and(eq(student.tenantId, ctx.tenantId), inArray(student.status, ["ativo", "inadimplente"]), studentIds ? inArray(student.id, studentIds) : undefined));
  let changed = 0;
  for (const s of candidates) {
    const next = overdue.has(s.id) ? "inadimplente" : "ativo";
    if (next === s.status) continue;
    const [row] = await ctx.db.update(student).set({ status: next }).where(eq(student.id, s.id)).returning();
    await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "student", entityId: s.id, action: "update", before: s, after: { ...row, motivo: "inadimplência automática" } });
    changed++;
  }
  return changed;
}

async function refreshDelinquencyForEnrollment(ctx: ServiceContext, enrollmentId: string) {
  const [e] = await ctx.db.select({ studentId: enrollment.studentId }).from(enrollment).where(eq(enrollment.id, enrollmentId));
  if (e) await refreshDelinquency(ctx, [e.studentId]);
}

/* ----------------------------------------------------------------- consultas */

export async function listInstallments(
  ctx: ServiceContext,
  filters: { status?: InstallmentStatus; studentId?: string; from?: string; to?: string; enrollmentId?: string } = {},
) {
  const rows = await ctx.db
    .select({
      installment,
      paidCents: paidSql,
      contractId: contract.id,
      installmentsCount: contract.installmentsCount,
      enrollmentId: enrollment.id,
      studentId: student.id,
      studentName: person.name,
      studentStatus: student.status,
      courseName: course.name,
      lastPaidOn: sql<string | null>`(select max(p.paid_on)::text from payment p where p.installment_id = ${installment.id} and p.amount_cents > 0)`,
    })
    .from(installment)
    .innerJoin(contract, eq(contract.id, installment.contractId))
    .innerJoin(enrollment, eq(enrollment.id, contract.enrollmentId))
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .innerJoin(person, eq(person.id, student.personId))
    .innerJoin(course, eq(course.id, enrollment.courseId))
    .where(
      and(
        eq(installment.tenantId, ctx.tenantId),
        filters.studentId ? eq(student.id, filters.studentId) : undefined,
        filters.enrollmentId ? eq(enrollment.id, filters.enrollmentId) : undefined,
        filters.from ? gte(installment.dueDate, filters.from) : undefined,
        filters.to ? lt(installment.dueDate, filters.to) : undefined,
      ),
    )
    .orderBy(asc(installment.dueDate), asc(person.name));
  const t = today(ctx);
  return rows
    .map((r) => {
      const status = installmentStatus({ ...r.installment, paidCents: r.paidCents }, t);
      return {
        ...r.installment,
        paidCents: r.paidCents,
        status,
        daysLate: status === "vencida" ? daysLate(r.installment.dueDate, t) : 0,
        installmentsCount: r.installmentsCount,
        enrollmentId: r.enrollmentId,
        studentId: r.studentId,
        studentName: r.studentName,
        studentStatus: r.studentStatus,
        courseName: r.courseName,
        lastPaidOn: r.lastPaidOn,
      };
    })
    .filter((r) => !filters.status || r.status === filters.status);
}

export async function listPayments(ctx: ServiceContext, installmentId: string) {
  await installmentWithPaid(ctx.db, ctx, installmentId);
  return ctx.db.select().from(payment).where(eq(payment.installmentId, installmentId)).orderBy(asc(payment.createdAt));
}

/**
 * Painel do mês ("AAAA-MM"):
 * - receita reconhecida = aulas concluídas × alunos que não cancelaram × valor da aula;
 * - recebido = pagamentos com data no mês (estornos descontam);
 * - vencido em aberto = parcelas vencidas até hoje, em qualquer mês;
 * - carteira = saldo de créditos das matrículas ativas × valor da aula.
 */
export async function financeSummary(ctx: ServiceContext, month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${m === 12 ? y! + 1 : y}-${String(m === 12 ? 1 : m! + 1).padStart(2, "0")}-01`;
  const tz = ctx.timezone;

  const [recognized] = await ctx.db
    .select({
      cents: sql<number>`coalesce(sum(${course.lessonPriceCents}), 0)::bigint`,
      lessons: sql<number>`count(distinct ${lesson.id})::int`,
    })
    .from(lessonStudent)
    .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(
      and(
        eq(lesson.tenantId, ctx.tenantId),
        eq(lesson.state, "concluida"),
        inArray(lessonStudent.status, ["presente", "falta"]),
        sql`(${lesson.startsAt} at time zone ${tz})::date >= ${from}::date`,
        sql`(${lesson.startsAt} at time zone ${tz})::date < ${to}::date`,
      ),
    );

  const [received] = await ctx.db
    .select({ cents: sql<number>`coalesce(sum(${payment.amountCents}), 0)::bigint` })
    .from(payment)
    .where(and(eq(payment.tenantId, ctx.tenantId), gte(payment.paidOn, from), lt(payment.paidOn, to)));

  const all = await listInstallments(ctx);
  const overdue = all.filter((i) => i.status === "vencida");
  const dueThisMonth = all.filter((i) => i.dueDate >= from && i.dueDate < to && i.status !== "cancelada");

  const [portfolio] = await ctx.db
    .select({ cents: sql<number>`coalesce(sum(greatest(b.balance, 0) * b.price), 0)::bigint` })
    .from(
      sql`(select e.id, c.lesson_price_cents as price, coalesce((select sum(ce.amount) from credit_entry ce where ce.enrollment_id = e.id), 0) as balance
           from enrollment e join course c on c.id = e.course_id
           where e.tenant_id = ${ctx.tenantId} and e.ended_at is null) b`,
    );

  const { computePayroll } = await import("./payroll.ts");
  const payroll = await computePayroll(ctx, month);

  return {
    month,
    payrollCostCents: payroll.totals.netCents,
    payrollStatus: payroll.status,
    marginCents: Number(recognized?.cents ?? 0) - payroll.totals.netCents,
    recognizedCents: Number(recognized?.cents ?? 0),
    concludedLessons: recognized?.lessons ?? 0,
    receivedCents: Number(received?.cents ?? 0),
    dueThisMonthCents: dueThisMonth.reduce((s, i) => s + i.amountCents, 0),
    dueThisMonthOpenCents: dueThisMonth.reduce((s, i) => s + Math.max(0, i.amountCents - i.paidCents), 0),
    overdueCents: overdue.reduce((s, i) => s + (i.amountCents - i.paidCents), 0),
    overdueCount: overdue.length,
    overdueStudents: new Set(overdue.map((i) => i.studentId)).size,
    portfolioCents: Number(portfolio?.cents ?? 0),
  };
}

