import { course, courseModule, DEFAULT_TENANT_SETTINGS, tenant, type Database } from "@classa/db";
import { createTestDb } from "@classa/db/testing";
import { slotKey } from "@classa/domain";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/services/context.ts";
import { createEnrollment } from "../src/services/enrollments.ts";
import { listInstallments, registerPayment } from "../src/services/finance.ts";
import { concludeLesson, setAttendance } from "../src/services/lessons.ts";
import { createStudent, createTeacher } from "../src/services/people.ts";
import { alerts, attendanceReport, enrollmentReport, financeReport, lastMonths, teacherReport } from "../src/services/reports.ts";
import { createClassGroup, generateLessons, listLessons } from "../src/services/schedule.ts";

let db: Database;
let base: Omit<ServiceContext, "now">;
const at = (iso: string): ServiceContext => ({ ...base, now: new Date(iso) });
let august = 0;

const all = () => true;

beforeAll(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenant).values({ name: "Escola Relatórios", slug: "relatorios" }).returning();
  base = { db, tenantId: t!.id, actorId: null, timezone: "America/Sao_Paulo", settings: DEFAULT_TENANT_SETTINGS };
  const ctx = at("2026-08-01T12:00:00Z");

  const [c] = await db
    .insert(course)
    .values({ tenantId: t!.id, name: "Grupo", type: "grupo", color: "#111111", capacity: 8, lessonMinutes: 60, packageLessons: 20, cancelNoticeHours: 6, lessonPriceCents: 5000, modalities: ["online"] })
    .returning();
  const [m] = await db.insert(courseModule).values({ tenantId: t!.id, courseId: c!.id, name: "N1", color: "#111111", position: 1 }).returning();

  const prof = await createTeacher(ctx, {
    person: { name: "Prof Relatório" },
    hourlyRateCents: 8000,
    weeklyLimit: 2,
    availability: [slotKey(2, 19)],
    courses: [{ courseId: c!.id, moduleIds: null }],
  });
  const { classGroup } = await createClassGroup(ctx, {
    courseId: c!.id,
    moduleId: m!.id,
    name: "Terça 19h",
    teacherId: prof.id,
    startsOn: "2026-08-01",
    endsOn: "2026-09-30",
    schedules: [{ weekday: 2, startTime: "19:00" }],
  });
  await generateLessons(ctx, classGroup.id, { from: "2026-08-01", to: "2026-09-30" });

  const presente = await createStudent(ctx, { person: { name: "Sempre Presente" } });
  const faltante = await createStudent(ctx, { person: { name: "Sempre Falta" } });
  const e1 = await createEnrollment(ctx, { studentId: presente.id, classGroupId: classGroup.id, contract: { installments: 2 } });
  const e2 = await createEnrollment(ctx, { studentId: faltante.id, classGroupId: classGroup.id, contract: { installments: 2 } });

  // agosto inteiro concluído: um aluno presente, o outro faltando
  const lessons = await listLessons(ctx, { from: new Date("2026-08-01T03:00:00Z"), to: new Date("2026-09-01T03:00:00Z") });
  august = lessons.length;
  for (const l of lessons) {
    const after = at(new Date(new Date(l.endsAt).getTime() + 10 * 60000).toISOString());
    await setAttendance(after, l.id, [
      { enrollmentId: e1.id, status: "presente" },
      { enrollmentId: e2.id, status: "falta" },
    ]);
    await concludeLesson(after, l.id);
  }

  // uma parcela paga, para o "recebido" do mês
  const [first] = await listInstallments(at("2026-08-20T12:00:00Z"), { status: "a_vencer" });
  await registerPayment(at("2026-08-20T12:00:00Z"), first!.id, { amountCents: first!.amountCents, method: "pix", paidOn: "2026-08-20" });
});

describe("relatórios", () => {
  it("lista os últimos meses terminando no mês de hoje", () => {
    expect(lastMonths(at("2026-01-15T12:00:00Z"), 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("financeiro: recebido, aulas dadas e custo da folha no mês", async () => {
    const { months } = await financeReport(at("2026-09-10T12:00:00Z"), 3);
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    const agosto = months.find((m) => m.month === "2026-08")!;
    // duas presenças por aula (presente e falta contam como aula consumida) a R$ 50,00
    expect(agosto.recognizedCents).toBe(august * 2 * 5000);
    expect(agosto.lessons).toBe(august);
    expect(agosto.students).toBe(2);
    expect(agosto.receivedCents).toBeGreaterThan(0);
    expect(agosto.payrollCents).toBe(august * 8000);
    expect(agosto.marginCents).toBe(agosto.recognizedCents - agosto.payrollCents);
    expect(months.find((m) => m.month === "2026-07")!.recognizedCents).toBe(0);
  });

  it("frequência: presença por turma e alunos que mais faltaram", async () => {
    const r = await attendanceReport(at("2026-09-10T12:00:00Z"), { from: "2026-08-01", to: "2026-08-31" });
    expect(r.totals).toMatchObject({ lessons: august, present: august, absent: august, attendancePercent: 50 });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ className: "Terça 19h", attendancePercent: 50 });
    expect(r.students.map((s) => s.studentName)).toEqual(["Sempre Falta"]);
    expect(r.students[0]!.attendancePercent).toBe(0);
  });

  it("professores: aulas, média semanal contra o limite e custo só para quem vê a folha", async () => {
    const range = { from: "2026-08-01", to: "2026-08-31" };
    const comCusto = await teacherReport(at("2026-09-10T12:00:00Z"), range, true);
    const t = comCusto.teachers[0]!;
    expect(t).toMatchObject({ teacherName: "Prof Relatório", lessons: august, weeklyLimit: 2, overLimit: false });
    expect(t.hours).toBe(august);
    expect(t.costCents).toBe(august * 8000);

    const semCusto = await teacherReport(at("2026-09-10T12:00:00Z"), range, false);
    expect(semCusto.teachers[0]!.costCents).toBeNull();
  });

  it("matrículas: entradas por mês, alunos por situação e por curso", async () => {
    const r = await enrollmentReport(at("2026-09-10T12:00:00Z"), 3);
    expect(r.months.find((m) => m.month === "2026-08")).toMatchObject({ started: 2, ended: 0 });
    expect(r.byStatus).toEqual([{ status: "ativo", n: 2 }]);
    expect(r.byCourse).toEqual([{ courseName: "Grupo", courseColor: "#111111", active: 2, students: 2 }]);
  });

  it("alertas: aulas sem presença e parcelas vencidas, cada uma no seu recurso", async () => {
    const ctx = at("2026-09-30T12:00:00Z");
    const list = await alerts(ctx, all);
    const unfinished = list.find((a) => a.key === "aulas-nao-finalizadas");
    // as aulas de setembro passaram da hora sem conclusão
    expect(unfinished?.count).toBeGreaterThan(0);
    expect(unfinished?.resource).toBe("agenda");
    const overdue = list.find((a) => a.key === "parcelas-vencidas");
    expect(overdue?.count).toBeGreaterThan(0);
    expect(overdue?.detail).toContain("R$");

    // quem não enxerga o recurso não recebe o alerta
    const soAgenda = await alerts(ctx, (r) => r === "agenda");
    expect(soAgenda.every((a) => a.resource === "agenda")).toBe(true);
  });
});
