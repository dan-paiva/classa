import {
  agendaEvent,
  agendaEventParticipant,
  and,
  asc,
  course,
  courseModule,
  enrollment,
  eq,
  inArray,
  isNull,
  lesson,
  lessonStudent,
  membership,
  person,
  sql,
  student,
  teacher,
  classGroup,
  type AgendaEventKind,
} from "@classa/db";
import { dateInZone } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { DomainError, invalid, notFound, unprocessable } from "../http/errors.ts";
import type { Db, ServiceContext } from "./context.ts";
import { listOpenSlots } from "./open-entry.ts";
import { listLessons } from "./schedule.ts";

/**
 * Eventos, reuniões e nivelamentos (DOMINIO.md §5.8) e a agenda geral (§5.10).
 *
 * Participante é sempre uma pessoa: colaborador, professor, aluno e lead entram
 * do mesmo jeito, e é isso que deixa nivelar quem ainda não é aluno. Avaliador e
 * avaliado do nivelamento também viram participantes, para o evento aparecer na
 * agenda deles sem consulta especial.
 */

export type EventInput = {
  kind: AgendaEventKind;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  notes?: string | null;
  participantIds?: string[];
  evaluatedPersonId?: string | null;
  evaluatorPersonId?: string | null;
  courseId?: string | null;
  /** "Salvar mesmo assim": o choque com aula é aviso, não bloqueio. */
  force?: boolean;
};

const fmtWhen = (ctx: ServiceContext, d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: ctx.timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

async function assertPeople(db: Db, ctx: ServiceContext, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.tenantId, ctx.tenantId), inArray(person.id, ids)));
  if (rows.length !== new Set(ids).size) throw invalid("participantIds", "Participante não encontrado");
}

/** Avaliador do nivelamento: professor ativo ou alguém da equipe com a área pedagógica. */
async function assertEvaluator(db: Db, ctx: ServiceContext, personId: string) {
  const [t] = await db
    .select({ id: teacher.id })
    .from(teacher)
    .where(and(eq(teacher.tenantId, ctx.tenantId), eq(teacher.personId, personId), sql`${teacher.deactivatedAt} is null`));
  if (t) return;
  const [m] = await db
    .select({ id: membership.id })
    .from(membership)
    .where(
      and(
        eq(membership.tenantId, ctx.tenantId),
        eq(membership.personId, personId),
        sql`${membership.deactivatedAt} is null`,
        sql`(${membership.profileType} = 'admin' or (${membership.profileType} = 'colaborador' and ${membership.areas} ? 'ped'))`,
      ),
    );
  if (!m) throw invalid("evaluatorPersonId", "O avaliador precisa ser professor ou da área pedagógica");
}

/**
 * Aulas dos participantes que se sobrepõem ao horário: como professor ou como
 * aluno inscrito. Serve de aviso, não de trava.
 */
export async function lessonClashes(ctx: ServiceContext, personIds: string[], startsAt: Date, endsAt: Date) {
  if (personIds.length === 0) return [];
  const overlap = sql`tstzrange(${lesson.startsAt}, ${lesson.endsAt}) && tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz)`;
  const asTeacher = await ctx.db
    .select({ name: person.name, className: classGroup.name, startsAt: lesson.startsAt })
    .from(lesson)
    .innerJoin(teacher, eq(teacher.id, lesson.teacherId))
    .innerJoin(person, eq(person.id, teacher.personId))
    .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
    .where(and(eq(lesson.tenantId, ctx.tenantId), inArray(person.id, personIds), sql`${lesson.state} <> 'cancelada'`, overlap));
  const asStudent = await ctx.db
    .select({ name: person.name, className: classGroup.name, startsAt: lesson.startsAt })
    .from(lessonStudent)
    .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
    .innerJoin(student, eq(student.id, lessonStudent.studentId))
    .innerJoin(person, eq(person.id, student.personId))
    .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
    .where(
      and(
        eq(lesson.tenantId, ctx.tenantId),
        inArray(person.id, personIds),
        sql`${lessonStudent.status} <> 'cancelou'`,
        sql`${lesson.state} <> 'cancelada'`,
        overlap,
      ),
    );
  return [...asTeacher, ...asStudent].map((r) => `${r.name} tem aula de ${r.className} em ${fmtWhen(ctx, r.startsAt)}.`);
}

function normalize(ctx: ServiceContext, input: EventInput) {
  const title = input.title.trim();
  if (!title) throw invalid("title", "Informe o título");
  if (input.endsAt <= input.startsAt) throw invalid("endsAt", "O fim precisa ser depois do início");
  if (dateInZone(input.startsAt, ctx.timezone) !== dateInZone(new Date(input.endsAt.getTime() - 1), ctx.timezone)) {
    throw invalid("endsAt", "Início e fim no mesmo dia");
  }
  const evaluated = input.kind === "nivelamento" ? input.evaluatedPersonId || null : null;
  const evaluator = input.kind === "nivelamento" ? input.evaluatorPersonId || null : null;
  if (input.kind === "nivelamento" && !evaluated) throw invalid("evaluatedPersonId", "Escolha quem vai ser avaliado");
  if (input.kind === "nivelamento" && !evaluator) throw invalid("evaluatorPersonId", "Escolha o avaliador");
  const participants = [...new Set([...(input.participantIds ?? []), ...(evaluated ? [evaluated] : []), ...(evaluator ? [evaluator] : [])])];
  return { title, evaluated, evaluator, participants };
}

async function validateEvent(ctx: ServiceContext, input: EventInput, n: ReturnType<typeof normalize>) {
  await assertPeople(ctx.db, ctx, n.participants);
  if (n.evaluator) await assertEvaluator(ctx.db, ctx, n.evaluator);
  if (input.courseId) {
    const [c] = await ctx.db.select({ id: course.id }).from(course).where(and(eq(course.id, input.courseId), eq(course.tenantId, ctx.tenantId)));
    if (!c) throw invalid("courseId", "Curso não encontrado");
  }
  if (!input.force) {
    const clashes = await lessonClashes(ctx, n.participants, input.startsAt, input.endsAt);
    if (clashes.length) throw new DomainError(409, "clash", "Há participante com aula nesse horário.", { clashes });
  }
}

export async function createEvent(ctx: ServiceContext, input: EventInput) {
  const n = normalize(ctx, input);
  await validateEvent(ctx, input, n);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(agendaEvent)
      .values({
        tenantId: ctx.tenantId,
        kind: input.kind,
        title: n.title,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        location: input.location?.trim() || null,
        notes: input.notes?.trim() || null,
        evaluatedPersonId: n.evaluated,
        evaluatorPersonId: n.evaluator,
        courseId: input.courseId || null,
        createdBy: ctx.actorId,
      })
      .returning();
    if (n.participants.length) {
      await tx.insert(agendaEventParticipant).values(n.participants.map((personId) => ({ tenantId: ctx.tenantId, eventId: row!.id, personId })));
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "agenda_event", entityId: row!.id, action: "create", after: { ...row, participants: n.participants } });
    return row!;
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getEventRow(ctx: ServiceContext, id: string) {
  if (!UUID.test(id)) throw notFound("Evento");
  const [row] = await ctx.db.select().from(agendaEvent).where(and(eq(agendaEvent.id, id), eq(agendaEvent.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Evento");
  return row;
}

export async function eventDetail(ctx: ServiceContext, id: string) {
  const row = await getEventRow(ctx, id);
  const participants = await ctx.db
    .select({ id: person.id, name: person.name })
    .from(agendaEventParticipant)
    .innerJoin(person, eq(person.id, agendaEventParticipant.personId))
    .where(eq(agendaEventParticipant.eventId, id))
    .orderBy(asc(person.name));
  const nameOf = async (id: string | null) =>
    id ? ((await ctx.db.select({ name: person.name }).from(person).where(eq(person.id, id)))[0]?.name ?? null) : null;
  const names = {
    evaluatedName: await nameOf(row.evaluatedPersonId),
    evaluatorName: await nameOf(row.evaluatorPersonId),
    courseName: row.courseId ? ((await ctx.db.select({ name: course.name }).from(course).where(eq(course.id, row.courseId)))[0]?.name ?? null) : null,
    suggestedModuleName: row.suggestedModuleId
      ? ((await ctx.db.select({ name: courseModule.name }).from(courseModule).where(eq(courseModule.id, row.suggestedModuleId)))[0]?.name ?? null)
      : null,
  };
  return { event: { ...row, ...names }, participants };
}

export async function updateEvent(ctx: ServiceContext, id: string, input: EventInput) {
  const before = await getEventRow(ctx, id);
  if (before.state !== "agendado") throw unprocessable("Só dá para editar evento ainda agendado.");
  if (input.kind !== before.kind) throw invalid("kind", "O tipo do evento não muda depois de criado");
  const n = normalize(ctx, input);
  await validateEvent(ctx, input, n);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(agendaEvent)
      .set({
        title: n.title,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        location: input.location?.trim() || null,
        notes: input.notes?.trim() || null,
        evaluatedPersonId: n.evaluated,
        evaluatorPersonId: n.evaluator,
        courseId: input.courseId || null,
      })
      .where(eq(agendaEvent.id, id))
      .returning();
    await tx.delete(agendaEventParticipant).where(eq(agendaEventParticipant.eventId, id));
    if (n.participants.length) {
      await tx.insert(agendaEventParticipant).values(n.participants.map((personId) => ({ tenantId: ctx.tenantId, eventId: id, personId })));
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "agenda_event", entityId: id, action: "update", before, after: { ...row, participants: n.participants } });
    return row!;
  });
}

/** Excluir é cancelar: o item continua na agenda, riscado (§5.10). */
export async function cancelEvent(ctx: ServiceContext, id: string, reason: string) {
  const before = await getEventRow(ctx, id);
  if (before.state === "cancelado") throw unprocessable("O evento já está cancelado.");
  if (!reason.trim()) throw invalid("reason", "Informe o motivo");
  const [row] = await ctx.db.update(agendaEvent).set({ state: "cancelado", cancelReason: reason.trim() }).where(eq(agendaEvent.id, id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "agenda_event", entityId: id, action: "update", before, after: row });
  return row!;
}

/**
 * Resultado do nivelamento. Não matricula ninguém e não muda nível sozinho:
 * alimenta a decisão administrativa (§5.8 e §5.9).
 */
export async function recordLevelingResult(ctx: ServiceContext, id: string, input: { suggestedModuleId: string; resultNotes?: string | null }) {
  const before = await getEventRow(ctx, id);
  if (before.kind !== "nivelamento") throw unprocessable("Só nivelamento tem resultado.");
  if (before.state === "cancelado") throw unprocessable("O nivelamento foi cancelado.");
  const [m] = await ctx.db.select().from(courseModule).where(eq(courseModule.id, input.suggestedModuleId));
  if (!m) throw invalid("suggestedModuleId", "Módulo não encontrado");
  if (before.courseId && m.courseId !== before.courseId) throw invalid("suggestedModuleId", "O módulo precisa ser do curso do nivelamento");
  const [row] = await ctx.db
    .update(agendaEvent)
    .set({ state: "realizado", suggestedModuleId: m.id, courseId: before.courseId ?? m.courseId, resultNotes: input.resultNotes?.trim() || null })
    .where(eq(agendaEvent.id, id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "agenda_event", entityId: id, action: "update", before, after: row });
  return row!;
}

export async function markNoShow(ctx: ServiceContext, id: string) {
  const before = await getEventRow(ctx, id);
  if (before.kind !== "nivelamento") throw unprocessable("Só nivelamento registra falta do avaliado.");
  if (before.state !== "agendado") throw unprocessable("O nivelamento não está agendado.");
  const [row] = await ctx.db.update(agendaEvent).set({ state: "nao_compareceu" }).where(eq(agendaEvent.id, id)).returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "agenda_event", entityId: id, action: "update", before, after: row });
  return row!;
}

/* ============================================================ agenda geral */

export const AGENDA_ITEM_TYPES = ["aula", "reuniao", "evento", "nivelamento"] as const;
export type AgendaItemType = (typeof AGENDA_ITEM_TYPES)[number];

export type AgendaItem = {
  type: AgendaItemType;
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  state: string;
  cancelled: boolean;
  color: string | null;
  detail: string | null;
  /** Vaga open-entry: quantas sobram. */
  seatsLeft?: number;
};

export type AgendaFilters = {
  from: Date;
  to: Date;
  type?: AgendaItemType;
  teacherId?: string;
  roomId?: string;
  classGroupId?: string;
  courseId?: string;
  moduleId?: string;
  personId?: string;
  /** Só as vagas open-entry abertas. */
  openSlots?: boolean;
};

/** Quem está olhando: decide o que entra (§5.10 e §8). */
export type AgendaScope = { kind: "equipe" } | { kind: "professor"; teacherId: string; personId: string | null } | { kind: "aluno"; studentId: string; personId: string };

async function teacherPerson(ctx: ServiceContext, teacherId: string) {
  const [t] = await ctx.db.select({ personId: teacher.personId }).from(teacher).where(and(eq(teacher.id, teacherId), eq(teacher.tenantId, ctx.tenantId)));
  return t?.personId ?? null;
}

async function personRoles(ctx: ServiceContext, personId: string) {
  const [t] = await ctx.db.select({ id: teacher.id }).from(teacher).where(and(eq(teacher.personId, personId), eq(teacher.tenantId, ctx.tenantId)));
  const [s] = await ctx.db.select({ id: student.id }).from(student).where(and(eq(student.personId, personId), eq(student.tenantId, ctx.tenantId)));
  return { teacherId: t?.id ?? null, studentId: s?.id ?? null };
}

async function lessonItems(ctx: ServiceContext, f: AgendaFilters, scope: AgendaScope): Promise<AgendaItem[]> {
  if (f.type && f.type !== "aula") return [];
  let teacherId = f.teacherId;
  let studentId: string | undefined;
  if (scope.kind === "professor") teacherId = scope.teacherId;
  if (scope.kind === "aluno") studentId = scope.studentId;

  const base = { from: f.from, to: f.to, classGroupId: f.classGroupId, courseId: f.courseId, roomId: f.roomId, moduleId: f.moduleId };
  let lessons: Awaited<ReturnType<typeof listLessons>>;
  if (f.personId && scope.kind === "equipe") {
    // a pessoa pode dar aula e assistir aula; as duas agendas entram
    const roles = await personRoles(ctx, f.personId);
    const given = roles.teacherId && (!teacherId || teacherId === roles.teacherId) ? await listLessons(ctx, { ...base, teacherId: roles.teacherId }) : [];
    const taken = roles.studentId ? await listLessons(ctx, { ...base, teacherId, studentId: roles.studentId }) : [];
    const seen = new Set<string>();
    lessons = [...given, ...taken].filter((l) => !seen.has(l.id) && seen.add(l.id));
  } else {
    lessons = await listLessons(ctx, { ...base, teacherId, studentId });
  }
  if (f.openSlots) lessons = lessons.filter((l) => l.regime === "open_entry" && l.state === "agendada" && l.startsAt > ctx.now && l.enrolled < l.capacity);
  return lessons.map((l) => ({
    type: "aula",
    id: l.id,
    title: l.className,
    startsAt: l.startsAt,
    endsAt: l.endsAt,
    state: l.state,
    cancelled: l.state === "cancelada",
    color: l.courseColor,
    detail: [l.teacherName ?? "sem professor", l.roomName ?? "sem sala", `${l.enrolled}/${l.capacity}`].join(" · "),
    ...(l.regime === "open_entry" ? { seatsLeft: l.capacity - l.enrolled } : {}),
  }));
}

async function eventItems(ctx: ServiceContext, f: AgendaFilters, scope: AgendaScope): Promise<AgendaItem[]> {
  if (f.type === "aula" || f.openSlots) return [];
  // filtros que só existem em aula tiram os eventos da leitura
  if (f.roomId || f.classGroupId || f.moduleId) return [];
  let participant: string | null | undefined = f.personId;
  if (f.teacherId) participant = await teacherPerson(ctx, f.teacherId);
  if (scope.kind !== "equipe") participant = scope.personId;
  if (participant === null) return [];

  const rows = await ctx.db
    .select({ e: agendaEvent, courseColor: course.color, evaluatedName: sql<string | null>`(select name from person where id = ${agendaEvent.evaluatedPersonId})` })
    .from(agendaEvent)
    .leftJoin(course, eq(course.id, agendaEvent.courseId))
    .where(
      and(
        eq(agendaEvent.tenantId, ctx.tenantId),
        sql`${agendaEvent.startsAt} >= ${f.from.toISOString()}`,
        sql`${agendaEvent.startsAt} < ${f.to.toISOString()}`,
        f.type ? eq(agendaEvent.kind, f.type) : undefined,
        f.courseId ? eq(agendaEvent.courseId, f.courseId) : undefined,
        participant
          ? sql`exists (select 1 from agenda_event_participant p where p.event_id = ${agendaEvent.id} and p.person_id = ${participant})`
          : undefined,
        // o aluno vê só os próprios nivelamentos (§5.10)
        scope.kind === "aluno" ? eq(agendaEvent.kind, "nivelamento") : undefined,
      ),
    )
    .orderBy(asc(agendaEvent.startsAt));
  return rows.map(({ e, courseColor, evaluatedName }) => ({
    type: e.kind,
    id: e.id,
    title: e.kind === "nivelamento" && evaluatedName && !e.title.includes(evaluatedName) ? `${e.title} · ${evaluatedName}` : e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    state: e.state,
    cancelled: e.state === "cancelado",
    color: courseColor,
    detail: e.location,
  }));
}

/** Vagas open-entry do nível do aluno, uma leitura por matrícula open-entry ativa. */
async function studentSlotItems(ctx: ServiceContext, f: AgendaFilters, studentId: string): Promise<AgendaItem[]> {
  const list = await ctx.db
    .select({ id: enrollment.id })
    .from(enrollment)
    .where(and(eq(enrollment.studentId, studentId), eq(enrollment.regime, "open_entry"), isNull(enrollment.endedAt)));
  const from = dateInZone(f.from, ctx.timezone);
  const to = dateInZone(f.to, ctx.timezone);
  const items: AgendaItem[] = [];
  for (const e of list) {
    for (const s of await listOpenSlots(ctx, e.id, { from, to })) {
      if (s.mine || s.full) continue;
      items.push({ type: "aula", id: s.id, title: s.className, startsAt: s.startsAt, endsAt: s.endsAt, state: "vaga", cancelled: false, color: null, detail: `${s.teacherName ?? "sem professor"} · ${s.seatsLeft} vaga(s)`, seatsLeft: s.seatsLeft });
    }
  }
  return items;
}

/**
 * Leitura unificada: aula e evento continuam em tabelas separadas (§5.10).
 * Cancelado vem junto, marcado; quem mostra decide riscar.
 */
export async function agendaItems(ctx: ServiceContext, f: AgendaFilters, scope: AgendaScope): Promise<AgendaItem[]> {
  if (scope.kind === "aluno" && f.openSlots) return studentSlotItems(ctx, f, scope.studentId);
  const [lessons, events] = await Promise.all([lessonItems(ctx, f, scope), eventItems(ctx, f, scope)]);
  return [...lessons, ...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Pessoas que podem ser participantes, com o papel de cada uma para a tela. */
export async function agendaPeople(ctx: ServiceContext) {
  const rows = await ctx.db
    .select({
      id: person.id,
      name: person.name,
      isTeacher: sql<boolean>`exists (select 1 from teacher t where t.person_id = ${person.id} and t.deactivated_at is null)`,
      isStudent: sql<boolean>`exists (select 1 from student s where s.person_id = ${person.id} and s.status not in ('cancelado', 'inativo'))`,
      isStaff: sql<boolean>`exists (select 1 from membership m where m.person_id = ${person.id} and m.tenant_id = ${ctx.tenantId} and m.profile_type in ('admin', 'colaborador') and m.deactivated_at is null)`,
      isPedagogical: sql<boolean>`exists (select 1 from membership m where m.person_id = ${person.id} and m.tenant_id = ${ctx.tenantId} and m.deactivated_at is null and (m.profile_type = 'admin' or (m.profile_type = 'colaborador' and m.areas ? 'ped')))`,
      isLead: sql<boolean>`exists (select 1 from lead l where l.person_id = ${person.id} and l.stage not in ('matriculado', 'perdido'))`,
    })
    .from(person)
    .where(eq(person.tenantId, ctx.tenantId))
    .orderBy(asc(person.name));
  return rows
    .filter((r) => r.isTeacher || r.isStudent || r.isStaff || r.isLead)
    .map((r) => ({
      id: r.id,
      name: r.name,
      roles: [r.isStaff && "equipe", r.isTeacher && "professor", r.isStudent && "aluno", r.isLead && "lead"].filter(Boolean) as string[],
      canEvaluate: r.isTeacher || r.isPedagogical,
    }));
}
