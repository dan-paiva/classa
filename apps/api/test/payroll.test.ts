import { course, DEFAULT_TENANT_SETTINGS, tenant, type Database } from "@classa/db";
import { createTestDb } from "@classa/db/testing";
import { slotKey } from "@classa/domain";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/services/context.ts";
import { createEnrollment } from "../src/services/enrollments.ts";
import { concludeLesson, markUnfinishedLessons, setAttendance } from "../src/services/lessons.ts";
import { closeMonth, computePayroll, markLinePaid, overrideLessonRate, reopenMonth, requestSupport, setClassGroupTeacherRate } from "../src/services/payroll.ts";
import { createStudent, createTeacher } from "../src/services/people.ts";
import { createClassGroup, generateLessons, listLessons } from "../src/services/schedule.ts";

let db: Database;
let base: Omit<ServiceContext, "now">;
const at = (iso: string): ServiceContext => ({ ...base, now: new Date(iso) });
let grupo: { id: string };
let particular: { id: string };
let enrollGrupo: string;
let enrollPart: string;

beforeAll(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenant).values({ name: "Escola Folha", slug: "folha" }).returning();
  base = { db, tenantId: t!.id, actorId: null, timezone: "America/Sao_Paulo", settings: DEFAULT_TENANT_SETTINGS };
  const ctx = at("2026-08-01T12:00:00Z");
  const [cg] = await db.insert(course).values({ tenantId: t!.id, name: "Grupo", type: "grupo", color: "#111111", capacity: 8, lessonMinutes: 60, packageLessons: 20, cancelNoticeHours: 6, lessonPriceCents: 5000, modalities: ["online"] }).returning();
  const [cp] = await db.insert(course).values({ tenantId: t!.id, name: "Particular", type: "particular", color: "#222222", capacity: 1, lessonMinutes: 60, packageLessons: 20, cancelNoticeHours: 24, lessonPriceCents: 12000, modalities: ["online"] }).returning();
  // curso em grupo exige módulo na turma
  const { courseModule } = await import("@classa/db");
  const [m] = await db.insert(courseModule).values({ tenantId: t!.id, courseId: cg!.id, name: "N1", color: "#111111", position: 1 }).returning();
  const prof = await createTeacher(ctx, {
    person: { name: "Prof Folha" },
    hourlyRateCents: 8000,
    availability: [slotKey(2, 19), slotKey(4, 19)],
    courses: [{ courseId: cg!.id, moduleIds: null }, { courseId: cp!.id, moduleIds: null }],
  });
  ({ classGroup: grupo } = await createClassGroup(ctx, { courseId: cg!.id, moduleId: m!.id, name: "Terça", teacherId: prof.id, startsOn: "2026-08-01", endsOn: "2026-09-30", schedules: [{ weekday: 2, startTime: "19:00" }] }));
  ({ classGroup: particular } = await createClassGroup(ctx, { courseId: cp!.id, name: "Particular", teacherId: prof.id, startsOn: "2026-08-01", endsOn: "2026-09-30", schedules: [{ weekday: 4, startTime: "19:00" }] }));
  await setClassGroupTeacherRate(ctx, particular.id, 15000);
  await generateLessons(ctx, grupo.id, { from: "2026-08-01", to: "2026-09-30" });
  await generateLessons(ctx, particular.id, { from: "2026-08-01", to: "2026-09-30" });
  const s1 = await createStudent(ctx, { person: { name: "A1" } });
  const s2 = await createStudent(ctx, { person: { name: "A2" } });
  enrollGrupo = (await createEnrollment(ctx, { studentId: s1.id, classGroupId: grupo.id, contract: false })).id;
  enrollPart = (await createEnrollment(ctx, { studentId: s2.id, classGroupId: particular.id, contract: false })).id;
});

async function concludeAugust(skipLast = false) {
  const lessons = await listLessons(at("2026-08-01T12:00:00Z"), { from: new Date("2026-08-01T03:00:00Z"), to: new Date("2026-09-01T03:00:00Z") });
  const list = skipLast ? lessons.slice(0, -1) : lessons;
  for (const l of list) {
    if (l.state === "concluida") continue;
    const after = at(new Date(new Date(l.endsAt).getTime() + 10 * 60000).toISOString());
    const enrollmentId = l.classGroupId === grupo.id ? enrollGrupo : enrollPart;
    await setAttendance(after, l.id, [{ enrollmentId, status: "presente" }]);
    await concludeLesson(after, l.id);
  }
  return lessons;
}

describe("folha de professores", () => {
  it("mês em andamento não fecha; aula não finalizada trava", async () => {
    await concludeAugust(true);
    await markUnfinishedLessons(at("2026-09-02T12:00:00Z"));
    const set = at("2026-09-02T12:00:00Z");
    await expect(closeMonth(at("2026-08-20T12:00:00Z"), "2026-08")).rejects.toMatchObject({ status: 422 });
    const p = await computePayroll(set, "2026-08");
    expect(p.status).toBe("travada");
    expect(p.totals.pendingLessons).toBe(1);
    await expect(closeMonth(set, "2026-08")).rejects.toMatchObject({ status: 422 });
  });

  it("valores: grupo por hora, particular fixo, ajuste por aula e suporte desconta", async () => {
    const lessons = await concludeAugust();
    const ctx = at("2026-09-02T12:00:00Z");
    const grupoAulas = lessons.filter((l) => l.classGroupId === grupo.id);
    const partAulas = lessons.filter((l) => l.classGroupId === particular.id);
    await requestSupport(ctx, grupoAulas[0]!.id, { reason: "tecnico", detail: "Plataforma caiu" });
    await overrideLessonRate(ctx, partAulas[0]!.id, { cents: 9000, reason: "Aula mais curta" });
    await expect(overrideLessonRate(ctx, grupoAulas[1]!.id, { cents: 1, reason: "x" })).rejects.toMatchObject({ status: 422 });

    const p = await computePayroll(ctx, "2026-08");
    expect(p.status).toBe("pronta");
    const [line] = p.lines;
    // agosto/2026: 4 terças (4, 11, 18, 25) e 4 quintas (6, 13, 20, 27)
    const gross = 4 * 8000 + 3 * 15000 + 9000;
    expect(line).toMatchObject({ paidLessons: 7, discountedLessons: 1, grossCents: gross, discountCents: 8000, netCents: gross - 8000 });
  });

  it("fechar grava o retrato, trava as aulas e reabrir exige justificativa", async () => {
    const ctx = at("2026-09-02T12:00:00Z");
    const period = await closeMonth(ctx, "2026-08");
    expect(period.netCents).toBe(4 * 8000 + 3 * 15000 + 9000 - 8000);
    const p = await computePayroll(ctx, "2026-08");
    expect(p.status).toBe("fechada");

    const lessons = await listLessons(ctx, { from: new Date("2026-08-01T03:00:00Z"), to: new Date("2026-09-01T03:00:00Z") });
    await expect(requestSupport(ctx, lessons[1]!.id, { reason: "outro" })).rejects.toMatchObject({ status: 422 });

    await markLinePaid(ctx, p.lines[0]!.lineId!, "2026-09-02");
    await expect(reopenMonth(ctx, "2026-08", "")).rejects.toMatchObject({ status: 400 });
    await reopenMonth(ctx, "2026-08", "Presença lançada errada");
    expect((await computePayroll(ctx, "2026-08")).status).toBe("pronta");
    await requestSupport(ctx, lessons[1]!.id, null);
    await closeMonth(ctx, "2026-08");
    expect((await computePayroll(ctx, "2026-08")).status).toBe("fechada");
  });
});
