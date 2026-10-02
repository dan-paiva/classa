import { course, courseModule, creditEntry, DEFAULT_TENANT_SETTINGS, eq, tenant, type Database } from "@classa/db";
import { createTestDb } from "@classa/db/testing";
import { slotKey } from "@classa/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { bonusSummary } from "../src/services/bonus.ts";
import type { ServiceContext } from "../src/services/context.ts";
import { balanceOf, createEnrollment } from "../src/services/enrollments.ts";
import { concludeLesson, setAttendance } from "../src/services/lessons.ts";
import { reserveLesson } from "../src/services/open-entry.ts";
import { createStudent, createTeacher } from "../src/services/people.ts";
import { createClassGroup, generateLessons, listLessons } from "../src/services/schedule.ts";

/** Tipos de curso são regra (DOMINIO.md §4.1) e a aula private bônus do open entry (§5.9.1). */

let db: Database;
let base: Omit<ServiceContext, "now">;
const at = (iso: string): ServiceContext => ({ ...base, now: new Date(iso) });
let inicio: ServiceContext;

let tenantId = "";
let profId = "";
let open: { id: string };
let openLevel = "";
let regular: { id: string };
let regularLevel = "";
let priv: { id: string };

const mkCourse = async (name: string, type: "regular" | "open_entry" | "particular", capacity = 6) =>
  (
    await db
      .insert(course)
      .values({ tenantId, name, type, color: "#123456", capacity, lessonMinutes: 60, packageLessons: 20, cancelNoticeHours: 6, lessonPriceCents: 6000, modalities: ["online"] })
      .returning()
  )[0]!;
const mkLevel = async (courseId: string, name: string) =>
  (await db.insert(courseModule).values({ tenantId, courseId, name, color: "#123456", position: 1 }).returning())[0]!.id;

beforeAll(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenant).values({ name: "Escola Tipos", slug: "tipos" }).returning();
  tenantId = t!.id;
  base = { db, tenantId, actorId: null, timezone: "America/Sao_Paulo", settings: { ...DEFAULT_TENANT_SETTINGS, bonus: { enabled: true, every: 5 } } };
  inicio = at("2026-08-01T12:00:00Z");
  open = await mkCourse("Inglês Open", "open_entry");
  openLevel = await mkLevel(open.id, "Nível 1");
  regular = await mkCourse("Inglês Regular", "regular");
  regularLevel = await mkLevel(regular.id, "Nível 1");
  priv = await mkCourse("Inglês Private", "particular", 1);
  const prof = await createTeacher(inicio, {
    person: { name: "Prof Tipos" },
    availability: [slotKey(2, 19), slotKey(3, 19), slotKey(4, 19), slotKey(5, 19)],
    courses: [open, regular, priv].map((c) => ({ courseId: c.id, moduleIds: null })),
  });
  profId = prof.id;
});

const turma = (courseId: string, name: string, weekday: number, extra: Record<string, unknown> = {}) =>
  createClassGroup(inicio, { courseId, name, teacherId: profId, startsOn: "2026-08-01", endsOn: "2026-11-30", schedules: [{ weekday, startTime: "19:00" }], ...extra });

describe("o tipo do curso é a regra", () => {
  it("a turma herda o regime do tipo do curso e não aceita outro", async () => {
    const { classGroup } = await turma(open.id, "Open ter", 2, { moduleId: openLevel });
    expect(classGroup.regime).toBe("open_entry");
    await expect(turma(open.id, "Open fixa", 3, { moduleId: openLevel, regime: "regular" })).rejects.toThrow(/tipo do curso/);
    const { classGroup: r } = await turma(regular.id, "Regular qua", 3, { moduleId: regularLevel });
    expect(r.regime).toBe("regular");
  });

  it("open entry sem nível não publica horário", async () => {
    const semNivel = await mkCourse("Espanhol Open", "open_entry");
    await expect(turma(semNivel.id, "Open sem nível", 4)).rejects.toThrow(/ao menos um nível/);
  });

  it("private é sempre de 1 vaga, mesmo que peçam mais", async () => {
    const { classGroup } = await turma(priv.id, "Private qui", 4, { capacity: 5 });
    expect(classGroup).toMatchObject({ regime: "particular", capacity: 1, moduleId: null });
  });

  it("matrícula open entry fica no nível, sem turma; a regular precisa de turma", async () => {
    const s = await createStudent(inicio, { person: { name: "Aluno Formatos" } });
    const e = await createEnrollment(inicio, { studentId: s.id, courseId: open.id, moduleId: openLevel, contract: false });
    expect(e).toMatchObject({ regime: "open_entry", classGroupId: null, moduleId: openLevel });
    await expect(createEnrollment(inicio, { studentId: s.id, courseId: regular.id, contract: false })).rejects.toThrow(/turma/i);
  });
});

describe("aula private bônus", () => {
  it("a cada 5 presenças no open entry o aluno ganha uma aula private, que entra na matrícula private", async () => {
    const { classGroup } = await turma(open.id, "Open sex", 5, { moduleId: openLevel });
    await generateLessons(inicio, classGroup.id, { from: "2026-08-01", to: "2026-11-30" });
    const lessons = (await listLessons(inicio, { from: new Date("2026-08-01T03:00:00Z"), to: new Date("2026-12-01T03:00:00Z") })).filter(
      (l) => l.classGroupId === classGroup.id,
    );
    expect(lessons.length).toBeGreaterThanOrEqual(10);

    const s = await createStudent(inicio, { person: { name: "Aluna Bônus" } });
    const e = await createEnrollment(inicio, { studentId: s.id, courseId: open.id, moduleId: openLevel, packageLessons: 20, contract: false });
    const assistir = async (l: (typeof lessons)[number]) => {
      await reserveLesson(inicio, e.id, l.id);
      const depois = at(new Date(new Date(l.endsAt).getTime() + 10 * 60000).toISOString());
      await setAttendance(depois, l.id, [{ enrollmentId: e.id, status: "presente" }]);
      await concludeLesson(depois, l.id);
    };

    for (const l of lessons.slice(0, 4)) await assistir(l);
    expect(await bonusSummary(inicio, s.id)).toMatchObject({ presences: 4, earned: 0, nextIn: 1 });

    await assistir(lessons[4]!);
    // ganhou, mas ainda não tem matrícula private: fica guardado
    expect(await bonusSummary(inicio, s.id)).toMatchObject({ presences: 5, earned: 1, applied: 0, pending: 1, nextIn: 5 });

    // a matrícula private nasce com o bônus no extrato
    const { classGroup: p } = await turma(priv.id, "Private Aluna Bônus", 3);
    const ep = await createEnrollment(inicio, { studentId: s.id, classGroupId: p.id, packageLessons: 4, contract: false });
    expect(await balanceOf(db, ep.id)).toBe(5);
    expect(await bonusSummary(inicio, s.id)).toMatchObject({ earned: 1, applied: 1, pending: 0 });

    // com matrícula private ativa, o próximo bônus entra na hora
    for (const l of lessons.slice(5, 10)) await assistir(l);
    expect(await bonusSummary(inicio, s.id)).toMatchObject({ presences: 10, earned: 2, applied: 2 });
    const bonus = await db.select().from(creditEntry).where(eq(creditEntry.enrollmentId, ep.id));
    expect(bonus.filter((c) => c.kind === "bonus").map((c) => c.amount)).toEqual([1, 1]);
  });

  it("com a regra desligada ninguém ganha bônus", async () => {
    const off: ServiceContext = { ...inicio, settings: { ...DEFAULT_TENANT_SETTINGS, bonus: { enabled: false, every: 5 } } };
    const s = await createStudent(off, { person: { name: "Aluno Sem Bônus" } });
    expect(await bonusSummary(off, s.id)).toMatchObject({ earned: 0, nextIn: null });
  });
});
