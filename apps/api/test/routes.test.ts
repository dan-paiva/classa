import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./harness.ts";

let t: Awaited<ReturnType<typeof createTestApp>>;
let escola: Awaited<ReturnType<Awaited<ReturnType<typeof createTestApp>>["adminOf"]>>;

const json = async <T>(res: Response) => {
  const body = (await res.json()) as T;
  if (res.status >= 400) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
};

beforeAll(async () => {
  t = await createTestApp();
  escola = await t.adminOf("rotas");
});

describe("fluxo completo pelas rotas", () => {
  it("curso → professor → turma com aulas → aluno → matrícula → parcelas → pagamento", async () => {
    const { course } = await json<{ course: { id: string } }>(await escola.json("/courses", "POST", { name: "Inglês Particular", type: "particular", lessonPriceCents: 10000, packageLessons: 12 }));
    const evenings = [1, 2, 3, 4, 5].flatMap((d) => [18, 19, 20].map((h) => d * 100 + h));
    const { teacher } = await json<{ teacher: { id: string } }>(
      await escola.json("/teachers", "POST", { person: { name: "Professora Teste", email: "prof@teste.dev" }, availability: evenings, courses: [{ courseId: course.id, moduleIds: null }] }),
    );

    const today = new Date().toISOString().slice(0, 10);
    const later = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10);
    const created = await json<{ classGroup: { id: string }; generation: { created: number } }>(
      await escola.json("/class-groups", "POST", {
        courseId: course.id, name: "Particular da Bia", teacherId: teacher.id, startsOn: today, endsOn: later,
        schedules: [{ weekday: 2, startTime: "19:00" }, { weekday: 4, startTime: "19:00" }], generateWeeks: 4,
      }),
    );
    expect(created.generation.created).toBeGreaterThan(0);

    const { student } = await json<{ student: { id: string } }>(await escola.json("/students", "POST", { person: { name: "Bia Teste", cpf: "123.456.789-09" } }));
    const dup = await escola.json("/students", "POST", { person: { name: "Outra", cpf: "12345678909" } });
    expect(dup.status).toBe(409);

    const { enrollment } = await json<{ enrollment: { id: string } }>(
      await escola.json("/enrollments", "POST", { studentId: student.id, classGroupId: created.classGroup.id, contract: { installments: 3 } }),
    );
    const cheia = await escola.json("/enrollments", "POST", { studentId: student.id, classGroupId: created.classGroup.id });
    expect(cheia.status).toBe(422);

    const detail = await json<{ enrollments: { balance: number }[]; installments: { id: string; amountCents: number }[]; lessons: unknown[] }>(
      await escola.json(`/students/${student.id}`),
    );
    expect(detail.enrollments[0]!.balance).toBe(12);
    expect(detail.installments.map((i) => i.amountCents)).toEqual([40000, 40000, 40000]);
    expect(detail.lessons.length).toBeGreaterThan(0);

    const pago = await escola.json(`/installments/${detail.installments[0]!.id}/payments`, "POST", { method: "pix" });
    expect(pago.status).toBe(201);
    const { summary } = await json<{ summary: { receivedCents: number } }>(await escola.json("/finance/summary"));
    expect(summary.receivedCents).toBe(40000);

    const credits = await json<{ entries: unknown[] }>(await escola.json(`/enrollments/${enrollment.id}/credits`));
    expect(credits.entries).toHaveLength(1);

    const semJust = await escola.json(`/enrollments/${enrollment.id}/credits`, "POST", { kind: "ajuste", amount: 2 });
    expect(semJust.status).toBe(400);
  });

  it("erro de regra vem com mensagem em português", async () => {
    const res = await escola.json("/class-groups", "POST", { courseId: "00000000-0000-7000-8000-000000000000", name: "X", startsOn: "2026-01-01", endsOn: "2026-02-01", schedules: [] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe("Curso não encontrado");
  });
});
