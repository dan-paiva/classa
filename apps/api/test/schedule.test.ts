import {
  course,
  courseModule,
  creditEntry,
  DEFAULT_TENANT_SETTINGS,
  eq,
  lesson,
  lessonStudent,
  tenant,
  type Database,
} from "@classa/db";
import { createTestDb } from "@classa/db/testing";
import { cpfFromBase, slotKey } from "@classa/domain";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/services/context.ts";
import { balanceOf, createEnrollment, endEnrollment, listEnrollments } from "../src/services/enrollments.ts";
import { cancelLesson, cancelStudentLesson, changeLessonTeacher, concludeLesson, markUnfinishedLessons, setAttendance } from "../src/services/lessons.ts";
import { createRoom, createStudent, createTeacher, setStudentStatus } from "../src/services/people.ts";
import { createClassGroup, generateLessons, importNationalHolidays, listLessons } from "../src/services/schedule.ts";

let db: Database;
let base: Omit<ServiceContext, "now">;
const at = (iso: string): ServiceContext => ({ ...base, now: new Date(iso) });
const evenings = [1, 2, 3, 4, 5].flatMap((d) => [18, 19, 20].map((h) => slotKey(d, h)));

let courseId: string;
let moduleId: string;
let teacherA: string;
let teacherB: string;
let roomId: string;

beforeAll(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenant).values({ name: "Escola Teste", slug: "teste", settings: DEFAULT_TENANT_SETTINGS }).returning();
  base = { db, tenantId: t!.id, actorId: null, timezone: "America/Sao_Paulo", settings: DEFAULT_TENANT_SETTINGS };
  const [c] = await db
    .insert(course)
    .values({
      tenantId: t!.id,
      name: "Inglês em grupo",
      type: "grupo",
      color: "#1e46c8",
      capacity: 2,
      lessonMinutes: 60,
      packageLessons: 10,
      cancelNoticeHours: 6,
      lessonPriceCents: 6000,
      modalities: ["online"],
    })
    .returning();
  courseId = c!.id;
  const [m] = await db.insert(courseModule).values({ tenantId: t!.id, courseId, name: "Nível 1", color: "#1e46c8", position: 1 }).returning();
  moduleId = m!.id;
  const ctx = at("2026-09-01T12:00:00Z");
  await importNationalHolidays(ctx, 2026);
  teacherA = (await createTeacher(ctx, { person: { name: "Professora A", email: "a@t.dev" }, availability: evenings, courses: [{ courseId, moduleIds: null }] })).id;
  teacherB = (await createTeacher(ctx, { person: { name: "Professor B", email: "b@t.dev" }, availability: evenings, courses: [{ courseId, moduleIds: [moduleId] }] })).id;
  roomId = (await createRoom(ctx, { name: "Sala virtual 1", kind: "virtual", link: "https://meet.exemplo.dev/sala-1" })).id;
});

describe("turmas e aulas", () => {
  it("recusa horário fora da disponibilidade do professor", async () => {
    await expect(
      createClassGroup(at("2026-09-01T12:00:00Z"), {
        courseId, moduleId, name: "Manhã", teacherId: teacherA, roomId, startsOn: "2026-09-01", endsOn: "2026-12-18",
        schedules: [{ weekday: 1, startTime: "09:00" }],
      }),
    ).rejects.toMatchObject({ status: 400, issues: { teacherId: ["Horário fora da disponibilidade do professor"] } });
  });

  it("gera aulas sem feriado e barra choque de professor no banco", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const { classGroup: t1 } = await createClassGroup(ctx, {
      courseId, moduleId, name: "Turma 1", teacherId: teacherA, roomId, startsOn: "2026-09-01", endsOn: "2026-09-30",
      schedules: [{ weekday: 1, startTime: "19:00" }],
    });
    const r1 = await generateLessons(ctx, t1.id, { from: "2026-09-01", to: "2026-09-30" });
    // segundas de setembro/2026: 7 (feriado), 14, 21, 28
    expect(r1.created).toBe(3);
    expect(r1.skipped).toEqual([{ date: "2026-09-07", startTime: "19:00", reason: "feriado" }]);

    const again = await generateLessons(ctx, t1.id, { from: "2026-09-01", to: "2026-09-30" });
    expect(again).toMatchObject({ created: 0, existing: 3 });

    const { classGroup: t2 } = await createClassGroup(ctx, {
      courseId, moduleId, name: "Turma 2", teacherId: teacherA, startsOn: "2026-09-01", endsOn: "2026-09-30",
      schedules: [{ weekday: 1, startTime: "19:30" }],
    });
    const r2 = await generateLessons(ctx, t2.id, { from: "2026-09-01", to: "2026-09-30" });
    expect(r2.created).toBe(0);
    expect(r2.conflicts).toHaveLength(3);
  });
});

describe("matrícula, presença e créditos", () => {
  let classId: string;
  let studentIds: string[];

  beforeAll(async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const { classGroup } = await createClassGroup(ctx, {
      courseId, moduleId, name: "Turma quarta", teacherId: teacherB, roomId, startsOn: "2026-09-01", endsOn: "2026-10-31",
      schedules: [{ weekday: 3, startTime: "18:00" }],
    });
    classId = classGroup.id;
    await generateLessons(ctx, classId, { from: "2026-09-01", to: "2026-10-31" });
    studentIds = [];
    for (const [i, name] of ["Aluna Um", "Aluno Dois", "Aluna Três"].entries()) {
      studentIds.push((await createStudent(ctx, { person: { name, cpf: cpfFromBase(`10000000${i}`) } })).id);
    }
  });

  it("matrícula lança o pacote e inscreve nas aulas; turma cheia bloqueia", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const e1 = await createEnrollment(ctx, { studentId: studentIds[0]!, classGroupId: classId });
    await createEnrollment(ctx, { studentId: studentIds[1]!, classGroupId: classId });
    expect(await balanceOf(db, e1.id)).toBe(10);
    const inscritas = await db.select().from(lessonStudent).where(eq(lessonStudent.enrollmentId, e1.id));
    expect(inscritas.length).toBe(9); // quartas de 2/9 a 28/10
    await expect(createEnrollment(ctx, { studentId: studentIds[2]!, classGroupId: classId })).rejects.toMatchObject({ status: 422 });
  });

  it("presença e falta gastam crédito na conclusão; cancelamento a tempo não", async () => {
    const [e1, e2] = await listEnrollments(at("2026-09-01T12:00:00Z"), { classGroupId: classId });
    const lessons = await listLessons(at("2026-09-01T12:00:00Z"), { from: new Date("2026-09-01"), to: new Date("2026-11-01"), classGroupId: classId });
    const [aula1, aula2] = lessons;

    // aula 1 (2/9 18h): um presente, um falta
    await expect(setAttendance(at("2026-09-01T12:00:00Z"), aula1!.id, [{ enrollmentId: e1!.id, status: "presente" }])).rejects.toMatchObject({ status: 422 });
    const dia = at("2026-09-02T22:00:00Z");
    await setAttendance(dia, aula1!.id, [
      { enrollmentId: e1!.id, status: "presente" },
      { enrollmentId: e2!.id, status: "falta" },
    ]);
    await concludeLesson(dia, aula1!.id);
    expect(await balanceOf(db, e1!.id)).toBe(9);
    expect(await balanceOf(db, e2!.id)).toBe(9);
    await expect(concludeLesson(dia, aula1!.id)).rejects.toMatchObject({ status: 422 });

    // aula 2 (9/9 18h): e1 cancela com 1 dia de antecedência, e2 cancela 2h antes
    await cancelStudentLesson(at("2026-09-08T21:00:00Z"), aula2!.id, e1!.id);
    await cancelStudentLesson(at("2026-09-09T19:00:00Z"), aula2!.id, e2!.id);
    const semTodos = at("2026-09-09T22:00:00Z");
    await concludeLesson(semTodos, aula2!.id);
    expect(await balanceOf(db, e1!.id)).toBe(9);
    expect(await balanceOf(db, e2!.id)).toBe(8);
    const kinds = await db.select({ kind: creditEntry.kind }).from(creditEntry).where(eq(creditEntry.enrollmentId, e2!.id));
    expect(kinds.map((k) => k.kind).sort()).toEqual(["cancelamento_tardio", "contratacao", "falta"]);
  });

  it("concluir exige presença de todos", async () => {
    const lessons = await listLessons(at("2026-09-01T12:00:00Z"), { from: new Date("2026-09-15"), to: new Date("2026-09-17"), classGroupId: classId });
    await expect(concludeLesson(at("2026-09-16T22:00:00Z"), lessons[0]!.id)).rejects.toMatchObject({ status: 422 });
  });

  it("job marca aula passada sem conclusão como não finalizada", async () => {
    const n = await markUnfinishedLessons(at("2026-09-17T12:00:00Z"));
    expect(n).toBeGreaterThan(0);
    const [l] = await listLessons(at("2026-09-17T12:00:00Z"), { from: new Date("2026-09-15"), to: new Date("2026-09-17"), classGroupId: classId });
    expect(l!.state).toBe("nao_finalizada");
  });

  it("cancelar aula só antes do início; trocar professor valida habilitação", async () => {
    const [futura] = await listLessons(at("2026-09-20T12:00:00Z"), { from: new Date("2026-09-23"), to: new Date("2026-09-24"), classGroupId: classId });
    await cancelLesson(at("2026-09-20T12:00:00Z"), futura!.id, "Professor em evento");
    await cancelLesson(at("2026-09-20T12:00:00Z"), futura!.id, "", true);
    await changeLessonTeacher(at("2026-09-20T12:00:00Z"), futura!.id, teacherA);
    const [depois] = await db.select().from(lesson).where(eq(lesson.id, futura!.id));
    expect(depois).toMatchObject({ teacherId: teacherA, originalTeacherId: teacherB });
  });

  it("encerrar matrícula tira das aulas futuras; cancelar aluno encerra as matrículas", async () => {
    const [e1, e2] = await listEnrollments(at("2026-09-20T12:00:00Z"), { classGroupId: classId });
    await endEnrollment(at("2026-09-20T12:00:00Z"), e1!.id);
    const futuras = await listLessons(at("2026-09-20T12:00:00Z"), { from: new Date("2026-09-21"), to: new Date("2026-11-01"), studentId: e1!.studentId });
    expect(futuras).toEqual([]);

    await setStudentStatus(at("2026-09-20T12:00:00Z"), e2!.studentId, "cancelado");
    const [depois] = await listEnrollments(at("2026-09-20T12:00:00Z"), { studentId: e2!.studentId });
    expect(depois!.endedAt).not.toBeNull();
    const reativado = await setStudentStatus(at("2026-09-21T12:00:00Z"), e2!.studentId, "reativar");
    expect(reativado.status).toBe("ativo");
  });
});
