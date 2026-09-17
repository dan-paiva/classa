import { auditLog, eq } from "@classa/db";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./harness.ts";

type Module = { id: string; name: string; position: number; deactivatedAt: string | null };
type Course = {
  id: string;
  name: string;
  type: string;
  capacity: number;
  lessonMinutes: number;
  packageLessons: number;
  cancelNoticeHours: number;
  lessonPriceCents: number;
  modalities: string[];
  deactivatedAt: string | null;
  modules: Module[];
};

let t: Awaited<ReturnType<typeof createTestApp>>;
let escola: Awaited<ReturnType<Awaited<ReturnType<typeof createTestApp>>["adminOf"]>>;

beforeAll(async () => {
  t = await createTestApp();
  escola = await t.adminOf("idiomas");
});

async function criarCurso(body: Record<string, unknown>) {
  const res = await escola.json("/courses", "POST", body);
  return { res, course: res.status === 201 ? ((await res.json()) as { course: Course }).course : null };
}

describe("cursos", () => {
  it("cria curso em grupo com as regras padrão do tipo", async () => {
    const { res, course } = await criarCurso({ name: "Inglês em grupo", type: "grupo" });
    expect(res.status).toBe(201);
    expect(course).toMatchObject({ capacity: 8, lessonMinutes: 45, packageLessons: 48, cancelNoticeHours: 6, modules: [] });
  });

  it("aceita regras próprias no lugar das padrão", async () => {
    const { course } = await criarCurso({
      name: "Espanhol em grupo",
      type: "grupo",
      capacity: 6,
      lessonMinutes: 60,
      lessonPriceCents: 6600,
      modalities: ["online", "online", "presencial"],
    });
    expect(course).toMatchObject({ capacity: 6, lessonMinutes: 60, lessonPriceCents: 6600, modalities: ["online", "presencial"] });
  });

  it("recusa particular com mais de um aluno por aula", async () => {
    const { res } = await criarCurso({ name: "Particular errado", type: "particular", capacity: 3 });
    expect(res.status).toBe(400);
  });

  it("recusa nome repetido na mesma escola", async () => {
    const { res } = await criarCurso({ name: "Inglês em grupo", type: "grupo" });
    expect(res.status).toBe(409);
  });

  it("valida os campos e devolve mensagem por campo", async () => {
    const { res } = await criarCurso({ name: "", type: "invalido", lessonMinutes: -5 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: Record<string, string[]> };
    expect(Object.keys(body.issues).sort()).toEqual(["lessonMinutes", "name", "type"]);
  });

  it("edita regras e registra antes e depois na auditoria", async () => {
    const { course } = await criarCurso({ name: "Francês", type: "grupo" });
    const res = await escola.json(`/courses/${course!.id}`, "PATCH", { packageLessons: 32, name: "Francês em grupo" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { course: Course }).course).toMatchObject({ packageLessons: 32, name: "Francês em grupo" });

    const linhas = await t.db.select().from(auditLog).where(eq(auditLog.entityId, course!.id));
    const edicao = linhas.find((l) => l.action === "update");
    expect(edicao?.before).toMatchObject({ packageLessons: 48, name: "Francês" });
    expect(edicao?.after).toMatchObject({ packageLessons: 32, name: "Francês em grupo" });
  });

  it("inativa e reativa sem apagar", async () => {
    const { course } = await criarCurso({ name: "Alemão", type: "grupo" });
    const off = await escola.json(`/courses/${course!.id}/deactivate`, "POST");
    expect(((await off.json()) as { course: Course }).course.deactivatedAt).not.toBeNull();

    const lista = (await (await escola.json("/courses")).json()) as { courses: Course[] };
    expect(lista.courses.some((c) => c.id === course!.id)).toBe(true);

    const on = await escola.json(`/courses/${course!.id}/reactivate`, "POST");
    expect(((await on.json()) as { course: Course }).course.deactivatedAt).toBeNull();
  });

  it("devolve 404 para id inválido ou inexistente", async () => {
    expect((await escola.json("/courses/nao-e-uuid")).status).toBe(404);
    expect((await escola.json("/courses/00000000-0000-7000-8000-000000000000")).status).toBe(404);
  });
});

describe("módulos", () => {
  it("cria módulos em ordem dentro do curso em grupo", async () => {
    const { course } = await criarCurso({ name: "Inglês Essential", type: "grupo" });
    for (const name of ["Essential 1", "Essential 2"]) {
      const res = await escola.json(`/courses/${course!.id}/modules`, "POST", { name });
      expect(res.status).toBe(201);
    }
    const detalhe = (await (await escola.json(`/courses/${course!.id}`)).json()) as { course: Course };
    expect(detalhe.course.modules.map((m) => [m.name, m.position])).toEqual([
      ["Essential 1", 1],
      ["Essential 2", 2],
    ]);
  });

  it("recusa módulo repetido no mesmo curso", async () => {
    const { course } = await criarCurso({ name: "Inglês Rise", type: "grupo" });
    await escola.json(`/courses/${course!.id}/modules`, "POST", { name: "Rise 1" });
    const res = await escola.json(`/courses/${course!.id}/modules`, "POST", { name: "Rise 1" });
    expect(res.status).toBe(409);
  });

  it("não deixa criar módulo em curso particular", async () => {
    const { course } = await criarCurso({ name: "Inglês particular", type: "particular" });
    const res = await escola.json(`/courses/${course!.id}/modules`, "POST", { name: "Módulo 1" });
    expect(res.status).toBe(422);
  });

  it("renomeia e inativa módulo", async () => {
    const { course } = await criarCurso({ name: "Inglês Apex", type: "grupo" });
    const criado = (await (await escola.json(`/courses/${course!.id}/modules`, "POST", { name: "Apx 1" })).json()) as { module: Module };
    const ren = await escola.json(`/courses/${course!.id}/modules/${criado.module.id}`, "PATCH", { name: "Apex 1" });
    expect(((await ren.json()) as { module: Module }).module.name).toBe("Apex 1");
    const off = await escola.json(`/courses/${course!.id}/modules/${criado.module.id}/deactivate`, "POST");
    expect(((await off.json()) as { module: Module }).module.deactivatedAt).not.toBeNull();
  });
});

describe("isolamento entre escolas", () => {
  it("quem é de outra escola não vê nem edita os cursos", async () => {
    const { course } = await criarCurso({ name: "Curso secreto", type: "grupo" });
    const outra = await t.adminOf("outra-escola");

    const lista = (await (await outra.json("/courses")).json()) as { courses: Course[] };
    expect(lista.courses).toEqual([]);

    const res = await t.call(`/api/t/outra-escola/courses/${course!.id}`, { method: "PATCH", cookie: outra.cookie, body: JSON.stringify({ name: "x" }) });
    expect(res.status).toBe(404);

    const direto = await t.call("/api/t/idiomas/courses", { cookie: outra.cookie });
    expect(direto.status).toBe(404);
  });

  it("sem login devolve 401", async () => {
    expect((await t.call("/api/t/idiomas/courses")).status).toBe(401);
  });
});

describe("mensagens de validação", () => {
  it("campo numérico vazio vira mensagem em português", async () => {
    const res = await escola.json("/courses", "POST", { name: "Curso X", type: "grupo", lessonMinutes: null });
    const body = (await res.json()) as { issues: Record<string, string[]> };
    expect(body.issues.lessonMinutes).toEqual(["Informe um número"]);
  });
});
