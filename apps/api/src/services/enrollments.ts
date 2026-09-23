import {
  and,
  asc,
  classGroup,
  company,
  course,
  courseModule,
  creditEntry,
  desc,
  enrollment,
  eq,
  gte,
  isNull,
  lesson,
  lessonStudent,
  person,
  sql,
  student,
  type CreditKind,
  type Modality,
  type ClassRegime,
} from "@classa/db";
import { addDays, collaboratorDiscountCents, dateInZone } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { invalid, notFound, unprocessable } from "../http/errors.ts";
import type { Db, ServiceContext, Tx } from "./context.ts";
import { getStudentRow } from "./people.ts";
import { cancelFutureInstallmentsTx, issueContractTx } from "./finance.ts";
import { getClassGroupRow } from "./schedule.ts";

const today = (ctx: ServiceContext) => dateInZone(ctx.now, ctx.timezone);

async function activeCount(db: Db, classGroupId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enrollment)
    .where(and(eq(enrollment.classGroupId, classGroupId), isNull(enrollment.endedAt)));
  return row?.n ?? 0;
}

/**
 * Inscreve a matrícula nas aulas agendadas da turma dentro do período dela.
 * Open-entry não tem turma e não passa por aqui: lá cada aula é uma reserva (DOMINIO.md §5.9).
 */
async function enrollInLessons(db: Db, ctx: ServiceContext, e: typeof enrollment.$inferSelect) {
  if (!e.classGroupId) return 0;
  const lessons = await db
    .select({ id: lesson.id, startsAt: lesson.startsAt })
    .from(lesson)
    .where(and(eq(lesson.classGroupId, e.classGroupId), eq(lesson.state, "agendada")));
  const rows = lessons
    .filter((l) => {
      const d = dateInZone(l.startsAt, ctx.timezone);
      return d >= e.startsOn && d <= e.endsOn && l.startsAt >= ctx.now;
    })
    .map((l) => ({ tenantId: ctx.tenantId, lessonId: l.id, enrollmentId: e.id, studentId: e.studentId }));
  if (rows.length) await db.insert(lessonStudent).values(rows).onConflictDoNothing();
  return rows.length;
}

/** Retira a matrícula das aulas que ainda não aconteceram. */
async function removeFromFutureLessons(db: Db, ctx: ServiceContext, enrollmentId: string) {
  await db.execute(sql`
    delete from lesson_student ls
    using lesson l
    where ls.lesson_id = l.id
      and ls.enrollment_id = ${enrollmentId}
      and ls.status in ('inscrito', 'cancelou')
      and l.state = 'agendada'
      and l.starts_at >= ${ctx.now.toISOString()}
  `);
}

export async function createEnrollment(
  ctx: ServiceContext,
  input: {
    studentId: string;
    /** Obrigatória fora do open-entry. */
    classGroupId?: string | null;
    /** Open-entry: o nível do aluno, já que não há turma. */
    regime?: ClassRegime;
    moduleId?: string | null;
    courseId?: string;
    packageLessons?: number;
    startsOn?: string;
    endsOn?: string;
    modality?: Modality;
    /** Emite o contrato com parcelas (padrão true). */
    contract?: false | { discountCents?: number; installments?: number; dueDay?: number };
    /** Paga antes do nivelamento: sem turma nem nível até `completeEnrollmentLevel`. */
    levelPending?: boolean;
  },
) {
  const s = await getStudentRow(ctx.db, ctx, input.studentId);
  if (["cancelado", "inativo"].includes(s.status)) throw unprocessable("Aluno cancelado ou inativo não pode ser matriculado. Reative o aluno antes.");

  const regime: ClassRegime = input.regime ?? "regular";
  const pending = !!input.levelPending;
  const cg = input.classGroupId && !pending ? await getClassGroupRow(ctx.db, ctx, input.classGroupId) : null;
  if (pending) {
    if (!input.courseId) throw invalid("courseId", "Escolha o curso");
  } else if (regime === "open_entry") {
    if (cg) throw invalid("classGroupId", "Matrícula open-entry não fica presa a uma turma.");
    if (!input.courseId) throw invalid("courseId", "Escolha o curso");
    if (!input.moduleId) throw invalid("moduleId", "Escolha o nível: é ele que limita o que o aluno pode reservar.");
  } else if (!cg) {
    throw invalid("classGroupId", "Escolha a turma");
  }
  if (cg?.deactivatedAt) throw unprocessable("A turma está inativa.");
  if (cg && input.regime && cg.regime !== regime) throw invalid("regime", `A turma "${cg.name}" é do regime ${cg.regime}.`);

  const courseId = cg?.courseId ?? input.courseId!;
  const [c] = await ctx.db.select().from(course).where(and(eq(course.id, courseId), eq(course.tenantId, ctx.tenantId)));
  if (!c || c.deactivatedAt) throw unprocessable("O curso está inativo.");

  const moduleId = pending ? null : cg ? cg.moduleId : input.moduleId!;
  if (regime === "open_entry" && !pending) {
    const [m] = await ctx.db.select().from(courseModule).where(and(eq(courseModule.id, moduleId!), eq(courseModule.courseId, c.id)));
    if (!m) throw invalid("moduleId", "Módulo não pertence ao curso");
    if (m.deactivatedAt) throw invalid("moduleId", "Módulo inativo");
  }

  const packageLessons = input.packageLessons ?? c.packageLessons;
  if (!Number.isInteger(packageLessons) || packageLessons < 1) throw invalid("packageLessons", "Pacote precisa ter ao menos 1 aula");
  const modality = input.modality ?? cg?.modality ?? c.modalities[0]!;
  if (!c.modalities.includes(modality)) throw invalid("modality", "Modalidade não aceita por este curso");
  // aluno de empresa: cursos liberados e quem paga
  let contractInput = input.contract;
  if (s.companyId) {
    const [co] = await ctx.db.select().from(company).where(eq(company.id, s.companyId));
    if (co) {
      if (co.allowedCourseIds && !co.allowedCourseIds.includes(c.id)) {
        throw unprocessable(`O curso não está liberado no contrato da empresa ${co.name}.`);
      }
      if (co.model === "b2b") contractInput = false;
      else if (contractInput !== false && contractInput?.discountCents === undefined) {
        contractInput = { ...contractInput, discountCents: collaboratorDiscountCents(packageLessons * c.lessonPriceCents, co.subsidyPercent, co.discountPercent) };
      }
    }
  }
  const startsOn = input.startsOn ?? today(ctx);
  const limit = addDays(startsOn, 365);
  const endsOn = input.endsOn ?? (cg && limit > cg.endsOn ? cg.endsOn : limit);
  if (endsOn < startsOn) throw invalid("endsOn", "O fim do contrato precisa ser depois do início");

  return ctx.db.transaction(async (tx) => {
    if (cg) {
      // trava a turma para a contagem de vagas não correr em paralelo
      await tx.execute(sql`select id from class_group where id = ${cg.id} for update`);
      if ((await activeCount(tx, cg.id)) >= cg.capacity) throw unprocessable(`A turma "${cg.name}" está cheia (${cg.capacity} vagas).`);
    }
    const [e] = await tx
      .insert(enrollment)
      .values({ tenantId: ctx.tenantId, studentId: s.id, courseId: c.id, regime, classGroupId: cg?.id ?? null, moduleId, modality, packageLessons, startsOn, endsOn, levelPending: pending })
      .returning();
    await tx.insert(creditEntry).values({ tenantId: ctx.tenantId, enrollmentId: e!.id, kind: "contratacao", amount: packageLessons, actorId: ctx.actorId });
    const lessons = await enrollInLessons(tx, ctx, e!);
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "enrollment", entityId: e!.id, action: "create", after: { ...e, lessons } });
    if (contractInput !== false) await issueContractTx(tx, ctx, e!.id, contractInput ?? {});
    return e!;
  });
}

/**
 * Completa a matrícula que foi paga antes do nivelamento (DOMINIO.md §7.5.1):
 * ganha o regime e a turma (regular) ou o nível (open-entry), e entra nas aulas.
 * As mesmas travas da matrícula nova valem aqui: curso, regime da turma e vagas.
 */
export async function completeEnrollmentLevel(
  ctx: ServiceContext,
  id: string,
  input: { regime: ClassRegime; classGroupId?: string | null; moduleId?: string | null },
) {
  const e = await getEnrollmentRow(ctx.db, ctx, id);
  if (!e.levelPending) throw unprocessable("Esta matrícula já tem turma ou nível.");
  if (e.endedAt) throw unprocessable("A matrícula está encerrada.");
  let classGroupId: string | null = null;
  let moduleId: string | null = null;
  let cg: Awaited<ReturnType<typeof getClassGroupRow>> | null = null;
  if (input.regime === "open_entry") {
    if (!input.moduleId) throw invalid("moduleId", "Escolha o nível: é ele que limita o que o aluno pode reservar.");
    const [m] = await ctx.db.select().from(courseModule).where(and(eq(courseModule.id, input.moduleId), eq(courseModule.courseId, e.courseId)));
    if (!m || m.deactivatedAt) throw invalid("moduleId", "O nível precisa ser um módulo ativo do curso da matrícula");
    moduleId = m.id;
  } else {
    if (!input.classGroupId) throw invalid("classGroupId", "Escolha a turma");
    cg = await getClassGroupRow(ctx.db, ctx, input.classGroupId);
    if (cg.deactivatedAt) throw unprocessable("A turma está inativa.");
    if (cg.courseId !== e.courseId) throw invalid("classGroupId", "A turma precisa ser do curso da matrícula");
    if (cg.regime !== input.regime) throw invalid("regime", `A turma "${cg.name}" é do regime ${cg.regime}.`);
    classGroupId = cg.id;
    moduleId = cg.moduleId;
  }
  return ctx.db.transaction(async (tx) => {
    if (cg) {
      await tx.execute(sql`select id from class_group where id = ${cg.id} for update`);
      if ((await activeCount(tx, cg.id)) >= cg.capacity) throw unprocessable(`A turma "${cg.name}" está cheia (${cg.capacity} vagas).`);
    }
    const endsOn = cg && cg.endsOn < e.endsOn ? cg.endsOn : e.endsOn;
    const [row] = await tx
      .update(enrollment)
      .set({ regime: input.regime, classGroupId, moduleId, endsOn, levelPending: false, ...(cg ? { modality: cg.modality } : {}) })
      .where(eq(enrollment.id, id))
      .returning();
    const lessons = await enrollInLessons(tx, ctx, row!);
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "enrollment", entityId: id, action: "update", before: e, after: { ...row, lessons } });
    return row!;
  });
}

export async function getEnrollmentRow(db: Db, ctx: ServiceContext, id: string) {
  const [row] = await db
    .select()
    .from(enrollment)
    .where(and(eq(enrollment.id, id), eq(enrollment.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Matrícula");
  return row;
}

export async function endEnrollmentTx(tx: Tx, ctx: ServiceContext, id: string) {
  const before = await getEnrollmentRow(tx, ctx, id);
  if (before.endedAt) return before;
  const [row] = await tx.update(enrollment).set({ endedAt: ctx.now }).where(eq(enrollment.id, id)).returning();
  await removeFromFutureLessons(tx, ctx, id);
  await cancelFutureInstallmentsTx(tx, ctx, id);
  await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "enrollment", entityId: id, action: "deactivate", before, after: row });
  return row!;
}

export async function endEnrollment(ctx: ServiceContext, id: string) {
  return ctx.db.transaction((tx) => endEnrollmentTx(tx, ctx, id));
}

export async function reactivateEnrollment(ctx: ServiceContext, id: string) {
  const before = await getEnrollmentRow(ctx.db, ctx, id);
  if (!before.endedAt) throw unprocessable("A matrícula já está ativa.");
  const s = await getStudentRow(ctx.db, ctx, before.studentId);
  if (["cancelado", "inativo"].includes(s.status)) throw unprocessable("Reative o aluno antes da matrícula.");
  const cg = before.classGroupId ? await getClassGroupRow(ctx.db, ctx, before.classGroupId) : null;
  return ctx.db.transaction(async (tx) => {
    if (cg) {
      await tx.execute(sql`select id from class_group where id = ${cg.id} for update`);
      if ((await activeCount(tx, cg.id)) >= cg.capacity) throw unprocessable(`A turma "${cg.name}" está cheia.`);
    }
    const [row] = await tx.update(enrollment).set({ endedAt: null }).where(eq(enrollment.id, id)).returning();
    await enrollInLessons(tx, ctx, row!);
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "enrollment", entityId: id, action: "reactivate", before, after: row });
    return row!;
  });
}

/** Troca de turma dentro do mesmo curso (mudança de nível, troca de horário). */
export async function transferEnrollment(ctx: ServiceContext, id: string, classGroupId: string) {
  const before = await getEnrollmentRow(ctx.db, ctx, id);
  if (before.endedAt) throw unprocessable("A matrícula está encerrada.");
  if (before.regime === "open_entry") throw unprocessable("Matrícula open-entry não fica presa a turma: mude o nível dela.");
  if (before.levelPending) throw unprocessable("A matrícula aguarda o nivelamento: a turma é definida no fluxo Entrada do aluno.");
  if (before.classGroupId === classGroupId) throw invalid("classGroupId", "Escolha outra turma");
  const target = await getClassGroupRow(ctx.db, ctx, classGroupId);
  if (target.courseId !== before.courseId) throw invalid("classGroupId", "A turma precisa ser do mesmo curso. Para trocar de curso, encerre e abra outra matrícula.");
  if (target.deactivatedAt) throw unprocessable("A turma está inativa.");
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select id from class_group where id = ${target.id} for update`);
    if ((await activeCount(tx, target.id)) >= target.capacity) throw unprocessable(`A turma "${target.name}" está cheia.`);
    await removeFromFutureLessons(tx, ctx, id);
    // o nível acompanha a turma: é ele que vale nos dois regimes
    const [row] = await tx.update(enrollment).set({ classGroupId: target.id, moduleId: target.moduleId }).where(eq(enrollment.id, id)).returning();
    await enrollInLessons(tx, ctx, row!);
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "enrollment", entityId: id, action: "update", before, after: row });
    return row!;
  });
}

/* ---------------------------------------------------------- extrato de créditos */

export async function balanceOf(db: Db, enrollmentId: string) {
  const [row] = await db
    .select({ balance: sql<number>`coalesce(sum(${creditEntry.amount}), 0)::int` })
    .from(creditEntry)
    .where(eq(creditEntry.enrollmentId, enrollmentId));
  return row?.balance ?? 0;
}

export async function ledger(ctx: ServiceContext, enrollmentId: string) {
  await getEnrollmentRow(ctx.db, ctx, enrollmentId);
  return ctx.db
    .select({ entry: creditEntry, lessonStartsAt: lesson.startsAt })
    .from(creditEntry)
    .leftJoin(lesson, eq(lesson.id, creditEntry.lessonId))
    .where(eq(creditEntry.enrollmentId, enrollmentId))
    .orderBy(desc(creditEntry.createdAt));
}

export async function addCreditEntry(
  ctx: ServiceContext,
  enrollmentId: string,
  input: { kind: Extract<CreditKind, "ajuste" | "promocional" | "renovacao">; amount: number; justification?: string },
) {
  const e = await getEnrollmentRow(ctx.db, ctx, enrollmentId);
  if (!Number.isInteger(input.amount) || input.amount === 0) throw invalid("amount", "Quantidade inteira diferente de zero");
  const justification = input.justification?.trim() ?? "";
  if (input.kind === "ajuste" && justification.length < 5) throw invalid("justification", "Ajuste de créditos exige justificativa");
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(creditEntry)
      .values({ tenantId: ctx.tenantId, enrollmentId: e.id, kind: input.kind, amount: input.amount, justification: justification || null, actorId: ctx.actorId })
      .returning();
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "credit_entry", entityId: row!.id, action: "create", after: row });
    return row!;
  });
}

/** Matrículas com aluno, curso, turma e saldo/uso do pacote. */
export async function listEnrollments(ctx: ServiceContext, filters: { studentId?: string; classGroupId?: string; activeOnly?: boolean } = {}) {
  const rows = await ctx.db
    .select({
      enrollment,
      studentName: person.name,
      studentStatus: student.status,
      courseName: course.name,
      courseColor: course.color,
      className: classGroup.name,
      moduleName: courseModule.name,
      balance: sql<number>`(select coalesce(sum(ce.amount), 0)::int from credit_entry ce where ce.enrollment_id = ${enrollment.id})`,
      used: sql<number>`(select coalesce(-sum(ce.amount), 0)::int from credit_entry ce where ce.enrollment_id = ${enrollment.id} and ce.amount < 0)`,
      granted: sql<number>`(select coalesce(sum(ce.amount), 0)::int from credit_entry ce where ce.enrollment_id = ${enrollment.id} and ce.amount > 0)`,
    })
    .from(enrollment)
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .innerJoin(person, eq(person.id, student.personId))
    .innerJoin(course, eq(course.id, enrollment.courseId))
    // left: matrícula open-entry não tem turma e sumiria de todas as telas
    .leftJoin(classGroup, eq(classGroup.id, enrollment.classGroupId))
    .leftJoin(courseModule, eq(courseModule.id, enrollment.moduleId))
    .where(
      and(
        eq(enrollment.tenantId, ctx.tenantId),
        filters.studentId ? eq(enrollment.studentId, filters.studentId) : undefined,
        filters.classGroupId ? eq(enrollment.classGroupId, filters.classGroupId) : undefined,
        filters.activeOnly ? isNull(enrollment.endedAt) : undefined,
      ),
    )
    .orderBy(asc(person.name), desc(enrollment.startsOn));
  return rows.map((r) => ({
    ...r.enrollment,
    studentName: r.studentName,
    studentStatus: r.studentStatus,
    courseName: r.courseName,
    courseColor: r.courseColor,
    className: r.className,
    moduleName: r.moduleName,
    balance: r.balance,
    used: r.used,
    granted: r.granted,
    usage: r.granted > 0 ? r.used / r.granted : 0,
  }));
}

/** Próximas aulas inscritas de um aluno. */
export async function upcomingForStudent(ctx: ServiceContext, studentId: string, limit = 10) {
  return ctx.db
    .select({ lessonId: lesson.id, startsAt: lesson.startsAt, state: lesson.state, status: lessonStudent.status, className: classGroup.name })
    .from(lessonStudent)
    .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
    .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
    .where(and(eq(lessonStudent.studentId, studentId), gte(lesson.startsAt, ctx.now)))
    .orderBy(asc(lesson.startsAt))
    .limit(limit);
}
