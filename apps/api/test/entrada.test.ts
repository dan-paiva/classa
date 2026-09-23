import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./harness.ts";

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: Awaited<ReturnType<Awaited<ReturnType<typeof createTestApp>>["adminOf"]>>;

const body = async <T>(res: Response) => {
  const b = (await res.json()) as T;
  if (res.status >= 400) throw new Error(`${res.status} ${JSON.stringify(b)}`);
  return b;
};
const manha = [1, 2, 3, 4, 5, 6].flatMap((d) => [8, 9, 10, 11, 14, 15].map((h) => d * 100 + h));

/** CPF válido a partir de 9 dígitos. */
function cpf(base: string) {
  const d = base.split("").map(Number);
  for (const len of [9, 10]) {
    const sum = d.slice(0, len).reduce((s, n, i) => s + n * (len + 1 - i), 0);
    const r = (sum * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join("");
}

async function joinByInvite(link: string, email: string) {
  const token = link.split("/convite/")[1]!;
  const cookie = await t.signUp(email, email.split("@")[0]!);
  expect((await t.call(`/api/invitations/${token}/accept`, { method: "POST", cookie })).status).toBe(200);
  return cookie;
}
const as = (cookie: string) => (path: string, method = "GET", payload?: unknown) =>
  t.call(`/api/t/entrada${path}`, { method, cookie, body: payload === undefined ? undefined : JSON.stringify(payload) });

type Card = { id: string; stage: string; data: Record<string, unknown>; canOperate?: boolean };

let com: ReturnType<typeof as>;
let ped: ReturnType<typeof as>;
let adm: ReturnType<typeof as>;
let courseId = "";
let n1 = "";
let n2 = "";
let turmaN2 = "";
let avaliador = "";

/** Um dia útil daqui a duas semanas, às 14h da escola. */
const levelingAt = (() => {
  const d = new Date(Date.now() + 14 * 86400_000);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T14:00`;
})();

beforeAll(async () => {
  t = await createTestApp({ allowedSignupEmails: ["admin@entrada.classa.dev"] });
  admin = await t.adminOf("entrada");
  const { course } = await body<{ course: { id: string } }>(await admin.json("/courses", "POST", { name: "Inglês", type: "grupo" }));
  courseId = course.id;
  n1 = (await body<{ module: { id: string } }>(await admin.json(`/courses/${courseId}/modules`, "POST", { name: "Nível 1" }))).module.id;
  n2 = (await body<{ module: { id: string } }>(await admin.json(`/courses/${courseId}/modules`, "POST", { name: "Nível 2" }))).module.id;
  const { teacher } = await body<{ teacher: { id: string; personId: string } }>(
    await admin.json("/teachers", "POST", { person: { name: "Prof Avaliadora" }, availability: manha, courses: [{ courseId, moduleIds: null }] }),
  );
  avaliador = teacher.personId;
  const hoje = new Date().toISOString().slice(0, 10);
  const depois = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10);
  turmaN2 = (
    await body<{ classGroup: { id: string } }>(
      await admin.json("/class-groups", "POST", {
        courseId, moduleId: n2, name: "N2 · sáb 09h", teacherId: teacher.id, startsOn: hoje, endsOn: depois, schedules: [{ weekday: 6, startTime: "09:00" }], generateWeeks: 2,
      }),
    )
  ).classGroup.id;

  const invite = async (email: string, area: string) =>
    joinByInvite((await body<{ link: string }>(await admin.json("/invitations", "POST", { email, profileType: "colaborador", level: 4, areas: { [area]: "total" } }))).link, email);
  com = as(await invite("com@entrada.classa.dev", "com"));
  ped = as(await invite("ped@entrada.classa.dev", "ped"));
  adm = as(await invite("adm@entrada.classa.dev", "adm"));
});

const board = async (who: ReturnType<typeof as>) => (await body<{ cards: Card[] }>(await who("/flows/entrada/cards"))).cards;
const move = (who: ReturnType<typeof as>, id: string, to: string) => who(`/cards/${id}/move`, "POST", { to });
const patch = (who: ReturnType<typeof as>, id: string, data: Record<string, unknown>) => who(`/cards/${id}`, "PATCH", { data });

async function newEntry(name: string, cpfBase: string) {
  const { lead } = await body<{ lead: { id: string; personId: string } }>(await com("/leads", "POST", { name, origin: "Site", courseId }));
  const { card } = await body<{ card: Card }>(
    await com("/flows/entrada/cards", "POST", { data: { leadId: lead.id, cpf: cpf(cpfBase), email: `${cpfBase}@exemplo.dev`, availability: "sáb de manhã", packageLessons: 20 } }),
  );
  return { lead, card };
}

describe("entrada do aluno", () => {
  it("atravessa comercial, pedagógico e administrativo até a matrícula", async () => {
    const { lead, card } = await newEntry("Joana Entrada", "123456780");
    expect(card.stage).toBe("dados");
    expect(card.data.courseId).toBe(courseId); // veio do lead

    // o pedagógico vê: é quem puxa a próxima etapa. O administrativo ainda não.
    expect((await board(ped)).map((c) => c.id)).toContain(card.id);
    expect((await board(adm)).map((c) => c.id)).not.toContain(card.id);

    await body(await move(ped, card.id, "a_marcar"));
    // marcar exige data e avaliador
    expect((await move(ped, card.id, "marcado")).status).toBe(422);
    await body(await patch(ped, card.id, { levelingStartsAt: levelingAt, evaluatorPersonId: avaliador }));
    const marcado = (await body<{ card: Card }>(await move(ped, card.id, "marcado"))).card;
    expect(marcado.data.eventId).toBeTruthy();

    // o nivelamento está na agenda, com o lead como avaliado
    const ev = await body<{ event: { kind: string; evaluatedPersonId: string } }>(await admin.json(`/events/${marcado.data.eventId}`));
    expect(ev.event).toMatchObject({ kind: "nivelamento", evaluatedPersonId: lead.personId });

    await body(await move(com, card.id, "comunicada"));
    await body(await patch(ped, card.id, { suggestedModuleId: n2, levelingNotes: "Entende bem, fala pouco" }));
    await body(await move(ped, card.id, "nivelado"));
    const done = await body<{ event: { state: string; suggestedModuleId: string } }>(await admin.json(`/events/${marcado.data.eventId}`));
    expect(done.event).toMatchObject({ state: "realizado", suggestedModuleId: n2 });

    // agora o administrativo vê e puxa para a matrícula
    expect((await board(adm)).find((c) => c.id === card.id)?.canOperate).toBe(true);
    expect((await move(adm, card.id, "matricula")).status).toBe(422); // falta regime
    await body(await patch(adm, card.id, { regime: "regular", classGroupId: turmaN2 }));
    const matriculado = (await body<{ card: Card }>(await move(adm, card.id, "matricula"))).card;
    expect(matriculado.data.enrollmentId).toBeTruthy();
    await body(await move(adm, card.id, "concluida"));

    const leads = await body<{ leads: { id: string; stage: string; studentId: string | null }[] }>(await admin.json("/leads"));
    expect(leads.leads.find((l) => l.id === lead.id)).toMatchObject({ stage: "matriculado", studentId: matriculado.data.studentId });
    const { enrollments } = await body<{ enrollments: { classGroupId: string }[] }>(await admin.json(`/enrollments?studentId=${matriculado.data.studentId}`));
    expect(enrollments.map((e) => e.classGroupId)).toEqual([turmaN2]);

    // quem passou continua vendo, mas não move mais
    const visto = (await board(com)).find((c) => c.id === card.id);
    expect(visto?.canOperate).toBe(false);
    expect((await move(com, card.id, "dados")).status).toBe(403);
  });

  it("criar é do comercial, dono da primeira etapa", async () => {
    const { lead } = await body<{ lead: { id: string } }>(await com("/leads", "POST", { name: "Lead Sem Card", origin: "Site" }));
    const res = await ped("/flows/entrada/cards", "POST", { data: { leadId: lead.id, cpf: cpf("222333444"), email: "x@exemplo.dev", courseId, availability: "x", packageLessons: 10 } });
    expect(res.status).toBe(403);
  });

  it("o CPF reconcilia: ex-aluno que volta como lead não vira pessoa nova", async () => {
    const velho = cpf("987654320");
    const { student } = await body<{ student: { id: string; personId: string } }>(await admin.json("/students", "POST", { person: { name: "Ex Aluno", cpf: velho } }));
    // o lead chega com e-mail: a ficha dele nasce com esse e-mail, que vai junto para a do CPF
    const { lead } = await body<{ lead: { id: string } }>(await com("/leads", "POST", { name: "Ex Aluno de Volta", email: "volta@exemplo.dev", origin: "Indicação", courseId }));
    const { card } = await body<{ card: Card }>(
      await com("/flows/entrada/cards", "POST", { data: { leadId: lead.id, cpf: velho, email: "volta@exemplo.dev", availability: "sáb", packageLessons: 10 } }),
    );
    expect(card.data.personId).toBe(student.personId);
    const leads = await body<{ leads: { id: string; personId: string }[] }>(await admin.json("/leads"));
    expect(leads.leads.find((l) => l.id === lead.id)!.personId).toBe(student.personId);
    const ficha = await body<{ student: { person: { email: string | null } } }>(await admin.json(`/students/${student.id}`));
    expect(ficha.student.person.email).toBe("volta@exemplo.dev");
  });

  it("não compareceu volta para 'a marcar'; na terceira falta o lead é perdido", async () => {
    const { lead, card } = await newEntry("Lead Sumido", "111222330");
    await body(await move(ped, card.id, "a_marcar"));
    for (let i = 1; i <= 3; i++) {
      await body(await patch(ped, card.id, { levelingStartsAt: levelingAt.replace("T14", `T${9 + i}`), evaluatorPersonId: avaliador }));
      const m = (await body<{ card: Card }>(await move(ped, card.id, "marcado"))).card;
      const eventId = String(m.data.eventId);
      const after = (await body<{ card: Card }>(await ped(`/cards/${card.id}/no-show`, "POST"))).card;
      const ev = await body<{ event: { state: string } }>(await admin.json(`/events/${eventId}`));
      expect(ev.event.state).toBe("nao_compareceu");
      if (i < 3) {
        expect(after).toMatchObject({ stage: "a_marcar", data: { noShows: i } });
        expect(after.data.eventId).toBeUndefined();
      } else {
        expect(after.stage).toBe("perdido");
      }
    }
    const leads = await body<{ leads: { id: string; stage: string; lostReason: string }[] }>(await admin.json("/leads"));
    expect(leads.leads.find((l) => l.id === lead.id)).toMatchObject({ stage: "perdido", lostReason: "Sem resposta" });
  });
});
