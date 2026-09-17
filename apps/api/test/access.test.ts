import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp, TEST_PASSWORD } from "./harness.ts";

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: Awaited<ReturnType<Awaited<ReturnType<typeof createTestApp>>["adminOf"]>>;

const body = async <T>(res: Response) => {
  const b = (await res.json()) as T;
  if (res.status >= 400) throw new Error(`${res.status} ${JSON.stringify(b)}`);
  return b;
};
const evenings = [1, 2, 3, 4, 5, 6].flatMap((d) => [8, 9, 10, 11, 18, 19, 20].map((h) => d * 100 + h));

/** Aceita o convite: cria a conta (liberada pelo convite) e aceita com a sessão nova. */
async function joinByInvite(link: string, email: string, name: string) {
  const token = link.split("/convite/")[1]!;
  const info = await body<{ email: string; hasAccount: boolean }>(await t.call(`/api/invitations/${token}`));
  expect(info.email).toBe(email);
  const cookie = await t.signUp(email, name);
  const accepted = await t.call(`/api/invitations/${token}/accept`, { method: "POST", cookie });
  expect(accepted.status).toBe(200);
  const reused = await t.call(`/api/invitations/${token}`);
  expect(reused.status).toBe(410);
  return cookie;
}

let coordCookie: string;
let teacherCookie: string;
let studentCookie: string;
let otherLessonId: string;
let ownLessonId: string;

beforeAll(async () => {
  // a lista de e-mails só libera a primeira conta; o resto entra por convite
  t = await createTestApp({ allowedSignupEmails: ["admin@acesso.classa.dev"] });
  admin = await t.adminOf("acesso");

  const { course } = await body<{ course: { id: string; modules: { id: string }[] } }>(await admin.json("/courses", "POST", { name: "Inglês", type: "grupo" }));
  const { module } = await body<{ module: { id: string } }>(await admin.json(`/courses/${course.id}/modules`, "POST", { name: "N1" }));
  const mkTeacher = async (name: string, email: string) =>
    (await body<{ teacher: { id: string; personId: string } }>(await admin.json("/teachers", "POST", { person: { name, email }, availability: evenings, courses: [{ courseId: course.id, moduleIds: null }] }))).teacher;
  const own = await mkTeacher("Professora Dona", "prof@acesso.classa.dev");
  const other = await mkTeacher("Outro Professor", "outro@acesso.classa.dev");
  const today = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const mkGroup = async (name: string, teacherId: string, time: string) =>
    (await body<{ classGroup: { id: string } }>(await admin.json("/class-groups", "POST", { courseId: course.id, moduleId: module.id, name, teacherId, startsOn: today, endsOn: later, schedules: [{ weekday: 6, startTime: time }], generateWeeks: 3 }))).classGroup;
  const g1 = await mkGroup("Turma da dona", own.id, "09:00");
  const g2 = await mkGroup("Turma do outro", other.id, "10:00");
  const d1 = await body<{ lessons: { id: string }[] }>(await admin.json(`/class-groups/${g1.id}`));
  const d2 = await body<{ lessons: { id: string }[] }>(await admin.json(`/class-groups/${g2.id}`));
  ownLessonId = d1.lessons[0]!.id;
  otherLessonId = d2.lessons[0]!.id;

  const { student } = await body<{ student: { id: string } }>(await admin.json("/students", "POST", { person: { name: "Aluna Portal", email: "aluna@acesso.classa.dev" } }));
  await body(await admin.json("/enrollments", "POST", { studentId: student.id, classGroupId: g1.id, contract: { installments: 2 } }));

  const invite = async (payload: Record<string, unknown>) => body<{ link: string }>(await admin.json("/invitations", "POST", payload));

  const coord = await invite({ email: "coord@acesso.classa.dev", profileType: "colaborador", level: 2, areas: { ped: "total", aca: "restrito" } });
  coordCookie = await joinByInvite(coord.link, "coord@acesso.classa.dev", "Coordenação");

  const users = await body<{ members: { personId: string | null; email: string }[] }>(await admin.json("/users"));
  expect(users.members.map((m) => m.email).sort()).toEqual(["admin@acesso.classa.dev", "coord@acesso.classa.dev"]);

  const prof = await invite({ personId: own.personId, profileType: "prestador" });
  teacherCookie = await joinByInvite(prof.link, "prof@acesso.classa.dev", "Professora Dona");

  const [aluna] = (await body<{ students: { id: string; person: { id: string } }[] }>(await admin.json("/students"))).students;
  const al = await invite({ personId: aluna!.person.id, profileType: "aluno" });
  studentCookie = await joinByInvite(al.link, "aluna@acesso.classa.dev", "Aluna Portal");
});

const as = (cookie: string, path: string, method = "GET", payload?: unknown) =>
  t.call(`/api/t/acesso${path}`, { method, cookie, body: payload === undefined ? undefined : JSON.stringify(payload) });

describe("perfis de acesso", () => {
  it("sem convite, a lista de e-mails continua barrando o cadastro", async () => {
    const res = await t.call("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email: "intruso@x.dev", name: "X", password: TEST_PASSWORD }) });
    expect(res.status).toBe(403);
  });

  it("coordenação pedagógica: edita professores, só vê alunos, não vê financeiro nem usuários", async () => {
    expect((await as(coordCookie, "/teachers")).status).toBe(200);
    expect((await as(coordCookie, "/students")).status).toBe(200);
    expect((await as(coordCookie, "/students", "POST", { person: { name: "Novo" } })).status).toBe(403);
    expect((await as(coordCookie, "/finance/summary")).status).toBe(403);
    expect((await as(coordCookie, "/users")).status).toBe(403);
    const me = await body<{ memberships: { permissions: Record<string, string[]> }[] }>(await t.call("/api/me", { cookie: coordCookie }));
    expect(me.memberships[0]!.permissions.professores).toContain("editar");
    expect(me.memberships[0]!.permissions.financeiro).toEqual([]);
  });

  it("professor: só as próprias aulas", async () => {
    const lessons = await body<{ lessons: { id: string; teacherName: string }[] }>(await as(teacherCookie, `/lessons?from=${new Date().toISOString()}&to=${new Date(Date.now() + 30 * 86400_000).toISOString()}`));
    expect(lessons.lessons.length).toBeGreaterThan(0);
    expect(new Set(lessons.lessons.map((l) => l.teacherName))).toEqual(new Set(["Professora Dona"]));
    expect((await as(teacherCookie, `/lessons/${ownLessonId}`)).status).toBe(200);
    expect((await as(teacherCookie, `/lessons/${otherLessonId}`)).status).toBe(404);
    expect((await as(teacherCookie, `/lessons/${ownLessonId}/cancel`, "POST", { reason: "não posso" })).status).toBe(403);
    expect((await as(teacherCookie, "/students")).status).toBe(403);
    expect((await as(teacherCookie, "/installments")).status).toBe(403);
  });

  it("aluno: só a própria área, e cancela a própria aula com antecedência", async () => {
    expect((await as(studentCookie, "/students")).status).toBe(403);
    expect((await as(studentCookie, "/lessons")).status).toBe(403);
    const area = await body<{ student: { name: string }; enrollments: unknown[]; installments: unknown[]; lessons: { id: string; myStatus: string }[] }>(await as(studentCookie, "/minha-area"));
    expect(area.student.name).toBe("Aluna Portal");
    expect(area.installments).toHaveLength(2);
    const next = area.lessons.find((l) => l.myStatus === "inscrito")!;
    const cancel = await body<{ entry: { status: string; cancelledInTime: boolean } }>(await as(studentCookie, `/minha-area/aulas/${next.id}/cancelar`, "POST"));
    expect(cancel.entry).toMatchObject({ status: "cancelou", cancelledInTime: true });
    expect((await as(studentCookie, `/minha-area/aulas/${otherLessonId}/cancelar`, "POST")).status).toBe(404);
  });

  it("governança: ninguém muda o próprio acesso, o último admin fica, bloqueio corta o acesso", async () => {
    const { members } = await body<{ members: { id: string; email: string }[] }>(await admin.json("/users"));
    const me = members.find((m) => m.email === "admin@acesso.classa.dev")!;
    const coord = members.find((m) => m.email === "coord@acesso.classa.dev")!;
    expect((await admin.json(`/users/${me.id}`, "PATCH", { profileType: "colaborador", level: 2, areas: { ped: "total" } })).status).toBe(422);

    // promove a coordenação a admin, que tenta rebaixar o admin original (permitido, restam 2 → 1)
    await body(await admin.json(`/users/${coord.id}`, "PATCH", { profileType: "admin" }));
    const promoted = (path: string, method: string, payload?: unknown) => as(coordCookie, path, method, payload);
    expect((await promoted(`/users/${me.id}/block`, "POST")).status).toBe(200);
    expect((await admin.json("/courses")).status).toBe(403);
    // agora a coordenação é a única admin ativa: não pode ser rebaixada por ninguém, e nem ela mesma se altera
    expect((await promoted(`/users/${coord.id}`, "PATCH", { profileType: "colaborador", level: 1, areas: { adm: "total" } })).status).toBe(422);
    expect((await promoted(`/users/${me.id}/unblock`, "POST")).status).toBe(200);
    expect((await admin.json("/courses")).status).toBe(200);
  });

  it("auditoria: admin vê quem mudou o quê; demais perfis não", async () => {
    const res = await body<{ entries: { entity: string; action: string; actorEmail: string | null }[]; entities: { entity: string }[] }>(await admin.json("/audit?entity=student"));
    expect(res.entries.length).toBeGreaterThan(0);
    expect(res.entries.every((e) => e.entity === "student")).toBe(true);
    expect(res.entries.some((e) => e.action === "create" && e.actorEmail === "admin@acesso.classa.dev")).toBe(true);
    expect(res.entities.map((e) => e.entity)).toContain("invitation");
    expect((await as(studentCookie, "/audit")).status).toBe(403); // a coordenação virou admin no teste anterior
    expect((await as(teacherCookie, "/audit")).status).toBe(403);
  });

  it("convite para quem já tem acesso é recusado; aceite com outro e-mail também", async () => {
    expect((await admin.json("/invitations", "POST", { email: "coord@acesso.classa.dev", profileType: "admin" })).status).toBe(409);
    const { link } = await body<{ link: string }>(await admin.json("/invitations", "POST", { email: "novo@acesso.classa.dev", profileType: "colaborador", level: 3, areas: { com: "total" } }));
    const token = link.split("/convite/")[1];
    const res = await t.call(`/api/invitations/${token}/accept`, { method: "POST", cookie: coordCookie });
    expect(res.status).toBe(403);
  });
});
