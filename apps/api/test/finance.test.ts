import { course, DEFAULT_TENANT_SETTINGS, tenant, type Database } from "@classa/db";
import { createTestDb } from "@classa/db/testing";
import { slotKey } from "@classa/domain";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/services/context.ts";
import { createEnrollment, endEnrollment } from "../src/services/enrollments.ts";
import { financeSummary, listInstallments, refreshDelinquency, registerPayment, reversePayment } from "../src/services/finance.ts";
import { createStudent, createTeacher, getStudentRow } from "../src/services/people.ts";
import { createClassGroup } from "../src/services/schedule.ts";

let db: Database;
let base: Omit<ServiceContext, "now">;
const at = (iso: string): ServiceContext => ({ ...base, now: new Date(iso) });
let classId: string;

beforeAll(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenant).values({ name: "Escola Fin", slug: "fin" }).returning();
  base = { db, tenantId: t!.id, actorId: null, timezone: "America/Sao_Paulo", settings: DEFAULT_TENANT_SETTINGS };
  const [c] = await db
    .insert(course)
    .values({ tenantId: t!.id, name: "Particular", type: "particular", color: "#000000", capacity: 1, lessonMinutes: 60, packageLessons: 10, cancelNoticeHours: 24, lessonPriceCents: 10000, modalities: ["online"] })
    .returning();
  const ctx = at("2026-08-01T12:00:00Z");
  const prof = await createTeacher(ctx, { person: { name: "Prof" }, availability: [slotKey(2, 19)], courses: [{ courseId: c!.id, moduleIds: null }] });
  ({ classGroup: { id: classId } } = await createClassGroup(ctx, {
    courseId: c!.id, name: "Particular de Ana", teacherId: prof.id, startsOn: "2026-08-01", endsOn: "2027-07-31",
    schedules: [{ weekday: 2, startTime: "19:00" }],
  }));
});

describe("contrato e parcelas", () => {
  let studentId: string;

  it("matrícula emite contrato: pacote × valor em 6 parcelas no dia 10", async () => {
    const ctx = at("2026-08-05T12:00:00Z");
    studentId = (await createStudent(ctx, { person: { name: "Ana" } })).id;
    await createEnrollment(ctx, { studentId, classGroupId: classId, startsOn: "2026-08-05" });
    const parcelas = await listInstallments(ctx, { studentId });
    expect(parcelas.map((p) => [p.dueDate, p.amountCents])).toEqual([
      ["2026-08-10", 16666],
      ["2026-09-10", 16666],
      ["2026-10-10", 16666],
      ["2026-11-10", 16666],
      ["2026-12-10", 16666],
      ["2027-01-10", 16670],
    ]);
  });

  it("pagamento parcial, total e estorno; inadimplência depois de 15 dias", async () => {
    // 26/09: parcela de 10/08 vencida há 47 dias e a de 10/09 há 16 → inadimplente
    const setembro = at("2026-09-26T12:00:00Z");
    expect(await refreshDelinquency(setembro)).toBe(1);
    expect((await getStudentRow(db, setembro, studentId)).status).toBe("inadimplente");

    const [ago, set] = await listInstallments(setembro, { studentId });
    await registerPayment(setembro, ago!.id, { method: "pix", amountCents: 6666 });
    await expect(registerPayment(setembro, ago!.id, { method: "pix", amountCents: 20000 })).rejects.toMatchObject({ status: 400 });
    await registerPayment(setembro, ago!.id, { method: "pix" });
    expect((await getStudentRow(db, setembro, studentId)).status).toBe("inadimplente"); // setembro ainda vencida há 16 dias
    const pagSet = await registerPayment(setembro, set!.id, { method: "cartao_credito" });
    expect((await getStudentRow(db, setembro, studentId)).status).toBe("ativo");

    await expect(reversePayment(setembro, pagSet.id, "")).rejects.toMatchObject({ status: 400 });
    await reversePayment(setembro, pagSet.id, "Cartão contestado pelo banco");
    const [, setDepois] = await listInstallments(setembro, { studentId });
    expect(setDepois!.status).toBe("vencida");
    expect((await getStudentRow(db, setembro, studentId)).status).toBe("inadimplente");

    const resumo = await financeSummary(setembro, "2026-09");
    expect(resumo.receivedCents).toBe(16666 + 16666 - 16666);
    expect(resumo.overdueCount).toBe(1);
  });

  it("encerrar a matrícula cancela as parcelas futuras sem pagamento", async () => {
    const ctx = at("2026-10-01T12:00:00Z");
    const [e] = await listInstallments(ctx, { studentId });
    await endEnrollment(ctx, e!.enrollmentId);
    const status = (await listInstallments(ctx, { studentId })).map((p) => p.status);
    expect(status).toEqual(["paga", "vencida", "cancelada", "cancelada", "cancelada", "cancelada"]);
  });
});
