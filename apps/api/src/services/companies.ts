import {
  and,
  asc,
  company,
  companyCharge,
  course,
  desc,
  eq,
  inArray,
  isNull,
  person,
  sql,
  student,
  type CompanyModel,
  type PaymentMethod,
} from "@classa/db";
import { addDays, companyAlerts, companyContractStatus, companyMonthlyCharge, dateInZone, isValidCnpj, onlyDigits } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { conflict, invalid, notFound, unprocessable } from "../http/errors.ts";
import { isUniqueViolation, pgConstraint } from "../http/pg-errors.ts";
import type { Db, ServiceContext } from "./context.ts";

const today = (ctx: ServiceContext) => dateInZone(ctx.now, ctx.timezone);

export type CompanyInput = {
  name: string;
  cnpj?: string | null;
  segment?: string | null;
  model: CompanyModel;
  managerUserId?: string | null;
  hrName?: string | null;
  hrEmail?: string | null;
  startsOn: string;
  endsOn: string;
  licenses: number;
  contractedLessons?: number;
  licensePriceCents: number;
  subsidyPercent?: number;
  discountPercent?: number;
  autoRenew?: boolean;
  allowedCourseIds?: string[] | null;
};

async function normalize(db: Db, ctx: ServiceContext, input: CompanyInput) {
  const name = input.name.trim();
  if (name.length < 2) throw invalid("name", "Nome precisa de pelo menos 2 caracteres");
  const cnpj = input.cnpj ? onlyDigits(input.cnpj) : null;
  if (cnpj && !isValidCnpj(cnpj)) throw invalid("cnpj", "CNPJ inválido");
  const hrEmail = input.hrEmail?.trim().toLowerCase() || null;
  if (hrEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(hrEmail)) throw invalid("hrEmail", "E-mail do RH inválido");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn)) throw invalid("startsOn", "Informe início e fim da vigência");
  if (input.endsOn <= input.startsOn) throw invalid("endsOn", "O fim da vigência precisa ser depois do início");
  if (!Number.isInteger(input.licenses) || input.licenses < 1) throw invalid("licenses", "Pelo menos 1 licença");
  if (!Number.isInteger(input.licensePriceCents) || input.licensePriceCents < 0) throw invalid("licensePriceCents", "Valor por licença inválido");
  const b2b = input.model === "b2b";
  const subsidyPercent = b2b ? 100 : (input.subsidyPercent ?? 50);
  const discountPercent = b2b ? 0 : (input.discountPercent ?? 0);
  if (subsidyPercent < 0 || subsidyPercent > 100) throw invalid("subsidyPercent", "Subsídio de 0 a 100%");
  if (discountPercent < 0 || discountPercent > 100) throw invalid("discountPercent", "Desconto de 0 a 100%");
  let allowedCourseIds = input.allowedCourseIds ?? null;
  if (allowedCourseIds) {
    allowedCourseIds = [...new Set(allowedCourseIds)];
    const found = allowedCourseIds.length
      ? await db.select({ id: course.id }).from(course).where(and(eq(course.tenantId, ctx.tenantId), inArray(course.id, allowedCourseIds)))
      : [];
    if (found.length !== allowedCourseIds.length) throw invalid("allowedCourseIds", "Curso não encontrado");
  }
  return {
    name,
    cnpj,
    segment: input.segment?.trim() || null,
    model: input.model,
    managerUserId: input.managerUserId ?? null,
    hrName: input.hrName?.trim() || null,
    hrEmail,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    licenses: input.licenses,
    contractedLessons: input.contractedLessons ?? 0,
    licensePriceCents: input.licensePriceCents,
    subsidyPercent,
    discountPercent,
    autoRenew: input.autoRenew ?? true,
    allowedCourseIds,
  };
}

function uniqueError(err: unknown): never {
  if (isUniqueViolation(err)) {
    if (pgConstraint(err) === "company_tenant_cnpj_uq") throw conflict("cnpj", "Já existe uma empresa com este CNPJ");
    throw conflict("name", "Já existe uma empresa com esse nome");
  }
  throw err;
}

export async function createCompany(ctx: ServiceContext, input: CompanyInput) {
  const values = await normalize(ctx.db, ctx, input);
  try {
    return await ctx.db.transaction(async (tx) => {
      const [row] = await tx.insert(company).values({ ...values, tenantId: ctx.tenantId }).returning();
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "company", entityId: row!.id, action: "create", after: row });
      return row!;
    });
  } catch (err) {
    uniqueError(err);
  }
}

export async function getCompanyRow(db: Db, ctx: ServiceContext, id: string) {
  const [row] = await db.select().from(company).where(and(eq(company.id, id), eq(company.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Empresa");
  return row;
}

export async function updateCompany(ctx: ServiceContext, id: string, input: CompanyInput) {
  const before = await getCompanyRow(ctx.db, ctx, id);
  const values = await normalize(ctx.db, ctx, input);
  try {
    return await ctx.db.transaction(async (tx) => {
      const [row] = await tx.update(company).set(values).where(eq(company.id, id)).returning();
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "company", entityId: id, action: "update", before, after: row });
      return row!;
    });
  } catch (err) {
    uniqueError(err);
  }
}

/** Renovação manual: novo fim de vigência, licenças, aulas a somar e valor por licença. */
export async function renewCompany(ctx: ServiceContext, id: string, input: { endsOn: string; licenses?: number; addLessons?: number; licensePriceCents?: number }) {
  const before = await getCompanyRow(ctx.db, ctx, id);
  if (input.endsOn <= before.endsOn) throw invalid("endsOn", "O novo fim precisa ser depois do fim atual");
  if (input.licenses !== undefined && input.licenses < 1) throw invalid("licenses", "Pelo menos 1 licença");
  const patch = {
    endsOn: input.endsOn,
    ...(input.licenses !== undefined ? { licenses: input.licenses } : {}),
    ...(input.licensePriceCents !== undefined ? { licensePriceCents: input.licensePriceCents } : {}),
    contractedLessons: before.contractedLessons + Math.max(0, input.addLessons ?? 0),
    deactivatedAt: null,
  };
  const [row] = await ctx.db.update(company).set(patch).where(eq(company.id, id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "company", entityId: id, action: "update", before, after: { ...row, renovacao: true } });
  return row!;
}

/** Job: contrato com renovação automática que venceu ganha mais 12 meses. */
export async function autoRenewCompanies(ctx: ServiceContext) {
  const due = await ctx.db
    .select()
    .from(company)
    .where(and(eq(company.tenantId, ctx.tenantId), eq(company.autoRenew, true), isNull(company.deactivatedAt), sql`${company.endsOn} < ${today(ctx)}`));
  for (const c of due) {
    let endsOn = c.endsOn;
    while (endsOn < today(ctx)) endsOn = addDays(endsOn, 365);
    const [row] = await ctx.db.update(company).set({ endsOn }).where(eq(company.id, c.id)).returning();
    await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "company", entityId: c.id, action: "update", before: c, after: { ...row, renovacao: "automática" } });
  }
  return due.length;
}

/* ----------------------------------------------------------- alunos da empresa */

export async function linkStudent(ctx: ServiceContext, companyId: string, studentId: string) {
  const c = await getCompanyRow(ctx.db, ctx, companyId);
  const [s] = await ctx.db.select().from(student).where(and(eq(student.id, studentId), eq(student.tenantId, ctx.tenantId)));
  if (!s) throw notFound("Aluno");
  if (s.companyId === c.id) throw unprocessable("O aluno já está vinculado a esta empresa.");
  if (s.companyId) throw unprocessable("O aluno está vinculado a outra empresa. Desvincule antes.");
  if (s.status === "inativo" || s.status === "cancelado") throw unprocessable("Aluno inativo ou cancelado não pode ser vinculado.");
  const [row] = await ctx.db.update(student).set({ companyId: c.id }).where(eq(student.id, s.id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "student", entityId: s.id, action: "update", before: s, after: { ...row, empresa: c.name } });
  const metrics = await companyMetrics(ctx, [c]);
  const inUse = metrics.get(c.id)!.licensesInUse;
  return { student: row!, warning: inUse > c.licenses ? `A conta passou do limite de ${c.licenses} licenças.` : null };
}

export async function unlinkStudent(ctx: ServiceContext, companyId: string, studentId: string) {
  const [s] = await ctx.db.select().from(student).where(and(eq(student.id, studentId), eq(student.companyId, companyId), eq(student.tenantId, ctx.tenantId)));
  if (!s) throw notFound("Aluno vinculado");
  const [row] = await ctx.db.update(student).set({ companyId: null }).where(eq(student.id, s.id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "student", entityId: s.id, action: "update", before: s, after: { ...row, desvinculado: companyId } });
  return row!;
}

/* ------------------------------------------------------------------- números */

type CompanyRow = typeof company.$inferSelect;

async function companyMetrics(ctx: ServiceContext, companies: CompanyRow[]) {
  const ids = companies.map((c) => c.id);
  const result = new Map<string, { linked: number; licensesInUse: number; consumed: number; attendancePercent: number | null; delinquent: number }>();
  if (ids.length === 0) return result;
  const since30 = new Date(ctx.now.getTime() - 30 * 86400_000).toISOString();

  const counts = await ctx.db
    .select({
      companyId: student.companyId,
      linked: sql<number>`count(*)::int`,
      // coluna qualificada à mão: sem join o Drizzle escreve só "id", que dentro do exists viraria e.id
      active: sql<number>`count(*) filter (where "student"."status" = 'ativo' and exists (select 1 from enrollment e where e.student_id = "student"."id" and e.ended_at is null))::int`,
      delinquent: sql<number>`count(*) filter (where ${student.status} = 'inadimplente')::int`,
    })
    .from(student)
    .where(inArray(student.companyId, ids))
    .groupBy(student.companyId);

  const consumption = await ctx.db
    .select({ companyId: company.id, used: sql<number>`coalesce(-sum(ce.amount), 0)::int` })
    .from(company)
    .innerJoin(sql`student s`, sql`s.company_id = ${company.id}`)
    .innerJoin(sql`enrollment e`, sql`e.student_id = s.id`)
    .innerJoin(sql`credit_entry ce`, sql`ce.enrollment_id = e.id and ce.amount < 0 and ce.kind in ('presenca', 'falta', 'cancelamento_tardio') and (ce.created_at at time zone ${ctx.timezone})::date between ${company.startsOn} and ${company.endsOn}`)
    .where(inArray(company.id, ids))
    .groupBy(company.id);

  const attendance = await ctx.db
    .select({
      companyId: student.companyId,
      present: sql<number>`count(*) filter (where ls.status = 'presente')::int`,
      absent: sql<number>`count(*) filter (where ls.status = 'falta')::int`,
    })
    .from(student)
    .innerJoin(sql`lesson_student ls`, sql`ls.student_id = ${student.id}`)
    .innerJoin(sql`lesson l`, sql`l.id = ls.lesson_id and l.starts_at >= ${since30} and l.starts_at <= ${ctx.now.toISOString()}`)
    .where(inArray(student.companyId, ids))
    .groupBy(student.companyId);

  for (const c of companies) {
    const n = counts.find((x) => x.companyId === c.id);
    const a = attendance.find((x) => x.companyId === c.id);
    const total = (a?.present ?? 0) + (a?.absent ?? 0);
    result.set(c.id, {
      linked: n?.linked ?? 0,
      licensesInUse: n?.active ?? 0,
      delinquent: n?.delinquent ?? 0,
      consumed: consumption.find((x) => x.companyId === c.id)?.used ?? 0,
      attendancePercent: total ? Math.round(((a?.present ?? 0) / total) * 100) : null,
    });
  }
  return result;
}

function present(ctx: ServiceContext, c: CompanyRow, m: NonNullable<Awaited<ReturnType<typeof companyMetrics>> extends Map<string, infer V> ? V : never>) {
  const { status, daysLeft } = companyContractStatus(c.endsOn, today(ctx));
  const charge = companyMonthlyCharge({ model: c.model, licenses: c.licenses, activeStudents: m.licensesInUse, licensePriceCents: c.licensePriceCents, subsidyPercent: c.subsidyPercent });
  const collaboratorMonthlyCents =
    c.model === "b2b2c" ? Math.round(m.licensesInUse * c.licensePriceCents * (1 - c.subsidyPercent / 100) * (1 - c.discountPercent / 100)) : 0;
  return {
    ...c,
    ...m,
    status,
    daysLeft,
    monthlyCompanyCents: charge.amountCents,
    monthlyCollaboratorCents: collaboratorMonthlyCents,
    alerts: companyAlerts({
      status,
      daysLeft,
      autoRenew: c.autoRenew,
      licensesInUse: m.licensesInUse,
      licenses: c.licenses,
      consumed: m.consumed,
      contractedLessons: c.contractedLessons,
      attendancePercent: m.attendancePercent,
      delinquentStudents: m.delinquent,
    }),
  };
}

export async function listCompanies(ctx: ServiceContext) {
  await autoRenewCompanies(ctx);
  const rows = await ctx.db.select().from(company).where(eq(company.tenantId, ctx.tenantId)).orderBy(asc(company.endsOn));
  const metrics = await companyMetrics(ctx, rows);
  return rows.map((c) => present(ctx, c, metrics.get(c.id)!));
}

export async function companyDetail(ctx: ServiceContext, id: string) {
  const c = await getCompanyRow(ctx.db, ctx, id);
  const metrics = await companyMetrics(ctx, [c]);
  const students = await ctx.db
    .select({
      id: student.id,
      status: student.status,
      name: person.name,
      email: person.email,
      activeEnrollments: sql<number>`(select count(*)::int from enrollment e where e.student_id = ${student.id} and e.ended_at is null)`,
      used: sql<number>`(select coalesce(-sum(ce.amount), 0)::int from credit_entry ce join enrollment e on e.id = ce.enrollment_id where e.student_id = ${student.id} and ce.amount < 0)`,
    })
    .from(student)
    .innerJoin(person, eq(person.id, student.personId))
    .where(eq(student.companyId, c.id))
    .orderBy(asc(person.name));
  const charges = await ctx.db.select().from(companyCharge).where(eq(companyCharge.companyId, c.id)).orderBy(desc(companyCharge.month));
  return { company: present(ctx, c, metrics.get(c.id)!), students, charges };
}

/* ------------------------------------------------------------------ cobrança */

export async function generateCharge(ctx: ServiceContext, companyId: string, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid("month", "Mês no formato AAAA-MM");
  const c = await getCompanyRow(ctx.db, ctx, companyId);
  if (`${month}-31` < c.startsOn || `${month}-01` > c.endsOn) throw unprocessable("O mês está fora da vigência do contrato.");
  const metrics = await companyMetrics(ctx, [c]);
  const { billedLicenses, amountCents } = companyMonthlyCharge({
    model: c.model,
    licenses: c.licenses,
    activeStudents: metrics.get(c.id)!.licensesInUse,
    licensePriceCents: c.licensePriceCents,
    subsidyPercent: c.subsidyPercent,
  });
  const dueDay = String(ctx.settings.policies.dueDay).padStart(2, "0");
  const [row] = await ctx.db
    .insert(companyCharge)
    .values({ tenantId: ctx.tenantId, companyId: c.id, month, billedLicenses, amountCents, dueDate: `${month}-${dueDay}` })
    .onConflictDoNothing()
    .returning();
  if (!row) throw unprocessable("A cobrança deste mês já foi gerada.");
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "company_charge", entityId: row.id, action: "create", after: row });
  return row;
}

export async function payCharge(ctx: ServiceContext, chargeId: string, input: { method: PaymentMethod; paidOn?: string }) {
  const [ch] = await ctx.db.select().from(companyCharge).where(and(eq(companyCharge.id, chargeId), eq(companyCharge.tenantId, ctx.tenantId)));
  if (!ch) throw notFound("Cobrança");
  if (ch.paidOn) throw unprocessable("A cobrança já está paga.");
  if (ch.cancelledAt) throw unprocessable("A cobrança está cancelada.");
  const paidOn = input.paidOn ?? today(ctx);
  if (paidOn > today(ctx)) throw invalid("paidOn", "Data de pagamento no futuro");
  const [row] = await ctx.db.update(companyCharge).set({ paidOn, method: input.method }).where(eq(companyCharge.id, ch.id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "company_charge", entityId: ch.id, action: "update", before: ch, after: row });
  return row!;
}

/** Registra o envio do relatório ao RH, com os números do momento. O envio por e-mail entra com o serviço de e-mail. */
export async function recordReport(ctx: ServiceContext, companyId: string) {
  const { company: c, students } = await companyDetail(ctx, companyId);
  if (!c.hrEmail) throw unprocessable("Cadastre o e-mail do RH antes de enviar o relatório.");
  const [row] = await ctx.db.update(company).set({ lastReportSentAt: ctx.now }).where(eq(company.id, c.id)).returning();
  await audit(ctx.db, {
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    entity: "company",
    entityId: c.id,
    action: "update",
    after: { relatorioRH: c.hrEmail, alunos: students.length, licencasEmUso: c.licensesInUse, presenca: c.attendancePercent, consumo: c.consumed },
  });
  return row!;
}
