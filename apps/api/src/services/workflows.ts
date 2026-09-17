import {
  and,
  asc,
  classGroup,
  course,
  creditEntry,
  desc,
  enrollment,
  eq,
  isNull,
  lead,
  lesson,
  lessonStudent,
  person,
  sql,
  student,
  workflowCard,
  workflowTransition,
  type PaymentMethod,
} from "@classa/db";
import {
  addDays,
  checkRequires,
  dateInZone,
  FLOWS,
  LEAD_LOST_REASONS,
  LEAD_STAGES,
  missingRequired,
  transitionPath,
  type FlowKey,
  type LeadStage,
} from "@classa/domain";
import { audit } from "../http/audit.ts";
import { invalid, notFound, unprocessable } from "../http/errors.ts";
import type { ServiceContext } from "./context.ts";
import { issueContractTx, listInstallments, registerPayment } from "./finance.ts";
import { changeLessonTeacher } from "./lessons.ts";
import { createStudent, createTeacher, setStudentStatus } from "./people.ts";
import { transferEnrollment } from "./enrollments.ts";

const today = (ctx: ServiceContext) => dateInZone(ctx.now, ctx.timezone);
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/* ============================================================== fluxos (kanban) */

function flowOf(key: string) {
  if (!(key in FLOWS)) throw invalid("flow", "Fluxo inexistente");
  return FLOWS[key as FlowKey];
}

async function studentName(ctx: ServiceContext, studentId: string) {
  const [row] = await ctx.db
    .select({ name: person.name })
    .from(student)
    .innerJoin(person, eq(person.id, student.personId))
    .where(and(eq(student.id, studentId), eq(student.tenantId, ctx.tenantId)));
  if (!row) throw invalid("studentId", "Aluno não encontrado");
  return row.name;
}

async function enrollmentLabel(ctx: ServiceContext, enrollmentId: string) {
  const [row] = await ctx.db
    .select({ studentName: person.name, className: classGroup.name, endedAt: enrollment.endedAt })
    .from(enrollment)
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .innerJoin(person, eq(person.id, student.personId))
    .innerJoin(classGroup, eq(classGroup.id, enrollment.classGroupId))
    .where(and(eq(enrollment.id, enrollmentId), eq(enrollment.tenantId, ctx.tenantId)));
  if (!row) throw invalid("enrollmentId", "Matrícula não encontrada");
  return row;
}

/** Título do cartão e dados complementares gravados na criação. */
async function describe(ctx: ServiceContext, flow: FlowKey, data: Record<string, unknown>) {
  switch (flow) {
    case "substituicao": {
      const [l] = await ctx.db
        .select({ startsAt: lesson.startsAt, className: classGroup.name, teacherId: lesson.teacherId, state: lesson.state })
        .from(lesson)
        .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
        .where(and(eq(lesson.id, str(data.lessonId)), eq(lesson.tenantId, ctx.tenantId)));
      if (!l) throw invalid("lessonId", "Aula não encontrada");
      if (l.state !== "agendada" || l.startsAt <= ctx.now) throw invalid("lessonId", "Escolha uma aula futura e agendada");
      const when = new Intl.DateTimeFormat("pt-BR", { timeZone: ctx.timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(l.startsAt);
      return { title: `${l.className} · ${when}`, extra: { originalTeacherId: l.teacherId } };
    }
    case "nivel":
    case "renovacao": {
      const e = await enrollmentLabel(ctx, str(data.enrollmentId));
      if (e.endedAt) throw invalid("enrollmentId", "A matrícula está encerrada");
      return { title: `${e.studentName} · ${e.className}`, extra: {} };
    }
    case "reposicao": {
      const [m] = await ctx.db
        .select({ status: lessonStudent.status, name: person.name, startsAt: lesson.startsAt, className: classGroup.name })
        .from(lessonStudent)
        .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
        .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
        .innerJoin(student, eq(student.id, lessonStudent.studentId))
        .innerJoin(person, eq(person.id, student.personId))
        .where(and(eq(lessonStudent.id, str(data.missedLessonStudentId)), eq(lessonStudent.tenantId, ctx.tenantId)));
      if (!m) throw invalid("missedLessonStudentId", "Falta não encontrada");
      if (m.status !== "falta") throw invalid("missedLessonStudentId", "Só dá para repor uma aula em que o aluno faltou");
      const when = new Intl.DateTimeFormat("pt-BR", { timeZone: ctx.timezone, day: "2-digit", month: "2-digit" }).format(m.startsAt);
      return { title: `${m.name} · falta em ${when} (${m.className})`, extra: {} };
    }
    case "admissao":
      return { title: str(data.name).trim(), extra: {} };
    case "cobranca": {
      const name = await studentName(ctx, str(data.studentId));
      const overdue = (await listInstallments(ctx, { studentId: str(data.studentId), status: "vencida" })).map((i) => ({ id: i.id, open: i.amountCents - i.paidCents }));
      if (overdue.length === 0) throw invalid("studentId", "O aluno não tem parcela vencida");
      return { title: name, extra: { installmentIds: overdue.map((o) => o.id), overdueCents: overdue.reduce((s, o) => s + o.open, 0) } };
    }
    case "retencao":
      return { title: await studentName(ctx, str(data.studentId)), extra: {} };
    case "campanha":
      return { title: str(data.name).trim(), extra: {} };
  }
}

export async function createCard(ctx: ServiceContext, flowKey: string, data: Record<string, unknown>) {
  const def = flowOf(flowKey);
  const missing = missingRequired(def, data);
  if (missing.length) {
    const issues = Object.fromEntries(missing.map((k) => [k, ["Obrigatório"]]));
    throw Object.assign(invalid(missing[0]!, `Preencha: ${missing.map((k) => def.fields.find((f) => f.key === k)!.label).join(", ")}`), { issues });
  }
  const { title, extra } = await describe(ctx, def.key, data);
  return ctx.db.transaction(async (tx) => {
    const [card] = await tx
      .insert(workflowCard)
      .values({ tenantId: ctx.tenantId, flow: def.key, stage: def.stages[0]!.key, title, data: { ...data, ...extra }, createdBy: ctx.actorId, stageChangedAt: ctx.now })
      .returning();
    await tx.insert(workflowTransition).values({ tenantId: ctx.tenantId, cardId: card!.id, toStage: card!.stage, actorId: ctx.actorId, note: "Criado" });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: `fluxo:${def.key}`, entityId: card!.id, action: "create", after: card });
    return card!;
  });
}

async function getCard(ctx: ServiceContext, id: string) {
  const [card] = await ctx.db.select().from(workflowCard).where(and(eq(workflowCard.id, id), eq(workflowCard.tenantId, ctx.tenantId)));
  if (!card) throw notFound("Cartão");
  return card;
}

export async function updateCard(ctx: ServiceContext, id: string, patch: Record<string, unknown>) {
  const card = await getCard(ctx, id);
  const def = flowOf(card.flow);
  if (def.stages.find((s) => s.key === card.stage)?.final) throw unprocessable("Cartão encerrado. Reabra para editar.");
  const allowed = new Set(def.fields.map((f) => f.key));
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k)));
  const [row] = await ctx.db
    .update(workflowCard)
    .set({ data: { ...card.data, ...clean } })
    .where(eq(workflowCard.id, id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: `fluxo:${card.flow}`, entityId: id, action: "update", before: card, after: row });
  return row!;
}

type Effect = (ctx: ServiceContext, data: Record<string, unknown>) => Promise<{ note: string; data?: Record<string, unknown> }>;

const EFFECTS: Partial<Record<FlowKey, Record<string, Effect>>> = {
  substituicao: {
    confirmado: async (ctx, d) => {
      await changeLessonTeacher(ctx, str(d.lessonId), str(d.substituteId));
      return { note: "O substituto assumiu a aula na agenda." };
    },
  },
  nivel: {
    aplicada: async (ctx, d) => {
      await transferEnrollment(ctx, str(d.enrollmentId), str(d.targetClassGroupId));
      return { note: "Aluno transferido para a nova turma." };
    },
  },
  reposicao: {
    agendada: async (ctx, d) => {
      const [missed] = await ctx.db
        .select({ ls: lessonStudent, courseId: lesson.courseId })
        .from(lessonStudent)
        .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
        .where(eq(lessonStudent.id, str(d.missedLessonStudentId)));
      const [target] = await ctx.db
        .select({ l: lesson, capacity: classGroup.capacity })
        .from(lesson)
        .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
        .where(and(eq(lesson.id, str(d.targetLessonId)), eq(lesson.tenantId, ctx.tenantId)));
      if (!missed || !target) throw invalid("targetLessonId", "Aula não encontrada");
      if (target.l.courseId !== missed.courseId) throw invalid("targetLessonId", "A reposição precisa ser em aula do mesmo curso");
      if (target.l.state !== "agendada" || target.l.startsAt <= ctx.now) throw invalid("targetLessonId", "Escolha uma aula futura e agendada");
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(lessonStudent)
        .where(and(eq(lessonStudent.lessonId, target.l.id), sql`${lessonStudent.status} <> 'cancelou'`));
      if (n >= target.capacity) throw unprocessable("A aula de reposição está cheia.");
      await ctx.db.transaction(async (tx) => {
        await tx
          .insert(lessonStudent)
          .values({ tenantId: ctx.tenantId, lessonId: target.l.id, enrollmentId: missed.ls.enrollmentId, studentId: missed.ls.studentId })
          .onConflictDoNothing();
        await tx.insert(creditEntry).values({
          tenantId: ctx.tenantId,
          enrollmentId: missed.ls.enrollmentId,
          kind: "devolucao",
          amount: 1,
          lessonId: missed.ls.lessonId,
          justification: "Reposição de falta justificada",
          actorId: ctx.actorId,
        });
      });
      return { note: "Aluno inscrito na aula de reposição; a aula perdida voltou ao extrato." };
    },
  },
  admissao: {
    ativo: async (ctx, d) => {
      const courseIds = Array.isArray(d.courseIds) ? (d.courseIds as string[]) : [];
      const t = await createTeacher(ctx, {
        person: { name: str(d.name), email: str(d.email) || null, phone: str(d.phone) || null },
        hourlyRateCents: typeof d.hourlyRateCents === "number" ? d.hourlyRateCents : null,
        courses: courseIds.map((courseId) => ({ courseId, moduleIds: null })),
      });
      return { note: "Professor cadastrado. Registre a disponibilidade na ficha dele.", data: { teacherId: t.id } };
    },
  },
  cobranca: {
    pago: async (ctx, d) => {
      const ids = Array.isArray(d.installmentIds) ? (d.installmentIds as string[]) : [];
      const open = (await listInstallments(ctx, { studentId: str(d.studentId) })).filter((i) => ids.includes(i.id) && i.status !== "paga" && i.status !== "cancelada");
      for (const i of open) await registerPayment(ctx, i.id, { method: (str(d.method) || "pix") as PaymentMethod });
      return { note: `${open.length} parcela(s) baixada(s).` };
    },
  },
  renovacao: {
    renovado: async (ctx, d) => {
      const e = await ctx.db.select().from(enrollment).where(and(eq(enrollment.id, str(d.enrollmentId)), eq(enrollment.tenantId, ctx.tenantId)));
      const current = e[0];
      if (!current || current.endedAt) throw unprocessable("A matrícula está encerrada.");
      const lessons = Number(d.packageLessons);
      if (!Number.isInteger(lessons) || lessons < 1) throw invalid("packageLessons", "Pacote precisa ter ao menos 1 aula");
      const base = current.endsOn > today(ctx) ? current.endsOn : today(ctx);
      const endsOn = addDays(base, 365);
      await ctx.db.transaction(async (tx) => {
        await tx.update(enrollment).set({ endsOn }).where(eq(enrollment.id, current.id));
        await tx.insert(creditEntry).values({ tenantId: ctx.tenantId, enrollmentId: current.id, kind: "renovacao", amount: lessons, actorId: ctx.actorId });
        const installments = Number(d.installments) || undefined;
        await issueContractTx(tx, ctx, current.id, { kind: "renovacao", lessons, installments, startsOn: today(ctx) });
        await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "enrollment", entityId: current.id, action: "update", before: current, after: { endsOn, renovacao: lessons } });
      });
      return { note: `Contrato renovado até ${endsOn.split("-").reverse().join("/")} com mais ${lessons} aulas.` };
    },
  },
  retencao: {
    cancelado: async (ctx, d) => {
      await setStudentStatus(ctx, str(d.studentId), "cancelado");
      return { note: "Aluno cancelado e matrículas encerradas." };
    },
  },
};

/** Move o cartão. Pular etapas executa, em ordem, os requisitos e os efeitos de cada etapa atravessada. */
export async function moveCard(ctx: ServiceContext, id: string, to: string, note?: string) {
  let card = await getCard(ctx, id);
  const def = flowOf(card.flow);
  const route = transitionPath(def, card.stage, to);
  if (!route.ok) throw unprocessable(route.error);

  if (route.path.length === 0) {
    const [row] = await ctx.db.update(workflowCard).set({ stage: to, stageChangedAt: ctx.now }).where(eq(workflowCard.id, id)).returning();
    await ctx.db.insert(workflowTransition).values({ tenantId: ctx.tenantId, cardId: id, fromStage: card.stage, toStage: to, actorId: ctx.actorId, note: note || "Voltou de etapa (efeitos já executados não são desfeitos)" });
    await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: `fluxo:${card.flow}`, entityId: id, action: "transition", before: card, after: row });
    return row!;
  }

  for (const stage of route.path) {
    const problem = checkRequires(stage, card.data, def);
    if (problem) throw unprocessable(problem);
    const done = (card.data.effectsDone as Record<string, boolean> | undefined) ?? {};
    let result = { note: "", data: {} as Record<string, unknown> };
    const effect = EFFECTS[def.key]?.[stage.key];
    if (effect && !done[stage.key]) {
      const r = await effect(ctx, card.data);
      result = { note: r.note, data: r.data ?? {} };
    }
    const data = { ...card.data, ...result.data, effectsDone: { ...done, ...(effect ? { [stage.key]: true } : {}) } };
    const [row] = await ctx.db.update(workflowCard).set({ stage: stage.key, data, stageChangedAt: ctx.now }).where(eq(workflowCard.id, id)).returning();
    await ctx.db.insert(workflowTransition).values({
      tenantId: ctx.tenantId,
      cardId: id,
      fromStage: card.stage,
      toStage: stage.key,
      actorId: ctx.actorId,
      note: [note, result.note].filter(Boolean).join(" · ") || null,
    });
    await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: `fluxo:${card.flow}`, entityId: id, action: "transition", before: card, after: row });
    card = row!;
  }
  return card;
}

export async function listCards(ctx: ServiceContext, flowKey: string) {
  const def = flowOf(flowKey);
  const cards = await ctx.db
    .select()
    .from(workflowCard)
    .where(and(eq(workflowCard.tenantId, ctx.tenantId), eq(workflowCard.flow, def.key)))
    .orderBy(desc(workflowCard.stageChangedAt));
  return cards;
}

export async function cardDetail(ctx: ServiceContext, id: string) {
  const card = await getCard(ctx, id);
  const transitions = await ctx.db.select().from(workflowTransition).where(eq(workflowTransition.cardId, id)).orderBy(asc(workflowTransition.createdAt));
  return { card, transitions };
}

export async function flowCounts(ctx: ServiceContext) {
  const rows = await ctx.db
    .select({ flow: workflowCard.flow, stage: workflowCard.stage, n: sql<number>`count(*)::int` })
    .from(workflowCard)
    .where(eq(workflowCard.tenantId, ctx.tenantId))
    .groupBy(workflowCard.flow, workflowCard.stage);
  return Object.fromEntries(
    Object.values(FLOWS).map((def) => {
      const open = rows.filter((r) => r.flow === def.key && !def.stages.find((s) => s.key === r.stage)?.final).reduce((s, r) => s + r.n, 0);
      return [def.key, open];
    }),
  );
}

/** Fila de renovação: matrículas ativas que vencem em até 60 dias e ainda não têm cartão aberto. */
export async function renewalQueue(ctx: ServiceContext) {
  const limit = addDays(today(ctx), 60);
  const rows = await ctx.db
    .select({
      enrollmentId: enrollment.id,
      endsOn: enrollment.endsOn,
      studentId: enrollment.studentId,
      studentName: person.name,
      className: classGroup.name,
      courseName: course.name,
      balance: sql<number>`(select coalesce(sum(ce.amount), 0)::int from credit_entry ce where ce.enrollment_id = ${enrollment.id})`,
    })
    .from(enrollment)
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .innerJoin(person, eq(person.id, student.personId))
    .innerJoin(classGroup, eq(classGroup.id, enrollment.classGroupId))
    .innerJoin(course, eq(course.id, enrollment.courseId))
    .where(and(eq(enrollment.tenantId, ctx.tenantId), isNull(enrollment.endedAt), sql`${enrollment.endsOn} <= ${limit}`))
    .orderBy(asc(enrollment.endsOn));
  const openCards = (await listCards(ctx, "renovacao")).filter((c) => !FLOWS.renovacao.stages.find((s) => s.key === c.stage)?.final);
  const withCard = new Set(openCards.map((c) => str(c.data.enrollmentId)));
  return rows.filter((r) => !withCard.has(r.enrollmentId)).map((r) => ({ ...r, urgent: r.endsOn <= addDays(today(ctx), 10) }));
}

/* ====================================================================== leads */

export type LeadInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  origin: string;
  campaign?: string | null;
  courseId?: string | null;
  temperature?: "frio" | "morno" | "quente" | null;
  nextAction?: string | null;
  nextActionOn?: string | null;
  consent?: boolean;
};

async function getLead(ctx: ServiceContext, id: string) {
  const [row] = await ctx.db.select().from(lead).where(and(eq(lead.id, id), eq(lead.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Lead");
  return row;
}

export async function createLead(ctx: ServiceContext, input: LeadInput) {
  const name = input.name.trim();
  if (name.length < 2) throw invalid("name", "Nome precisa de pelo menos 2 caracteres");
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid("email", "E-mail inválido");
  const [row] = await ctx.db
    .insert(lead)
    .values({
      tenantId: ctx.tenantId,
      name,
      email,
      phone: input.phone?.replace(/\D/g, "") || null,
      origin: input.origin,
      campaign: input.campaign || null,
      courseId: input.courseId || null,
      consultantUserId: ctx.actorId,
      temperature: input.temperature ?? null,
      nextAction: input.nextAction || null,
      nextActionOn: input.nextActionOn || null,
      consent: input.consent ?? false,
      stageChangedAt: ctx.now,
    })
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "lead", entityId: row!.id, action: "create", after: row });
  return row!;
}

export async function updateLead(ctx: ServiceContext, id: string, input: Partial<LeadInput>) {
  const before = await getLead(ctx, id);
  const [row] = await ctx.db
    .update(lead)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.email !== undefined ? { email: input.email?.trim().toLowerCase() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone?.replace(/\D/g, "") || null } : {}),
      ...(input.courseId !== undefined ? { courseId: input.courseId || null } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.nextAction !== undefined ? { nextAction: input.nextAction || null } : {}),
      ...(input.nextActionOn !== undefined ? { nextActionOn: input.nextActionOn || null } : {}),
    })
    .where(eq(lead.id, id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "lead", entityId: id, action: "update", before, after: row });
  return row!;
}

/** Avança uma etapa (até proposta), marca como perdido (com motivo) ou reabre. */
export async function moveLead(ctx: ServiceContext, id: string, action: { to: "avancar" } | { to: "perdido"; reason: string } | { to: "reabrir" }) {
  const l = await getLead(ctx, id);
  let patch: Partial<typeof lead.$inferInsert>;
  if (action.to === "avancar") {
    const i = LEAD_STAGES.indexOf(l.stage as LeadStage);
    if (i < 0 || i >= 3) throw unprocessable("Da proposta em diante, o próximo passo é matricular ou perder o lead.");
    patch = { stage: LEAD_STAGES[i + 1]!, stageChangedAt: ctx.now };
  } else if (action.to === "perdido") {
    if (l.stage === "matriculado" || l.stage === "perdido") throw unprocessable("O lead já foi encerrado.");
    if (!(LEAD_LOST_REASONS as readonly string[]).includes(action.reason)) throw invalid("reason", "Escolha o motivo da perda");
    patch = { stage: "perdido", previousStage: l.stage, lostReason: action.reason, stageChangedAt: ctx.now };
  } else {
    if (l.stage !== "perdido") throw unprocessable("Só lead perdido pode ser reaberto.");
    patch = { stage: l.previousStage && l.previousStage !== "perdido" ? l.previousStage : "contato", lostReason: null, stageChangedAt: ctx.now };
  }
  const [row] = await ctx.db.update(lead).set(patch).where(eq(lead.id, id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "lead", entityId: id, action: "transition", before: l, after: row });
  return row!;
}

/** Converte o lead (a partir da proposta) em aluno, reaproveitando a pessoa se o e-mail já existe. */
export async function convertLead(ctx: ServiceContext, id: string) {
  const l = await getLead(ctx, id);
  if (l.stage !== "proposta") throw unprocessable("Só lead com proposta enviada pode ser matriculado.");
  let studentId: string | null = null;
  if (l.email) {
    const [existing] = await ctx.db
      .select({ personId: person.id, studentId: student.id })
      .from(person)
      .leftJoin(student, eq(student.personId, person.id))
      .where(and(eq(person.tenantId, ctx.tenantId), sql`lower(${person.email}) = ${l.email}`));
    if (existing?.studentId) studentId = existing.studentId;
    else if (existing) studentId = (await createStudent(ctx, { personId: existing.personId })).id;
  }
  if (!studentId) studentId = (await createStudent(ctx, { person: { name: l.name, email: l.email, phone: l.phone } })).id;
  const [row] = await ctx.db.update(lead).set({ stage: "matriculado", studentId, stageChangedAt: ctx.now }).where(eq(lead.id, id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "lead", entityId: id, action: "transition", before: l, after: row });
  return row!;
}

export async function listLeads(ctx: ServiceContext) {
  const rows = await ctx.db
    .select({ lead, courseName: course.name })
    .from(lead)
    .leftJoin(course, eq(course.id, lead.courseId))
    .where(eq(lead.tenantId, ctx.tenantId))
    .orderBy(desc(lead.stageChangedAt));
  return rows.map((r) => ({
    ...r.lead,
    courseName: r.courseName,
    daysInStage: Math.floor((ctx.now.getTime() - r.lead.stageChangedAt.getTime()) / 86400_000),
    stalled: r.lead.stage === "proposta" && ctx.now.getTime() - r.lead.stageChangedAt.getTime() >= 14 * 86400_000,
  }));
}

/* ------------------------------------------------ opções para os formulários */

/** Listas de escolha que os formulários dos fluxos precisam. */
export async function flowOptions(ctx: ServiceContext, flowKey: string) {
  const def = flowOf(flowKey);
  const now = ctx.now.toISOString();
  const in21 = new Date(ctx.now.getTime() + 21 * 86400_000).toISOString();
  const ago30 = new Date(ctx.now.getTime() - 30 * 86400_000).toISOString();
  switch (def.key) {
    case "substituicao":
      return {
        lessons: await ctx.db
          .select({ id: lesson.id, startsAt: lesson.startsAt, endsAt: lesson.endsAt, className: classGroup.name, courseId: lesson.courseId, moduleId: lesson.moduleId, teacherId: lesson.teacherId })
          .from(lesson)
          .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
          .where(and(eq(lesson.tenantId, ctx.tenantId), eq(lesson.state, "agendada"), sql`${lesson.startsAt} > ${now} and ${lesson.startsAt} < ${in21}`))
          .orderBy(asc(lesson.startsAt))
          .limit(200),
      };
    case "nivel":
    case "renovacao":
      return {
        enrollments: await ctx.db
          .select({ id: enrollment.id, studentName: person.name, className: classGroup.name, courseId: enrollment.courseId, endsOn: enrollment.endsOn })
          .from(enrollment)
          .innerJoin(student, eq(student.id, enrollment.studentId))
          .innerJoin(person, eq(person.id, student.personId))
          .innerJoin(classGroup, eq(classGroup.id, enrollment.classGroupId))
          .where(and(eq(enrollment.tenantId, ctx.tenantId), isNull(enrollment.endedAt)))
          .orderBy(asc(person.name)),
      };
    case "reposicao":
      return {
        absences: await ctx.db
          .select({ id: lessonStudent.id, studentName: person.name, startsAt: lesson.startsAt, className: classGroup.name, courseId: lesson.courseId })
          .from(lessonStudent)
          .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
          .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
          .innerJoin(student, eq(student.id, lessonStudent.studentId))
          .innerJoin(person, eq(person.id, student.personId))
          .where(and(eq(lessonStudent.tenantId, ctx.tenantId), eq(lessonStudent.status, "falta"), sql`${lesson.startsAt} > ${ago30}`))
          .orderBy(desc(lesson.startsAt))
          .limit(100),
        lessons: await ctx.db
          .select({ id: lesson.id, startsAt: lesson.startsAt, className: classGroup.name, courseId: lesson.courseId })
          .from(lesson)
          .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
          .where(and(eq(lesson.tenantId, ctx.tenantId), eq(lesson.state, "agendada"), sql`${lesson.startsAt} > ${now} and ${lesson.startsAt} < ${in21}`))
          .orderBy(asc(lesson.startsAt))
          .limit(200),
      };
    case "cobranca": {
      const overdue = await listInstallments(ctx, { status: "vencida" });
      const byStudent = new Map<string, { id: string; name: string; cents: number }>();
      for (const i of overdue) {
        const cur = byStudent.get(i.studentId) ?? { id: i.studentId, name: i.studentName, cents: 0 };
        cur.cents += i.amountCents - i.paidCents;
        byStudent.set(i.studentId, cur);
      }
      return { students: [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name)) };
    }
    case "retencao":
      return {
        students: await ctx.db
          .select({ id: student.id, name: person.name })
          .from(student)
          .innerJoin(person, eq(person.id, student.personId))
          .where(and(eq(student.tenantId, ctx.tenantId), sql`${student.status} not in ('cancelado', 'inativo')`))
          .orderBy(asc(person.name)),
      };
    default:
      return {};
  }
}

