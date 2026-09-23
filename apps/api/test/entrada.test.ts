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
let cx: ReturnType<typeof as>;
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
  cx = as(await invite("cx@entrada.classa.dev", "cx"));
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

/** Primeira parcela da matrícula do card, paga pelo financeiro (aqui, o admin). */
async function payFirst(studentId: string) {
  const { installments } = await body<{ installments: { id: string; number: number }[] }>(await admin.json(`/installments?studentId=${studentId}`));
  const first = [...installments].sort((a, b) => a.number - b.number)[0]!;
  await body(await admin.json(`/installments/${first.id}/payments`, "POST", { method: "pix" }));
}

/** Fecha, paga e leva o card ao pedagógico ("a marcar"). */
async function closeAndPay(cardId: string) {
  const { card } = await body<{ card: Card }>(await move(com, cardId, "fechado"));
  await payFirst(String(card.data.studentId));
  await body(await move(com, cardId, "pago"));
  await body(await move(ped, cardId, "a_marcar"));
  return card;
}

describe("entrada do aluno", () => {
  it("fecha e paga antes do nivelamento, e só depois completa a matrícula", async () => {
    const { lead, card } = await newEntry("Joana Entrada", "123456780");
    expect(card.stage).toBe("dados");
    expect(card.data.courseId).toBe(courseId); // veio do lead

    // fechado: vira aluno, com matrícula aguardando nível e contrato emitido
    const fechado = (await body<{ card: Card }>(await move(com, card.id, "fechado"))).card;
    const studentId = String(fechado.data.studentId);
    const aguardando = await body<{ enrollments: { id: string; classGroupId: string | null; moduleId: string | null; levelPending: boolean }[] }>(
      await admin.json(`/enrollments?studentId=${studentId}`),
    );
    expect(aguardando.enrollments).toEqual([expect.objectContaining({ id: fechado.data.enrollmentId, classGroupId: null, moduleId: null, levelPending: true })]);

    // a turma vem do nivelamento, não de uma troca de turma por fora
    expect((await admin.json(`/enrollments/${fechado.data.enrollmentId}/transfer`, "POST", { classGroupId: turmaN2 })).status).toBe(422);

    // sem pagamento, não passa; o pedagógico ainda não vê
    expect((await move(com, card.id, "pago")).status).toBe(422);
    expect((await board(ped)).map((c) => c.id)).not.toContain(card.id);
    await payFirst(studentId);
    await body(await move(com, card.id, "pago"));

    // pago: o pedagógico vê e puxa. O administrativo ainda não.
    expect((await board(ped)).map((c) => c.id)).toContain(card.id);
    expect((await board(adm)).map((c) => c.id)).not.toContain(card.id);
    await body(await move(ped, card.id, "a_marcar"));
    // marcar exige data e avaliador
    expect((await move(ped, card.id, "marcado")).status).toBe(422);
    await body(await patch(ped, card.id, { levelingStartsAt: levelingAt, evaluatorPersonId: avaliador }));
    const marcado = (await body<{ card: Card }>(await move(ped, card.id, "marcado"))).card;
    expect(marcado.data.eventId).toBeTruthy();

    // o nivelamento está na agenda, com a pessoa como avaliada
    const ev = await body<{ event: { kind: string; evaluatedPersonId: string } }>(await admin.json(`/events/${marcado.data.eventId}`));
    expect(ev.event).toMatchObject({ kind: "nivelamento", evaluatedPersonId: lead.personId });

    await body(await move(com, card.id, "comunicada"));
    await body(await patch(ped, card.id, { suggestedModuleId: n2, levelingNotes: "Entende bem, fala pouco" }));
    await body(await move(ped, card.id, "nivelado"));
    const done = await body<{ event: { state: string; suggestedModuleId: string } }>(await admin.json(`/events/${marcado.data.eventId}`));
    expect(done.event).toMatchObject({ state: "realizado", suggestedModuleId: n2 });

    // agora o administrativo vê e completa a matrícula
    expect((await board(adm)).find((c) => c.id === card.id)?.canOperate).toBe(true);
    expect((await move(adm, card.id, "matricula")).status).toBe(422); // falta regime
    await body(await patch(adm, card.id, { regime: "regular", classGroupId: turmaN2 }));
    await body(await move(adm, card.id, "matricula"));
    await body(await move(adm, card.id, "concluida"));

    const leads = await body<{ leads: { id: string; stage: string; studentId: string | null }[] }>(await admin.json("/leads"));
    expect(leads.leads.find((l) => l.id === lead.id)).toMatchObject({ stage: "matriculado", studentId });
    // a mesma matrícula, agora com turma: nada de matrícula nova
    const { enrollments } = await body<{ enrollments: { id: string; classGroupId: string; levelPending: boolean }[] }>(await admin.json(`/enrollments?studentId=${studentId}`));
    expect(enrollments).toEqual([expect.objectContaining({ id: fechado.data.enrollmentId, classGroupId: turmaN2, levelPending: false })]);

    // quem passou continua vendo, mas não move mais
    const visto = (await board(com)).find((c) => c.id === card.id);
    expect(visto?.canOperate).toBe(false);
    expect((await move(com, card.id, "dados")).status).toBe(403);
  });

  it("depois de fechar, não dá para perder: a saída é Cancelamento e retenção", async () => {
    const { card } = await newEntry("Lead Fechado", "135792460");
    await body(await patch(com, card.id, { lostReason: "Preço" }));
    await body(await move(com, card.id, "fechado"));
    const res = await move(com, card.id, "perdido");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ message: expect.stringContaining("Cancelamento e retenção") });
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

  it("não compareceu volta para 'a marcar'; na terceira fica 'sem resposta', sem perder quem já pagou", async () => {
    const { lead, card } = await newEntry("Lead Sumido", "111222330");
    await closeAndPay(card.id);
    expect((await board(cx)).some((c) => c.id === card.id)).toBe(false);
    for (let i = 1; i <= 3; i++) {
      await body(await patch(ped, card.id, { levelingStartsAt: levelingAt.replace("T14", `T${9 + i}`), evaluatorPersonId: avaliador }));
      const m = (await body<{ card: Card }>(await move(ped, card.id, "marcado"))).card;
      const eventId = String(m.data.eventId);
      const after = (await body<{ card: Card }>(await ped(`/cards/${card.id}/no-show`, "POST"))).card;
      const ev = await body<{ event: { state: string } }>(await admin.json(`/events/${eventId}`));
      expect(ev.event.state).toBe("nao_compareceu");
      expect(after).toMatchObject({ stage: "a_marcar", data: { noShows: i, unresponsive: i >= 3 } });
      expect(after.data.eventId).toBeUndefined();
    }
    const leads = await body<{ leads: { id: string; stage: string }[] }>(await admin.json("/leads"));
    expect(leads.leads.find((l) => l.id === lead.id)!.stage).not.toBe("perdido");
    // o CX passa a ver o card, só para procurar o aluno
    const doCx = (await board(cx)).find((c) => c.id === card.id);
    expect(doCx?.canOperate).toBe(false);
    expect((await move(cx, card.id, "marcado")).status).toBe(403);
    // remarcou: a marca sai e o card some para o CX
    await body(await patch(ped, card.id, { levelingStartsAt: levelingAt.replace("T14", "T15"), evaluatorPersonId: avaliador }));
    await body(await move(ped, card.id, "marcado"));
    expect((await board(cx)).some((c) => c.id === card.id)).toBe(false);
  });

  it("sem vaga na semana pedida: fica em 'a marcar' com a próxima data, e o comercial vê", async () => {
    const { card } = await newEntry("Lead Sem Vaga", "444555660");
    // fora de "a marcar", não
    expect((await ped(`/cards/${card.id}/no-slot`, "POST", { nextPossibleOn: "2099-01-10" })).status).toBe(422);
    await closeAndPay(card.id);
    // o comercial não registra: é do pedagógico
    expect((await com(`/cards/${card.id}/no-slot`, "POST", { nextPossibleOn: "2099-01-10" })).status).toBe(403);
    expect((await ped(`/cards/${card.id}/no-slot`, "POST", { nextPossibleOn: "2000-01-10" })).status).toBe(400);
    const { card: after } = await body<{ card: Card }>(await ped(`/cards/${card.id}/no-slot`, "POST", { nextPossibleOn: "2099-01-10" }));
    expect(after).toMatchObject({ stage: "a_marcar", data: { nextPossibleOn: "2099-01-10" } });
    const visto = (await board(com)).find((c) => c.id === card.id)!;
    expect(visto.data.nextPossibleOn).toBe("2099-01-10");
    const { transitions } = await body<{ transitions: { note: string | null }[] }>(await com(`/cards/${card.id}`));
    expect(transitions.at(-1)!.note).toContain("Próxima data possível: 10/01/2099");
  });

  it("a lista de leads traz a entrada de cada um", async () => {
    const { lead, card } = await newEntry("Lead Com Entrada", "777888990");
    const { leads } = await body<{ leads: { id: string; entry: { cardId: string; stage: string } | null }[] }>(await com("/leads"));
    expect(leads.find((l) => l.id === lead.id)!.entry).toEqual({ cardId: card.id, stage: "dados" });
    expect(leads.find((l) => l.id !== lead.id && l.entry === null)).toBeTruthy();
  });
});

describe("área que matricula é da escola (D16)", () => {
  it("o admin troca para o comercial, e o comercial passa a matricular", async () => {
    const { card } = await newEntry("Lead D16", "321654980");
    await closeAndPay(card.id);
    await body(await patch(ped, card.id, { levelingStartsAt: levelingAt.replace("T14", "T15"), evaluatorPersonId: avaliador }));
    await body(await move(ped, card.id, "marcado"));
    await body(await move(com, card.id, "comunicada"));
    await body(await patch(ped, card.id, { suggestedModuleId: n1 }));
    await body(await move(ped, card.id, "nivelado"));

    // padrão: administrativo puxa, comercial não
    expect((await board(adm)).some((c) => c.id === card.id)).toBe(true);

    expect((await com("/settings/flows", "PATCH", { entryEnrollmentArea: "com" })).status).toBe(403); // só o admin configura
    await body(await admin.json("/settings/flows", "PATCH", { entryEnrollmentArea: "com" }));
    const { stageAreas } = await body<{ stageAreas: Record<string, Record<string, string>> }>(await admin.json("/flows"));
    expect(stageAreas.entrada).toMatchObject({ matricula: "com", concluida: "com", dados: "com", marcado: "ped" });

    // o administrativo não tem mais etapa nenhuma na entrada: o fluxo some para ele
    expect((await adm("/flows/entrada/cards")).status).toBe(403);
    await body(await patch(com, card.id, { regime: "open_entry" }));
    await body(await move(com, card.id, "matricula"));
    const { enrollments } = await body<{ enrollments: { regime: string; moduleId: string; levelPending: boolean }[] }>(
      await admin.json(`/enrollments?studentId=${card.data.studentId ?? (await body<{ card: Card }>(await admin.json(`/cards/${card.id}`))).card.data.studentId}`),
    );
    expect(enrollments).toEqual([expect.objectContaining({ regime: "open_entry", moduleId: n1, levelPending: false })]);

    await body(await admin.json("/settings/flows", "PATCH", { entryEnrollmentArea: "adm" }));
  });
});
