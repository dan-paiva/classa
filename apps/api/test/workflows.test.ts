import { course, courseModule, creditEntry, DEFAULT_TENANT_SETTINGS, eq, lesson, lessonStudent, tenant, type Database } from "@classa/db";
import { createTestDb } from "@classa/db/testing";
import { slotKey } from "@classa/domain";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/services/context.ts";
import { createEnrollment, listEnrollments } from "../src/services/enrollments.ts";
import { listInstallments } from "../src/services/finance.ts";
import { concludeLesson, setAttendance } from "../src/services/lessons.ts";
import { createStudent, createTeacher, getStudentRow, listTeachers } from "../src/services/people.ts";
import { createClassGroup, generateLessons, listLessons } from "../src/services/schedule.ts";
import { cardDetail, convertLead, createCard, createLead, listLeads, moveCard, moveLead, renewalQueue } from "../src/services/workflows.ts";

let db: Database;
let base: Omit<ServiceContext, "now">;
const at = (iso: string): ServiceContext => ({ ...base, now: new Date(iso) });
const evenings = [1, 2, 3, 4, 5].flatMap((d) => [18, 19, 20].map((h) => slotKey(d, h)));
let courseId: string;
let m1: string;
let m2: string;
let teacherA: string;
let teacherB: string;
let group1: string;
let group2: string;

beforeAll(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenant).values({ name: "Escola Fluxos", slug: "fluxos" }).returning();
  base = { db, tenantId: t!.id, actorId: null, timezone: "America/Sao_Paulo", settings: DEFAULT_TENANT_SETTINGS };
  const ctx = at("2026-09-01T12:00:00Z");
  const [c] = await db.insert(course).values({ tenantId: t!.id, name: "Inglês", type: "grupo", color: "#123456", capacity: 6, lessonMinutes: 60, packageLessons: 10, cancelNoticeHours: 6, lessonPriceCents: 10000, modalities: ["online"] }).returning();
  courseId = c!.id;
  m1 = (await db.insert(courseModule).values({ tenantId: t!.id, courseId, name: "Nível 1", color: "#123456", position: 1 }).returning())[0]!.id;
  m2 = (await db.insert(courseModule).values({ tenantId: t!.id, courseId, name: "Nível 2", color: "#123456", position: 2 }).returning())[0]!.id;
  teacherA = (await createTeacher(ctx, { person: { name: "Prof A" }, availability: evenings, courses: [{ courseId, moduleIds: null }] })).id;
  teacherB = (await createTeacher(ctx, { person: { name: "Prof B" }, availability: evenings, courses: [{ courseId, moduleIds: null }] })).id;
  group1 = (await createClassGroup(ctx, { courseId, moduleId: m1, name: "N1 seg", teacherId: teacherA, startsOn: "2026-09-01", endsOn: "2026-12-31", schedules: [{ weekday: 1, startTime: "19:00" }] })).classGroup.id;
  group2 = (await createClassGroup(ctx, { courseId, moduleId: m2, name: "N2 qua", teacherId: teacherB, startsOn: "2026-09-01", endsOn: "2026-12-31", schedules: [{ weekday: 3, startTime: "19:00" }] })).classGroup.id;
  await generateLessons(ctx, group1, { from: "2026-09-01", to: "2026-11-30" });
  await generateLessons(ctx, group2, { from: "2026-09-01", to: "2026-11-30" });
});

describe("fluxos", () => {
  it("substituição: pular para Concluído exige substituto e troca o professor", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const [aula] = await listLessons(ctx, { from: new Date("2026-09-07T00:00:00Z"), to: new Date("2026-09-30T00:00:00Z"), classGroupId: group1 });
    const card = await createCard(ctx, "substituicao", { lessonId: aula!.id, reason: "Doença" });
    await expect(moveCard(ctx, card.id, "concluido")).rejects.toMatchObject({ message: "Para Confirmado, preencha: Substituto." });
    const { updateCard } = await import("../src/services/workflows.ts");
    await updateCard(ctx, card.id, { substituteId: teacherB });
    const done = await moveCard(ctx, card.id, "concluido");
    expect(done.stage).toBe("concluido");
    const [depois] = await db.select().from(lesson).where(eq(lesson.id, aula!.id));
    expect(depois).toMatchObject({ teacherId: teacherB, originalTeacherId: teacherA });
    const { transitions } = await cardDetail(ctx, card.id);
    expect(transitions.map((t) => t.toStage)).toEqual(["pedido", "buscando", "confirmado", "concluido"]);
    // voltar não desfaz; reabrir só na primeira etapa
    await expect(moveCard(ctx, card.id, "buscando")).rejects.toMatchObject({ status: 422 });
  });

  it("mudança de nível transfere a matrícula; retenção cancelada cancela o aluno", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const s = await createStudent(ctx, { person: { name: "Aluno Nível" } });
    const e = await createEnrollment(ctx, { studentId: s.id, classGroupId: group1 });
    const card = await createCard(ctx, "nivel", { enrollmentId: e.id, result: "B1", targetClassGroupId: group2 });
    await moveCard(ctx, card.id, "aplicada");
    const [depois] = await listEnrollments(ctx, { studentId: s.id });
    expect(depois!.classGroupId).toBe(group2);

    const ret = await createCard(ctx, "retencao", { studentId: s.id, reason: "Preço" });
    await moveCard(ctx, ret.id, "cancelado");
    expect((await getStudentRow(db, ctx, s.id)).status).toBe("cancelado");
  });

  it("reposição inscreve na aula e devolve a aula perdida", async () => {
    const s = await createStudent(at("2026-09-01T12:00:00Z"), { person: { name: "Aluna Falta" } });
    const e = await createEnrollment(at("2026-09-01T12:00:00Z"), { studentId: s.id, classGroupId: group1 });
    const [aula] = await listLessons(at("2026-09-01T12:00:00Z"), { from: new Date("2026-09-07T00:00:00Z"), to: new Date("2026-09-09T00:00:00Z"), classGroupId: group1 });
    const after = at("2026-09-07T23:00:00Z");
    const { lessonRoster } = await import("../src/services/lessons.ts");
    await setAttendance(after, aula!.id, (await lessonRoster(after, aula!.id)).map((r) => ({ enrollmentId: r.enrollmentId, status: "falta" as const })));
    await concludeLesson(after, aula!.id);
    const falta = (await db.select().from(lessonStudent).where(eq(lessonStudent.enrollmentId, e.id))).find((x) => x.lessonId === aula!.id);
    const saldoAntes = (await listEnrollments(after, { studentId: s.id }))[0]!.balance;

    const [destino] = await listLessons(after, { from: new Date("2026-09-09T00:00:00Z"), to: new Date("2026-09-11T00:00:00Z"), classGroupId: group2 });
    const card = await createCard(after, "reposicao", { missedLessonStudentId: falta!.id, targetLessonId: destino!.id });
    await moveCard(after, card.id, "agendada");
    const inscritos = await db.select().from(lessonStudent).where(eq(lessonStudent.lessonId, destino!.id));
    expect(inscritos.some((x) => x.enrollmentId === e.id)).toBe(true);
    expect((await listEnrollments(after, { studentId: s.id }))[0]!.balance).toBe(saldoAntes + 1);
  });

  it("admissão cria o professor; cobrança paga baixa as parcelas vencidas", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const adm = await createCard(ctx, "admissao", { name: "Nova Professora" });
    await expect(moveCard(ctx, adm.id, "ativo")).rejects.toMatchObject({ status: 422 });
    const { updateCard } = await import("../src/services/workflows.ts");
    await updateCard(ctx, adm.id, { email: "nova.prof@exemplo.com", courseIds: [courseId], hourlyRateCents: 7000 });
    const done = await moveCard(ctx, adm.id, "ativo");
    expect((await listTeachers(ctx)).some((t) => t.id === done.data.teacherId)).toBe(true);

    const s = await createStudent(ctx, { person: { name: "Devedor" } });
    await createEnrollment(ctx, { studentId: s.id, classGroupId: group1, startsOn: "2026-07-01", contract: { installments: 3 } });
    const late = at("2026-09-20T12:00:00Z");
    const cob = await createCard(late, "cobranca", { studentId: s.id, method: "pix" });
    expect(cob.data.installmentIds).toHaveLength(3);
    await updateCard(late, cob.id, { agreement: "Paga tudo hoje" });
    await moveCard(late, cob.id, "pago");
    expect((await listInstallments(late, { studentId: s.id })).every((i) => i.status === "paga")).toBe(true);
  });

  it("renovação: fila de 60 dias, novo contrato, aulas no extrato e fim +12 meses", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const s = await createStudent(ctx, { person: { name: "Renova" } });
    const e = await createEnrollment(ctx, { studentId: s.id, classGroupId: group1, endsOn: "2026-10-15" });
    const queue = await renewalQueue(ctx);
    expect(queue.some((q) => q.enrollmentId === e.id)).toBe(true);
    const card = await createCard(ctx, "renovacao", { enrollmentId: e.id });
    expect((await renewalQueue(ctx)).some((q) => q.enrollmentId === e.id)).toBe(false);
    await expect(moveCard(ctx, card.id, "renovado")).rejects.toMatchObject({ message: "Para Proposta enviada, preencha: Aulas no novo pacote." });
    const { updateCard } = await import("../src/services/workflows.ts");
    await updateCard(ctx, card.id, { packageLessons: 20, installments: 4 });
    await moveCard(ctx, card.id, "renovado");
    const [depois] = await listEnrollments(ctx, { studentId: s.id });
    expect(depois).toMatchObject({ endsOn: "2027-10-15", balance: 30 });
    const kinds = await db.select({ kind: creditEntry.kind }).from(creditEntry).where(eq(creditEntry.enrollmentId, e.id));
    expect(kinds.map((k) => k.kind).sort()).toEqual(["contratacao", "renovacao"]);
    expect((await listInstallments(ctx, { studentId: s.id })).length).toBe(6 + 4);
  });
});

describe("leads", () => {
  it("funil: avança até proposta, perde com motivo, reabre e converte reaproveitando a pessoa", async () => {
    const ctx = at("2026-09-01T12:00:00Z");
    const l = await createLead(ctx, { name: "Interessada", email: "Interessada@Exemplo.com", origin: "Site", courseId });
    await moveLead(ctx, l.id, { to: "avancar" });
    await moveLead(ctx, l.id, { to: "perdido", reason: "Preço" });
    const reopened = await moveLead(ctx, l.id, { to: "reabrir" });
    expect(reopened.stage).toBe("contato");
    await expect(convertLead(ctx, l.id)).rejects.toMatchObject({ status: 422 });
    await moveLead(ctx, l.id, { to: "avancar" });
    await moveLead(ctx, l.id, { to: "avancar" });
    await expect(moveLead(ctx, l.id, { to: "avancar" })).rejects.toMatchObject({ status: 422 });

    const existing = await createStudent(ctx, { person: { name: "Interessada Já Aluna", email: "interessada@exemplo.com" } });
    const converted = await convertLead(ctx, l.id);
    expect(converted).toMatchObject({ stage: "matriculado", studentId: existing.id });

    const stalled = await createLead(ctx, { name: "Parado", origin: "Evento" });
    for (let i = 0; i < 3; i++) await moveLead(ctx, stalled.id, { to: "avancar" });
    const list = await listLeads(at("2026-09-20T12:00:00Z"));
    expect(list.find((x) => x.id === stalled.id)!.stalled).toBe(true);
  });
});
