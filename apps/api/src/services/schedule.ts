import {
  and,
  asc,
  classGroup,
  classSchedule,
  course,
  courseModule,
  enrollment,
  eq,
  gte,
  holiday,
  inArray,
  isNull,
  lesson,
  lessonStudent,
  lt,
  lte,
  person,
  room,
  sql,
  teacher,
  type Modality,
  type ClassRegime,
} from "@classa/db";
import { addDays, dateInZone, fitsAvailability, generateLessonSlots, nationalHolidays } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { conflict, invalid, notFound, unprocessable } from "../http/errors.ts";
import { isUniqueViolation, pgErrorCode } from "../http/pg-errors.ts";
import type { Db, ServiceContext } from "./context.ts";
import { isQualified } from "./people.ts";

const allowsModules = (type: string) => type === "grupo" || type === "turmas_dedicadas";

/* ---------------------------------------------------------------- feriados */

export async function importNationalHolidays(ctx: ServiceContext, year: number) {
  const rows = nationalHolidays(year).map((h) => ({ ...h, tenantId: ctx.tenantId, kind: "nacional" as const }));
  const inserted = await ctx.db.insert(holiday).values(rows).onConflictDoNothing().returning();
  if (inserted.length) {
    await audit(ctx.db, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      entity: "holiday",
      entityId: String(year),
      action: "import",
      after: inserted.map((h) => h.date),
    });
  }
  return inserted;
}

export async function addRecess(ctx: ServiceContext, input: { from: string; to: string; name: string }) {
  if (input.to < input.from) throw invalid("to", "O último dia precisa ser depois do primeiro");
  const days: string[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) days.push(d);
  if (days.length > 60) throw invalid("to", "Recesso de no máximo 60 dias");
  const inserted = await ctx.db
    .insert(holiday)
    .values(days.map((date) => ({ tenantId: ctx.tenantId, date, name: input.name, kind: "recesso" as const })))
    .onConflictDoNothing()
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "holiday", entityId: input.from, action: "create", after: inserted });
  return inserted;
}

export async function listHolidays(ctx: ServiceContext, from: string, to: string) {
  return ctx.db
    .select()
    .from(holiday)
    .where(and(eq(holiday.tenantId, ctx.tenantId), gte(holiday.date, from), lte(holiday.date, to)))
    .orderBy(asc(holiday.date));
}

/* ------------------------------------------------------------------ turmas */

export type ScheduleInput = { weekday: number; startTime: string };

export type ClassGroupInput = {
  courseId: string;
  moduleId?: string | null;
  name: string;
  teacherId?: string | null;
  roomId?: string | null;
  modality?: Modality;
  capacity?: number;
  startsOn: string;
  endsOn: string;
  schedules: ScheduleInput[];
  individual?: boolean;
  regime?: ClassRegime;
};

async function loadCourse(db: Db, ctx: ServiceContext, courseId: string) {
  const [row] = await db
    .select()
    .from(course)
    .where(and(eq(course.id, courseId), eq(course.tenantId, ctx.tenantId)));
  if (!row) throw invalid("courseId", "Curso não encontrado");
  return row;
}

/** Aviso de carga: devolve a carga semanal nova do professor e o teto. */
async function teacherLoad(db: Db, ctx: ServiceContext, teacherId: string, extraLessons: number, ignoreClassGroupId?: string) {
  const [t] = await db.select({ weeklyLimit: teacher.weeklyLimit }).from(teacher).where(eq(teacher.id, teacherId));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(classSchedule)
    .innerJoin(classGroup, eq(classGroup.id, classSchedule.classGroupId))
    .where(
      and(
        eq(classGroup.teacherId, teacherId),
        isNull(classGroup.deactivatedAt),
        sql`${classGroup.endsOn} >= ${ctx.now.toISOString().slice(0, 10)}`,
        ignoreClassGroupId ? sql`${classGroup.id} <> ${ignoreClassGroupId}` : sql`true`,
      ),
    );
  return { load: (row?.n ?? 0) + extraLessons, limit: t?.weeklyLimit ?? 24 };
}

export async function validateClassGroup(db: Db, ctx: ServiceContext, input: ClassGroupInput, ignoreClassGroupId?: string) {
  const c = await loadCourse(db, ctx, input.courseId);
  if (c.deactivatedAt) throw unprocessable("O curso está inativo.");
  const name = input.name.trim();
  if (name.length < 2) throw invalid("name", "Nome da turma precisa de pelo menos 2 caracteres");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn)) {
    throw invalid("startsOn", "Informe início e fim da turma");
  }
  if (input.endsOn < input.startsOn) throw invalid("endsOn", "O fim precisa ser depois do início");

  let moduleId = input.moduleId ?? null;
  if (allowsModules(c.type)) {
    if (!moduleId) throw invalid("moduleId", c.type === "turmas_dedicadas" ? "Escolha a turma do contrato" : "Escolha o módulo");
    const [m] = await db.select().from(courseModule).where(and(eq(courseModule.id, moduleId), eq(courseModule.courseId, c.id)));
    if (!m) throw invalid("moduleId", "Módulo não pertence ao curso");
    if (m.deactivatedAt) throw invalid("moduleId", "Módulo inativo");
  } else {
    moduleId = null;
  }

  const modality = input.modality ?? c.modalities[0]!;
  if (!c.modalities.includes(modality)) throw invalid("modality", "Modalidade não aceita por este curso");

  // `individual` continua aceito por compatibilidade: é o regime particular dito de outro jeito
  const regime: ClassRegime = c.type === "particular" || input.individual ? "particular" : (input.regime ?? "regular");
  if (regime === "open_entry" && !moduleId) throw invalid("regime", "Oferta open-entry precisa de um módulo: é o nível que o aluno vai reservar.");
  const capacity = regime === "particular" ? 1 : (input.capacity ?? c.capacity);
  if (capacity < 1) throw invalid("capacity", "Vagas precisa ser maior que zero");

  if (input.schedules.length === 0) throw invalid("schedules", "Informe ao menos um horário");
  const schedules = input.schedules.map((s) => {
    if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 6) throw invalid("schedules", "Dia da semana de segunda a sábado");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.startTime.slice(0, 5))) throw invalid("schedules", "Horário no formato HH:MM");
    return { weekday: s.weekday, startTime: s.startTime.slice(0, 5) };
  });
  const keys = new Set(schedules.map((s) => `${s.weekday}-${s.startTime}`));
  if (keys.size !== schedules.length) throw invalid("schedules", "Horário repetido");

  // horário de funcionamento
  for (const s of schedules) {
    const day = ctx.settings.operatingHours.find((d) => d.weekday === s.weekday);
    const [h, mm] = s.startTime.split(":").map(Number);
    const start = h! * 60 + mm!;
    const end = start + c.lessonMinutes;
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    if (!day || "closed" in day || start < toMin(day.open) || end > toMin(day.close)) {
      throw invalid("schedules", "Horário fora do funcionamento da escola");
    }
  }

  const warnings: string[] = [];
  if (input.teacherId) {
    const [t] = await db.select().from(teacher).where(and(eq(teacher.id, input.teacherId), eq(teacher.tenantId, ctx.tenantId)));
    if (!t) throw invalid("teacherId", "Professor não encontrado");
    if (!(await isQualified(db, t.id, c.id, moduleId))) throw invalid("teacherId", "Professor inativo ou não habilitado neste curso/módulo");
    const outside = schedules.filter((s) => !fitsAvailability(t.availability, s.weekday, s.startTime, c.lessonMinutes));
    if (outside.length) throw invalid("teacherId", "Horário fora da disponibilidade do professor");
    const { load, limit } = await teacherLoad(db, ctx, t.id, schedules.length, ignoreClassGroupId);
    if (load > limit) warnings.push(`O professor fica com ${load} aulas por semana, acima do teto de ${limit}.`);
  }

  if (input.roomId) {
    const [r] = await db.select().from(room).where(and(eq(room.id, input.roomId), eq(room.tenantId, ctx.tenantId)));
    if (!r || r.deactivatedAt) throw invalid("roomId", "Sala não encontrada ou inativa");
    if ((modality === "online") !== (r.kind === "virtual")) {
      throw invalid("roomId", modality === "online" ? "Aula online precisa de sala virtual" : "Aula presencial precisa de sala física");
    }
    if (r.capacity && capacity > r.capacity) warnings.push(`A sala comporta ${r.capacity} pessoas e a turma tem ${capacity} vagas.`);
  }

  return {
    course: c,
    values: {
      tenantId: ctx.tenantId,
      courseId: c.id,
      moduleId,
      name,
      teacherId: input.teacherId ?? null,
      roomId: input.roomId ?? null,
      modality,
      capacity,
      regime,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
    },
    schedules,
    warnings,
  };
}

export async function createClassGroup(ctx: ServiceContext, input: ClassGroupInput) {
  const v = await validateClassGroup(ctx.db, ctx, input);
  try {
    const created = await ctx.db.transaction(async (tx) => {
      const [row] = await tx.insert(classGroup).values(v.values).returning();
      await tx.insert(classSchedule).values(v.schedules.map((s) => ({ ...s, tenantId: ctx.tenantId, classGroupId: row!.id })));
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "class_group", entityId: row!.id, action: "create", after: { ...row, schedules: v.schedules } });
      return row!;
    });
    return { classGroup: created, warnings: v.warnings };
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("name", "Já existe uma turma com esse nome neste curso");
    throw err;
  }
}

export async function getClassGroupRow(db: Db, ctx: ServiceContext, id: string) {
  const [row] = await db
    .select()
    .from(classGroup)
    .where(and(eq(classGroup.id, id), eq(classGroup.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Turma");
  return row;
}

/** Turmas com curso, módulo, professor, sala, horários e ocupação. */
export async function listClassGroups(ctx: ServiceContext, filters: { id?: string; courseId?: string; teacherId?: string } = {}) {
  const rows = await ctx.db
    .select({
      classGroup,
      courseName: course.name,
      courseColor: course.color,
      courseType: course.type,
      moduleName: courseModule.name,
      teacherName: person.name,
      roomName: room.name,
    })
    .from(classGroup)
    .innerJoin(course, eq(course.id, classGroup.courseId))
    .leftJoin(courseModule, eq(courseModule.id, classGroup.moduleId))
    .leftJoin(teacher, eq(teacher.id, classGroup.teacherId))
    .leftJoin(person, eq(person.id, teacher.personId))
    .leftJoin(room, eq(room.id, classGroup.roomId))
    .where(
      and(
        eq(classGroup.tenantId, ctx.tenantId),
        filters.id ? eq(classGroup.id, filters.id) : undefined,
        filters.courseId ? eq(classGroup.courseId, filters.courseId) : undefined,
        filters.teacherId ? eq(classGroup.teacherId, filters.teacherId) : undefined,
      ),
    )
    .orderBy(asc(course.name), asc(classGroup.name));
  const ids = rows.map((r) => r.classGroup.id);
  if (ids.length === 0) return [];
  const schedules = await ctx.db.select().from(classSchedule).where(inArray(classSchedule.classGroupId, ids));
  const occupancy = await ctx.db
    .select({ classGroupId: enrollment.classGroupId, n: sql<number>`count(*)::int` })
    .from(enrollment)
    .where(and(inArray(enrollment.classGroupId, ids), isNull(enrollment.endedAt)))
    .groupBy(enrollment.classGroupId);
  return rows.map((r) => ({
    ...r.classGroup,
    courseName: r.courseName,
    courseColor: r.courseColor,
    courseType: r.courseType,
    moduleName: r.moduleName,
    teacherName: r.teacherName,
    roomName: r.roomName,
    schedules: schedules
      .filter((s) => s.classGroupId === r.classGroup.id)
      .map((s) => ({ weekday: s.weekday, startTime: s.startTime.slice(0, 5) }))
      .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
    enrolled: occupancy.find((o) => o.classGroupId === r.classGroup.id)?.n ?? 0,
  }));
}

/* -------------------------------------------------------------------- aulas */

export type GenerationResult = {
  created: number;
  existing: number;
  skipped: { date: string; startTime: string; reason: string }[];
  conflicts: { date: string; startTime: string }[];
};

/**
 * Gera as aulas da turma no intervalo e inscreve os alunos das matrículas ativas.
 * Aula que já existe fica como está; choque de professor ou sala vira conflito listado.
 */
export async function generateLessons(ctx: ServiceContext, classGroupId: string, range: { from: string; to: string }): Promise<GenerationResult> {
  const cg = await getClassGroupRow(ctx.db, ctx, classGroupId);
  if (cg.deactivatedAt) throw unprocessable("A turma está inativa.");
  const c = await loadCourse(ctx.db, ctx, cg.courseId);
  const schedules = await ctx.db.select().from(classSchedule).where(eq(classSchedule.classGroupId, cg.id));
  const holidays = await listHolidays(ctx, range.from, range.to);
  const { slots, skipped } = generateLessonSlots({
    period: { startsOn: cg.startsOn, endsOn: cg.endsOn },
    range,
    schedules: schedules.map((s) => ({ weekday: s.weekday, startTime: s.startTime })),
    lessonMinutes: c.lessonMinutes,
    holidays: new Set(holidays.map((h) => h.date)),
    operatingHours: ctx.settings.operatingHours,
    timeZone: ctx.timezone,
  });

  const result: GenerationResult = { created: 0, existing: 0, skipped, conflicts: [] };
  const createdIds: string[] = [];
  for (const slot of slots) {
    try {
      const inserted = await ctx.db.transaction(async (tx) =>
        tx
          .insert(lesson)
          .values({
            tenantId: ctx.tenantId,
            classGroupId: cg.id,
            courseId: cg.courseId,
            moduleId: cg.moduleId,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            teacherId: cg.teacherId,
            roomId: cg.roomId,
          })
          .onConflictDoNothing({ target: [lesson.classGroupId, lesson.startsAt] })
          .returning({ id: lesson.id }),
      );
      if (inserted.length) {
        result.created++;
        createdIds.push(inserted[0]!.id);
      } else {
        result.existing++;
      }
    } catch (err) {
      if (pgErrorCode(err) === "23P01") result.conflicts.push({ date: slot.date, startTime: slot.startTime });
      else throw err;
    }
  }

  if (createdIds.length) {
    const active = await ctx.db
      .select()
      .from(enrollment)
      .where(and(eq(enrollment.classGroupId, cg.id), isNull(enrollment.endedAt)));
    const newLessons = await ctx.db.select({ id: lesson.id, startsAt: lesson.startsAt }).from(lesson).where(inArray(lesson.id, createdIds));
    const rows = active.flatMap((e) =>
      newLessons
        .filter((l) => dateInZone(l.startsAt, ctx.timezone) >= e.startsOn && dateInZone(l.startsAt, ctx.timezone) <= e.endsOn)
        .map((l) => ({ tenantId: ctx.tenantId, lessonId: l.id, enrollmentId: e.id, studentId: e.studentId })),
    );
    if (rows.length) await ctx.db.insert(lessonStudent).values(rows).onConflictDoNothing();
    await audit(ctx.db, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      entity: "class_group",
      entityId: cg.id,
      action: "update",
      after: { generated: result.created, range, conflicts: result.conflicts.length },
    });
  }
  return result;
}

/** Aulas de um intervalo, com nomes e contagem de inscritos e presenças. */
export async function listLessons(
  ctx: ServiceContext,
  filters: { from: Date; to: Date; id?: string; teacherId?: string; classGroupId?: string; courseId?: string; studentId?: string },
) {
  const originalPerson = sql<string | null>`(select p2.name from teacher t2 join person p2 on p2.id = t2.person_id where t2.id = ${lesson.originalTeacherId})`;
  const rows = await ctx.db
    .select({
      lesson,
      className: classGroup.name,
      individual: classGroup.individual,
      capacity: classGroup.capacity,
      modality: classGroup.modality,
      courseName: course.name,
      courseColor: course.color,
      moduleName: courseModule.name,
      teacherName: person.name,
      originalTeacherName: originalPerson,
      roomName: room.name,
      roomLink: room.link,
      enrolled: sql<number>`(select count(*)::int from lesson_student ls where ls.lesson_id = ${lesson.id} and ls.status <> 'cancelou')`,
      present: sql<number>`(select count(*)::int from lesson_student ls where ls.lesson_id = ${lesson.id} and ls.status = 'presente')`,
      absent: sql<number>`(select count(*)::int from lesson_student ls where ls.lesson_id = ${lesson.id} and ls.status = 'falta')`,
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
        filters.id ? eq(lesson.id, filters.id) : gte(lesson.startsAt, filters.from),
        filters.id ? undefined : lt(lesson.startsAt, filters.to),
        filters.teacherId ? eq(lesson.teacherId, filters.teacherId) : undefined,
        filters.classGroupId ? eq(lesson.classGroupId, filters.classGroupId) : undefined,
        filters.courseId ? eq(lesson.courseId, filters.courseId) : undefined,
        filters.studentId
          ? sql`exists (select 1 from lesson_student ls where ls.lesson_id = ${lesson.id} and ls.student_id = ${filters.studentId})`
          : undefined,
      ),
    )
    .orderBy(asc(lesson.startsAt));
  return rows.map((r) => ({
    ...r.lesson,
    className: r.className,
    individual: r.individual,
    capacity: r.capacity,
    modality: r.modality,
    courseName: r.courseName,
    courseColor: r.courseColor,
    moduleName: r.moduleName,
    teacherName: r.teacherName,
    originalTeacherName: r.originalTeacherName,
    roomName: r.roomName,
    roomLink: r.roomLink,
    enrolled: r.enrolled,
    present: r.present,
    absent: r.absent,
    flags: {
      semProfessor: r.lesson.state === "agendada" && !r.lesson.teacherId,
      semAlunos: r.lesson.state === "agendada" && r.enrolled === 0,
      substituida: !!r.lesson.originalTeacherId,
    },
  }));
}
