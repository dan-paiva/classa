import {
  and,
  asc,
  classGroup,
  classSchedule,
  course,
  courseModule,
  enrollment,
  eq,
  inArray,
  isNull,
  person,
  room,
  sql,
  student,
  teacher,
  teacherCourse,
  type RoomKind,
  type StudentStatus,
} from "@classa/db";
import { isValidCpf, isValidSlot, onlyDigits } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { conflict, DomainError, invalid, notFound, unprocessable } from "../http/errors.ts";
import { isUniqueViolation, pgConstraint } from "../http/pg-errors.ts";
import type { Db, ServiceContext } from "./context.ts";
import { endEnrollmentTx } from "./enrollments.ts";

/* ------------------------------------------------------------------ pessoa */

export type PersonInput = {
  name: string;
  email?: string | null;
  cpf?: string | null;
  phone?: string | null;
  birthDate?: string | null;
};

function normalizePerson(input: PersonInput) {
  const name = input.name.trim();
  if (name.length < 2) throw invalid("name", "Nome precisa de pelo menos 2 caracteres");
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid("email", "E-mail inválido");
  const cpf = input.cpf ? onlyDigits(input.cpf) : null;
  if (cpf && !isValidCpf(cpf)) throw invalid("cpf", "CPF inválido");
  const phone = input.phone ? onlyDigits(input.phone) : null;
  if (phone && (phone.length < 10 || phone.length > 11)) throw invalid("phone", "Telefone com DDD, 10 ou 11 dígitos");
  return { name, email, cpf, phone, birthDate: input.birthDate || null };
}

/** Cria a pessoa. E-mail ou CPF repetido vira 409 com o id da pessoa que já existe. */
async function insertPerson(db: Db, ctx: ServiceContext, input: PersonInput) {
  const values = normalizePerson(input);
  // checa antes de inserir, na mesma conexão/transação (a constraint única continua garantindo)
  for (const field of ["cpf", "email"] as const) {
    const value = values[field];
    if (!value) continue;
    const [existing] = await db
      .select({ id: person.id, name: person.name })
      .from(person)
      .where(and(eq(person.tenantId, ctx.tenantId), field === "cpf" ? eq(person.cpf, value) : sql`lower(${person.email}) = ${value}`));
    if (existing) {
      throw new DomainError(409, "person_exists", `Já existe uma pessoa com este ${field === "cpf" ? "CPF" : "e-mail"}: ${existing.name}.`, {
        [field]: ["Já cadastrado"],
        existingPersonId: [existing.id],
      });
    }
  }
  try {
    const [row] = await db
      .insert(person)
      .values({ ...values, tenantId: ctx.tenantId })
      .returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const field = pgConstraint(err) === "person_tenant_cpf_uq" ? "cpf" : "email";
      throw conflict(field, `Já existe uma pessoa com este ${field === "cpf" ? "CPF" : "e-mail"}.`);
    }
    throw err;
  }
}

async function resolvePerson(db: Db, ctx: ServiceContext, input: { personId?: string; person?: PersonInput }) {
  if (input.personId) {
    const [row] = await db
      .select()
      .from(person)
      .where(and(eq(person.id, input.personId), eq(person.tenantId, ctx.tenantId)));
    if (!row) throw notFound("Pessoa");
    return row;
  }
  if (!input.person) throw invalid("name", "Informe a pessoa");
  return insertPerson(db, ctx, input.person);
}

export async function updatePerson(ctx: ServiceContext, personId: string, input: PersonInput) {
  const values = normalizePerson(input);
  const [before] = await ctx.db
    .select()
    .from(person)
    .where(and(eq(person.id, personId), eq(person.tenantId, ctx.tenantId)));
  if (!before) throw notFound("Pessoa");
  try {
    return await ctx.db.transaction(async (tx) => {
      const [row] = await tx.update(person).set(values).where(eq(person.id, personId)).returning();
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "person", entityId: personId, action: "update", before, after: row });
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const field = pgConstraint(err) === "person_tenant_cpf_uq" ? "cpf" : "email";
      throw conflict(field, `Outra pessoa já usa este ${field === "cpf" ? "CPF" : "e-mail"}.`);
    }
    throw err;
  }
}

function checkAvailability(values: number[] | undefined) {
  if (!values) return undefined;
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.some((v) => !isValidSlot(v))) throw invalid("availability", "Disponibilidade só de segunda a sábado, das 7h às 21h");
  return unique;
}

/* --------------------------------------------------------------- professor */

export type TeacherCourseInput = { courseId: string; moduleIds: string[] | null };

async function validateTeacherCourses(db: Db, ctx: ServiceContext, courses: TeacherCourseInput[]) {
  if (courses.length === 0) return;
  const courseIds = [...new Set(courses.map((c) => c.courseId))];
  const found = await db
    .select({ id: course.id })
    .from(course)
    .where(and(eq(course.tenantId, ctx.tenantId), inArray(course.id, courseIds)));
  if (found.length !== courseIds.length) throw invalid("courses", "Curso não encontrado");
  const moduleIds = courses.flatMap((c) => c.moduleIds ?? []);
  if (moduleIds.length > 0) {
    const mods = await db
      .select({ id: courseModule.id, courseId: courseModule.courseId })
      .from(courseModule)
      .where(and(eq(courseModule.tenantId, ctx.tenantId), inArray(courseModule.id, moduleIds)));
    for (const c of courses) {
      for (const m of c.moduleIds ?? []) {
        if (!mods.some((x) => x.id === m && x.courseId === c.courseId)) {
          throw invalid("courses", "Módulo não pertence ao curso");
        }
      }
    }
  }
}

export async function createTeacher(
  ctx: ServiceContext,
  input: {
    personId?: string;
    person?: PersonInput;
    weeklyLimit?: number;
    hourlyRateCents?: number | null;
    availability?: number[];
    courses?: TeacherCourseInput[];
  },
) {
  const availability = checkAvailability(input.availability);
  if (input.weeklyLimit !== undefined && input.weeklyLimit < 1) throw invalid("weeklyLimit", "Teto semanal precisa ser maior que zero");
  return ctx.db.transaction(async (tx) => {
    const p = await resolvePerson(tx, ctx, input);
    await validateTeacherCourses(tx, ctx, input.courses ?? []);
    let row;
    try {
      [row] = await tx
        .insert(teacher)
        .values({
          tenantId: ctx.tenantId,
          personId: p.id,
          weeklyLimit: input.weeklyLimit ?? 24,
          hourlyRateCents: input.hourlyRateCents ?? null,
          availability: availability ?? [],
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("personId", "Esta pessoa já é professor.");
      throw err;
    }
    if (input.courses?.length) {
      await tx.insert(teacherCourse).values(
        input.courses.map((c) => ({ tenantId: ctx.tenantId, teacherId: row!.id, courseId: c.courseId, moduleIds: c.moduleIds })),
      );
    }
    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      entity: "teacher",
      entityId: row!.id,
      action: "create",
      after: { ...row, person: p, courses: input.courses ?? [] },
    });
    return row!;
  });
}

export async function getTeacherRow(db: Db, ctx: ServiceContext, id: string) {
  const [row] = await db
    .select()
    .from(teacher)
    .where(and(eq(teacher.id, id), eq(teacher.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Professor");
  return row;
}

export async function updateTeacher(
  ctx: ServiceContext,
  id: string,
  input: { weeklyLimit?: number; hourlyRateCents?: number | null; availability?: number[]; courses?: TeacherCourseInput[] },
) {
  const before = await getTeacherRow(ctx.db, ctx, id);
  const availability = checkAvailability(input.availability);
  return ctx.db.transaction(async (tx) => {
    if (input.courses) {
      await validateTeacherCourses(tx, ctx, input.courses);
      // não se tira habilitação de curso/módulo em que o professor é titular de turma ativa
      const titular = await tx
        .select({ courseId: classGroup.courseId, moduleId: classGroup.moduleId, name: classGroup.name })
        .from(classGroup)
        .where(and(eq(classGroup.teacherId, id), isNull(classGroup.deactivatedAt)));
      for (const t of titular) {
        const q = input.courses.find((c) => c.courseId === t.courseId);
        if (!q || (q.moduleIds && t.moduleId && !q.moduleIds.includes(t.moduleId))) {
          throw unprocessable(`O professor é titular da turma "${t.name}". Troque o professor da turma antes de tirar essa habilitação.`);
        }
      }
      await tx.delete(teacherCourse).where(eq(teacherCourse.teacherId, id));
      if (input.courses.length) {
        await tx.insert(teacherCourse).values(
          input.courses.map((c) => ({ tenantId: ctx.tenantId, teacherId: id, courseId: c.courseId, moduleIds: c.moduleIds })),
        );
      }
    }
    const patch = {
      ...(input.weeklyLimit !== undefined ? { weeklyLimit: input.weeklyLimit } : {}),
      ...(input.hourlyRateCents !== undefined ? { hourlyRateCents: input.hourlyRateCents } : {}),
      ...(availability ? { availability } : {}),
    };
    const [row] = Object.keys(patch).length
      ? await tx.update(teacher).set(patch).where(eq(teacher.id, id)).returning()
      : [before];
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "teacher", entityId: id, action: "update", before, after: { ...row, courses: input.courses } });
    return row!;
  });
}

export async function setTeacherActive(ctx: ServiceContext, id: string, active: boolean) {
  const before = await getTeacherRow(ctx.db, ctx, id);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(teacher)
      .set({ deactivatedAt: active ? null : (before.deactivatedAt ?? ctx.now) })
      .where(eq(teacher.id, id))
      .returning();
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "teacher", entityId: id, action: active ? "reactivate" : "deactivate", before, after: row });
    return row!;
  });
}

/** Lista com nome, cursos habilitados e carga semanal (aulas por semana nas turmas ativas). */
export async function listTeachers(ctx: ServiceContext) {
  const rows = await ctx.db
    .select({ teacher, person })
    .from(teacher)
    .innerJoin(person, eq(person.id, teacher.personId))
    .where(eq(teacher.tenantId, ctx.tenantId))
    .orderBy(asc(person.name));
  const courses = await ctx.db
    .select({ teacherId: teacherCourse.teacherId, courseId: teacherCourse.courseId, moduleIds: teacherCourse.moduleIds, courseName: course.name, color: course.color })
    .from(teacherCourse)
    .innerJoin(course, eq(course.id, teacherCourse.courseId))
    .where(eq(teacherCourse.tenantId, ctx.tenantId));
  const load = await ctx.db
    .select({ teacherId: classGroup.teacherId, lessons: sql<number>`count(*)::int` })
    .from(classSchedule)
    .innerJoin(classGroup, eq(classGroup.id, classSchedule.classGroupId))
    .where(and(eq(classGroup.tenantId, ctx.tenantId), isNull(classGroup.deactivatedAt), sql`${classGroup.endsOn} >= ${ctx.now.toISOString().slice(0, 10)}`))
    .groupBy(classGroup.teacherId);
  return rows.map(({ teacher: t, person: p }) => ({
    ...t,
    person: p,
    courses: courses.filter((c) => c.teacherId === t.id),
    weeklyLoad: load.find((l) => l.teacherId === t.id)?.lessons ?? 0,
  }));
}

/** Professor pode dar aula no curso/módulo? */
export async function isQualified(db: Db, teacherId: string, courseId: string, moduleId: string | null) {
  const [row] = await db
    .select({ moduleIds: teacherCourse.moduleIds, deactivatedAt: teacher.deactivatedAt })
    .from(teacherCourse)
    .innerJoin(teacher, eq(teacher.id, teacherCourse.teacherId))
    .where(and(eq(teacherCourse.teacherId, teacherId), eq(teacherCourse.courseId, courseId)));
  if (!row || row.deactivatedAt) return false;
  return row.moduleIds === null || moduleId === null || row.moduleIds.includes(moduleId);
}

/* ------------------------------------------------------------------- aluno */

export async function createStudent(
  ctx: ServiceContext,
  input: { personId?: string; person?: PersonInput; availability?: number[] },
) {
  const availability = checkAvailability(input.availability);
  return ctx.db.transaction(async (tx) => {
    const p = await resolvePerson(tx, ctx, input);
    let row;
    try {
      [row] = await tx
        .insert(student)
        .values({ tenantId: ctx.tenantId, personId: p.id, availability: availability ?? [] })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("personId", "Esta pessoa já é aluno.");
      throw err;
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "student", entityId: row!.id, action: "create", after: { ...row, person: p } });
    return row!;
  });
}

export async function getStudentRow(db: Db, ctx: ServiceContext, id: string) {
  const [row] = await db
    .select()
    .from(student)
    .where(and(eq(student.id, id), eq(student.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Aluno");
  return row;
}

/**
 * Muda a situação do aluno.
 * - inativo e cancelado guardam a situação anterior; reativar volta a ela.
 * - cancelado encerra as matrículas ativas.
 */
export async function setStudentStatus(ctx: ServiceContext, id: string, status: StudentStatus | "reativar") {
  const before = await getStudentRow(ctx.db, ctx, id);
  return ctx.db.transaction(async (tx) => {
    let next: StudentStatus;
    let previousStatus = before.previousStatus;
    if (status === "reativar") {
      if (before.status !== "inativo" && before.status !== "cancelado") throw unprocessable("O aluno já está ativo.");
      next = before.previousStatus && !["inativo", "cancelado"].includes(before.previousStatus) ? before.previousStatus : "ativo";
      previousStatus = null;
    } else {
      next = status;
      if ((status === "inativo" || status === "cancelado") && before.status !== status) previousStatus = before.status;
    }
    const [row] = await tx.update(student).set({ status: next, previousStatus }).where(eq(student.id, id)).returning();
    if (next === "cancelado") {
      const active = await tx
        .select({ id: enrollment.id })
        .from(enrollment)
        .where(and(eq(enrollment.studentId, id), isNull(enrollment.endedAt)));
      for (const e of active) await endEnrollmentTx(tx, ctx, e.id);
    }
    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      entity: "student",
      entityId: id,
      action: next === "cancelado" ? "cancel" : status === "reativar" ? "reactivate" : next === "inativo" ? "deactivate" : "update",
      before,
      after: row,
    });
    return row!;
  });
}

export async function updateStudentAvailability(ctx: ServiceContext, id: string, values: number[]) {
  const before = await getStudentRow(ctx.db, ctx, id);
  const availability = checkAvailability(values)!;
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.update(student).set({ availability }).where(eq(student.id, id)).returning();
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "student", entityId: id, action: "update", before, after: row });
    return row!;
  });
}

/* -------------------------------------------------------------------- sala */

export async function createRoom(ctx: ServiceContext, input: { name: string; kind: RoomKind; link?: string | null; capacity?: number | null }) {
  const name = input.name.trim();
  if (name.length < 2) throw invalid("name", "Nome precisa de pelo menos 2 caracteres");
  const link = input.link?.trim() || null;
  if (input.kind === "virtual" && !link) throw invalid("link", "Sala virtual precisa do link da reunião");
  if (link && !/^https?:\/\/\S+$/.test(link)) throw invalid("link", "Link precisa começar com https://");
  try {
    return await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(room)
        .values({ tenantId: ctx.tenantId, name, kind: input.kind, link, capacity: input.capacity ?? null })
        .returning();
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "room", entityId: row!.id, action: "create", after: row });
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("name", "Já existe uma sala com esse nome");
    throw err;
  }
}

export async function listRooms(ctx: ServiceContext) {
  return ctx.db.select().from(room).where(eq(room.tenantId, ctx.tenantId)).orderBy(asc(room.name));
}
