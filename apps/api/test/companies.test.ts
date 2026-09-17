import { course, courseModule, DEFAULT_TENANT_SETTINGS, tenant, type Database } from "@classa/db";
import { createTestDb } from "@classa/db/testing";
import { cnpjFromBase, slotKey } from "@classa/domain";
import { beforeAll, describe, expect, it } from "vitest";
import {
  autoRenewCompanies,
  companyDetail,
  createCompany,
  generateCharge,
  linkStudent,
  listCompanies,
  payCharge,
  recordReport,
  renewCompany,
  unlinkStudent,
} from "../src/services/companies.ts";
import type { ServiceContext } from "../src/services/context.ts";
import { createEnrollment } from "../src/services/enrollments.ts";
import { listInstallments } from "../src/services/finance.ts";
import { concludeLesson, setAttendance } from "../src/services/lessons.ts";
import { createStudent, createTeacher } from "../src/services/people.ts";
import { createClassGroup, generateLessons, listLessons } from "../src/services/schedule.ts";

let db: Database;
let base: Omit<ServiceContext, "now">;
const at = (iso: string): ServiceContext => ({ ...base, now: new Date(iso) });
let courseA: string;
let courseB: string;
let classA: string;
let classB: string;

beforeAll(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenant).values({ name: "Escola Empresas", slug: "empresas" }).returning();
  base = { db, tenantId: t!.id, actorId: null, timezone: "America/Sao_Paulo", settings: DEFAULT_TENANT_SETTINGS };
  const ctx = at("2026-09-01T12:00:00Z");
  const mk = async (name: string) => {
    const [c] = await db.insert(course).values({ tenantId: t!.id, name, type: "grupo", color: "#123456", capacity: 8, lessonMinutes: 60, packageLessons: 10, cancelNoticeHours: 6, lessonPriceCents: 10000, modalities: ["online"] }).returning();
    const [m] = await db.insert(courseModule).values({ tenantId: t!.id, courseId: c!.id, name: "N1", color: "#123456", position: 1 }).returning();
    return { c: c!, m: m! };
  };
  const a = await mk("Inglês");
  const b = await mk("Espanhol");
  courseA = a.c.id;
  courseB = b.c.id;
  const prof = await createTeacher(ctx, { person: { name: "Prof" }, availability: [slotKey(1, 19), slotKey(3, 19)], courses: [{ courseId: courseA, moduleIds: null }, { courseId: courseB, moduleIds: null }] });
  classA = (await createClassGroup(ctx, { courseId: courseA, moduleId: a.m.id, name: "Seg", teacherId: prof.id, startsOn: "2026-09-01", endsOn: "2026-12-31", schedules: [{ weekday: 1, startTime: "19:00" }] })).classGroup.id;
  classB = (await createClassGroup(ctx, { courseId: courseB, moduleId: b.m.id, name: "Qua", teacherId: prof.id, startsOn: "2026-09-01", endsOn: "2026-12-31", schedules: [{ weekday: 3, startTime: "19:00" }] })).classGroup.id;
  await generateLessons(ctx, classA, { from: "2026-09-01", to: "2026-10-31" });
});

describe("empresas", () => {
  let b2b: string;
  let b2b2c: string;

  it("valida CNPJ e força regras do B2B", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    await expect(createCompany(ctx, { name: "X", cnpj: "11.222.333/0001-80", model: "b2b", startsOn: "2026-09-01", endsOn: "2027-09-01", licenses: 2, licensePriceCents: 1 })).rejects.toMatchObject({ status: 400 });
    const c = await createCompany(ctx, {
      name: "Vetor Engenharia", cnpj: cnpjFromBase("112223330001"), model: "b2b", startsOn: "2026-09-01", endsOn: "2026-10-15",
      licenses: 2, contractedLessons: 10, licensePriceCents: 40000, subsidyPercent: 30, discountPercent: 10, autoRenew: false, allowedCourseIds: [courseA], hrEmail: "rh@vetor.exemplo",
    });
    expect(c).toMatchObject({ subsidyPercent: 100, discountPercent: 0 });
    b2b = c.id;
    b2b2c = (await createCompany(ctx, { name: "Rede Bem Estar", model: "b2b2c", startsOn: "2026-09-01", endsOn: "2027-09-01", licenses: 10, licensePriceCents: 30000, subsidyPercent: 50, discountPercent: 20 })).id;
  });

  it("aluno B2B: curso fora do contrato é recusado e não gera parcelas", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const s = await createStudent(ctx, { person: { name: "Colaborador B2B" } });
    await linkStudent(ctx, b2b, s.id);
    await expect(createEnrollment(ctx, { studentId: s.id, classGroupId: classB })).rejects.toMatchObject({ status: 422 });
    await createEnrollment(ctx, { studentId: s.id, classGroupId: classA });
    expect(await listInstallments(ctx, { studentId: s.id })).toEqual([]);
  });

  it("aluno B2B2C paga só a parte dele com desconto", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const s = await createStudent(ctx, { person: { name: "Colaborador B2B2C" } });
    await linkStudent(ctx, b2b2c, s.id);
    await createEnrollment(ctx, { studentId: s.id, classGroupId: classB, contract: { installments: 1 } });
    const [p] = await listInstallments(ctx, { studentId: s.id });
    // bruto 10 × R$100 = R$1000; empresa 50%; colaborador R$500 com 20% = R$400
    expect(p!.amountCents).toBe(40000);
  });

  it("licenças, consumo, presença e alertas", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const s2 = await createStudent(ctx, { person: { name: "Segundo B2B" } });
    const s3 = await createStudent(ctx, { person: { name: "Terceiro B2B" } });
    await linkStudent(ctx, b2b, s2.id);
    await createEnrollment(ctx, { studentId: s2.id, classGroupId: classA });
    const r = await linkStudent(ctx, b2b, s3.id);
    expect(r.warning).toBeNull(); // sem matrícula não conta licença
    await createEnrollment(ctx, { studentId: s3.id, classGroupId: classA });

    const lessons = await listLessons(ctx, { from: new Date("2026-09-01T03:00:00Z"), to: new Date("2026-10-01T03:00:00Z"), classGroupId: classA });
    const detail0 = await companyDetail(ctx, b2b);
    for (const l of lessons.slice(0, 3)) {
      const after = at(new Date(new Date(l.endsAt).getTime() + 600000).toISOString());
      const roster = detail0.students;
      const { lessonRoster } = await import("../src/services/lessons.ts");
      const entries = (await lessonRoster(after, l.id)).map((x, i) => ({ enrollmentId: x.enrollmentId, status: i === 0 ? ("falta" as const) : ("presente" as const) }));
      await setAttendance(after, l.id, entries);
      await concludeLesson(after, l.id);
      void roster;
    }
    const ctxLate = at("2026-09-25T12:00:00Z");
    const { company: c } = await companyDetail(ctxLate, b2b);
    expect(c.licensesInUse).toBe(3);
    expect(c.consumed).toBe(9);
    expect(c.attendancePercent).toBe(67);
    const tones = c.alerts.map((a) => a.message);
    expect(tones).toEqual(["Vence em 20 dias · sem renovação automática", "1 acima das licenças", "Consumo em 90% das aulas", "Presença em 67%"]);

    const list = await listCompanies(ctxLate);
    expect(list.find((x) => x.id === b2b)!.monthlyCompanyCents).toBe(80000);
  });

  it("cobrança mensal, pagamento, relatório, renovação e desvínculo", async () => {
    const ctx = at("2026-09-25T12:00:00Z");
    const ch = await generateCharge(ctx, b2b, "2026-09");
    expect(ch).toMatchObject({ billedLicenses: 2, amountCents: 80000, dueDate: "2026-09-10" });
    await expect(generateCharge(ctx, b2b, "2026-09")).rejects.toMatchObject({ status: 422 });
    await payCharge(ctx, ch.id, { method: "boleto" });
    const bc = await generateCharge(ctx, b2b2c, "2026-09");
    expect(bc).toMatchObject({ billedLicenses: 1, amountCents: 15000 });

    await recordReport(ctx, b2b);
    await expect(recordReport(ctx, b2b2c)).rejects.toMatchObject({ status: 422 });

    await expect(renewCompany(ctx, b2b, { endsOn: "2026-10-01" })).rejects.toMatchObject({ status: 400 });
    const renewed = await renewCompany(ctx, b2b, { endsOn: "2027-10-15", licenses: 4, addLessons: 40 });
    expect(renewed).toMatchObject({ licenses: 4, contractedLessons: 50 });

    const { students } = await companyDetail(ctx, b2b);
    await unlinkStudent(ctx, b2b, students[0]!.id);
    expect((await companyDetail(ctx, b2b)).students).toHaveLength(2);
  });

  it("renovação automática", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const c = await createCompany(ctx, { name: "Auto", model: "b2b", startsOn: "2025-01-01", endsOn: "2026-08-01", licenses: 1, licensePriceCents: 100 });
    expect(await autoRenewCompanies(ctx)).toBe(1);
    expect((await companyDetail(ctx, c.id)).company.endsOn).toBe("2027-08-01");
  });
});
