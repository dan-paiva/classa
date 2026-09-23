import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./harness.ts";

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: Awaited<ReturnType<Awaited<ReturnType<typeof createTestApp>>["adminOf"]>>;

const body = async <T>(res: Response) => {
  const b = (await res.json()) as T;
  if (res.status >= 400) throw new Error(`${res.status} ${JSON.stringify(b)}`);
  return b;
};
const manha = [1, 2, 3, 4, 5, 6].flatMap((d) => [8, 9, 10, 11].map((h) => d * 100 + h));

async function joinByInvite(link: string, email: string, name: string) {
  const token = link.split("/convite/")[1]!;
  const cookie = await t.signUp(email, name);
  expect((await t.call(`/api/invitations/${token}/accept`, { method: "POST", cookie })).status).toBe(200);
  return cookie;
}
const as = (cookie: string, path: string, method = "GET", payload?: unknown) =>
  t.call(`/api/t/agenda${path}`, { method, cookie, body: payload === undefined ? undefined : JSON.stringify(payload) });

type Item = { type: string; id: string; title: string; startsAt: string; cancelled: boolean; seatsLeft?: number };

let courseId = "";
let moduleId = "";
let prof = { id: "", personId: "" };
let outro = { id: "", personId: "" };
let lessonAt = { startsAt: "", endsAt: "" };
let from = "";
let to = "";
let teacherCookie = "";

beforeAll(async () => {
  t = await createTestApp({ allowedSignupEmails: ["admin@agenda.classa.dev"] });
  admin = await t.adminOf("agenda");
  const { course } = await body<{ course: { id: string } }>(await admin.json("/courses", "POST", { name: "Inglês", type: "grupo" }));
  courseId = course.id;
  moduleId = (await body<{ module: { id: string } }>(await admin.json(`/courses/${courseId}/modules`, "POST", { name: "Nível 1" }))).module.id;
  const mk = async (name: string, email: string) =>
    (await body<{ teacher: { id: string; personId: string } }>(
      await admin.json("/teachers", "POST", { person: { name, email }, availability: manha, courses: [{ courseId, moduleIds: null }] }),
    )).teacher;
  prof = await mk("Prof Agenda", "prof@agenda.classa.dev");
  outro = await mk("Prof Outro", "outro@agenda.classa.dev");

  const hoje = new Date().toISOString().slice(0, 10);
  const depois = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
  const { classGroup } = await body<{ classGroup: { id: string } }>(
    await admin.json("/class-groups", "POST", {
      courseId, moduleId, name: "Turma sábado", teacherId: prof.id, startsOn: hoje, endsOn: depois, schedules: [{ weekday: 6, startTime: "09:00" }], generateWeeks: 3,
    }),
  );
  const { lessons } = await body<{ lessons: { startsAt: string; endsAt: string }[] }>(await admin.json(`/class-groups/${classGroup.id}`));
  lessonAt = lessons[lessons.length - 1]!;
  from = new Date(new Date(lessonAt.startsAt).getTime() - 12 * 3600_000).toISOString();
  to = new Date(new Date(lessonAt.startsAt).getTime() + 12 * 3600_000).toISOString();

  const { link } = await body<{ link: string }>(await admin.json("/invitations", "POST", { personId: prof.personId, profileType: "prestador" }));
  teacherCookie = await joinByInvite(link, "prof@agenda.classa.dev", "Prof Agenda");
});

const at = (iso: string, deltaMin: number) => new Date(new Date(iso).getTime() + deltaMin * 60_000).toISOString();

describe("eventos, reuniões e nivelamentos", () => {
  it("choque com aula de participante é aviso: recusa com a lista e grava com 'salvar mesmo assim'", async () => {
    const input = { kind: "reuniao", title: "Reunião pedagógica", startsAt: at(lessonAt.startsAt, 15), endsAt: at(lessonAt.startsAt, 45), participantIds: [prof.personId] };
    const res = await admin.json("/events", "POST", input);
    expect(res.status).toBe(409);
    const b = (await res.json()) as { issues: { clashes: string[] } };
    expect(b.issues.clashes[0]).toContain("Prof Agenda tem aula de Turma sábado");

    const ok = await admin.json("/events", "POST", { ...input, force: true });
    expect(ok.status).toBe(201);
  });

  it("início e fim no mesmo dia, e fim depois do início", async () => {
    const bad = await admin.json("/events", "POST", { kind: "evento", title: "Virada", startsAt: at(lessonAt.startsAt, 0), endsAt: at(lessonAt.startsAt, 24 * 60) });
    expect(bad.status).toBe(400);
    const back = await admin.json("/events", "POST", { kind: "evento", title: "Ao contrário", startsAt: at(lessonAt.startsAt, 60), endsAt: at(lessonAt.startsAt, 0) });
    expect(back.status).toBe(400);
  });

  it("nivelamento aceita lead como avaliado e exige avaliador do pedagógico", async () => {
    const { lead } = await body<{ lead: { personId: string } }>(await admin.json("/leads", "POST", { name: "Lead Nivelado", origin: "Site" }));
    const { student } = await body<{ student: { personId: string } }>(await admin.json("/students", "POST", { person: { name: "Aluno Qualquer" } }));

    const semAvaliador = await admin.json("/events", "POST", {
      kind: "nivelamento", title: "Nivelamento", startsAt: at(lessonAt.startsAt, 180), endsAt: at(lessonAt.startsAt, 210), evaluatedPersonId: lead.personId,
    });
    expect(semAvaliador.status).toBe(400);
    const alunoAvaliando = await admin.json("/events", "POST", {
      kind: "nivelamento", title: "Nivelamento", startsAt: at(lessonAt.startsAt, 180), endsAt: at(lessonAt.startsAt, 210), evaluatedPersonId: lead.personId, evaluatorPersonId: student.personId,
    });
    expect(alunoAvaliando.status).toBe(400);

    const { event } = await body<{ event: { id: string } }>(
      await admin.json("/events", "POST", {
        kind: "nivelamento", title: "Nivelamento", courseId, startsAt: at(lessonAt.startsAt, 180), endsAt: at(lessonAt.startsAt, 210),
        evaluatedPersonId: lead.personId, evaluatorPersonId: outro.personId,
      }),
    );
    // avaliador e avaliado entram como participantes
    const detail = await body<{ participants: { id: string }[] }>(await admin.json(`/events/${event.id}`));
    expect(detail.participants.map((p) => p.id).sort()).toEqual([lead.personId, outro.personId].sort());

    // resultado: o módulo tem de ser do curso, e não matricula ninguém
    const { event: done } = await body<{ event: { state: string; suggestedModuleId: string } }>(
      await admin.json(`/events/${event.id}/result`, "POST", { suggestedModuleId: moduleId, resultNotes: "Vai bem na conversação" }),
    );
    expect(done).toMatchObject({ state: "realizado", suggestedModuleId: moduleId });
    const students = await body<{ students: { person: { name: string } }[] }>(await admin.json("/students"));
    expect(students.students.some((s) => s.person.name === "Lead Nivelado")).toBe(false);
  });
});

describe("agenda geral", () => {
  it("junta aula e evento em ordem, e cancelado continua, marcado", async () => {
    const { event } = await body<{ event: { id: string } }>(
      await admin.json("/events", "POST", { kind: "evento", title: "Festa junina", startsAt: at(lessonAt.startsAt, 240), endsAt: at(lessonAt.startsAt, 300), location: "Pátio" }),
    );
    await body(await admin.json(`/events/${event.id}/cancel`, "POST", { reason: "Chuva" }));

    const { items } = await body<{ items: Item[] }>(await admin.json(`/agenda?from=${from}&to=${to}`));
    expect(items.map((i) => i.type)).toEqual(["aula", "reuniao", "nivelamento", "evento"]);
    expect(items.find((i) => i.title === "Festa junina")!.cancelled).toBe(true);
    expect([...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("filtros: tipo, professor (aulas dele e eventos em que participa) e só-aula tira eventos", async () => {
    const soReunioes = await body<{ items: Item[] }>(await admin.json(`/agenda?from=${from}&to=${to}&type=reuniao`));
    expect(soReunioes.items.map((i) => i.type)).toEqual(["reuniao"]);

    const doOutro = await body<{ items: Item[] }>(await admin.json(`/agenda?from=${from}&to=${to}&teacherId=${outro.id}`));
    expect(doOutro.items.map((i) => i.type)).toEqual(["nivelamento"]);

    const porModulo = await body<{ items: Item[] }>(await admin.json(`/agenda?from=${from}&to=${to}&moduleId=${moduleId}`));
    expect(porModulo.items.map((i) => i.type)).toEqual(["aula"]);
  });

  it("professor vê as próprias aulas e os eventos em que é participante, e mais nada", async () => {
    const { items } = await body<{ items: Item[] }>(await as(teacherCookie, `/agenda?from=${from}&to=${to}`));
    expect(items.map((i) => i.type)).toEqual(["aula", "reuniao"]);
    // e não cria evento: criar é da equipe
    const res = await as(teacherCookie, "/events", "POST", { kind: "reuniao", title: "X", startsAt: at(lessonAt.startsAt, 400), endsAt: at(lessonAt.startsAt, 430) });
    expect(res.status).toBe(403);
  });
});
