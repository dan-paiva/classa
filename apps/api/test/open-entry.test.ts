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
const hoje = new Date().toISOString().slice(0, 10);
const daqui90 = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);

type Slot = { id: string; startsAt: string; seatsLeft: number; full: boolean; mine: boolean; className: string };

let n1 = "";
let n2 = "";
let courseId = "";
let profId = "";

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminOf("openentry");
  const { course } = await body<{ course: { id: string } }>(await admin.json("/courses", "POST", { name: "Inglês", type: "grupo", cancelNoticeHours: 6 }));
  courseId = course.id;
  n1 = (await body<{ module: { id: string } }>(await admin.json(`/courses/${courseId}/modules`, "POST", { name: "Nível 1" }))).module.id;
  n2 = (await body<{ module: { id: string } }>(await admin.json(`/courses/${courseId}/modules`, "POST", { name: "Nível 2" }))).module.id;
  const { teacher } = await body<{ teacher: { id: string } }>(
    await admin.json("/teachers", "POST", { person: { name: "Prof Open" }, availability: manha, courses: [{ courseId, moduleIds: null }] }),
  );
  profId = teacher.id;
});

const ofertaOpen = async (name: string, moduleId: string, time: string, weekday = 2, teacherId = profId) =>
  body<{ classGroup: { id: string } }>(
    await admin.json("/class-groups", "POST", {
      courseId, moduleId, name, teacherId, regime: "open_entry",
      startsOn: hoje, endsOn: daqui90, schedules: [{ weekday, startTime: time }], generateWeeks: 4,
    }),
  );

const matriculaOpen = async (studentId: string, moduleId: string, packageLessons = 10) =>
  body<{ enrollment: { id: string } }>(
    await admin.json("/enrollments", "POST", { studentId, regime: "open_entry", courseId, moduleId, packageLessons, contract: false }),
  );

const aluno = async (nome: string) =>
  (await body<{ student: { id: string } }>(await admin.json("/students", "POST", { person: { name: nome } }))).student;

describe("open-entry", () => {
  it("a matrícula não fica presa a turma e só enxerga vaga do próprio nível", async () => {
    await ofertaOpen("Open N1 · ter 09h", n1, "09:00");
    await ofertaOpen("Open N2 · ter 10h", n2, "10:00");
    const s = await aluno("Aluna Open");
    const { enrollment } = await matriculaOpen(s.id, n1);

    const { slots } = await body<{ slots: Slot[] }>(await admin.json(`/enrollments/${enrollment.id}/vagas`));
    expect(slots.length).toBeGreaterThan(0);
    expect(new Set(slots.map((x) => x.className))).toEqual(new Set(["Open N1 · ter 09h"]));
    expect(slots.every((x) => x.seatsLeft > 0 && !x.mine)).toBe(true);

    // reservar ocupa a vaga e aparece como minha
    await body(await admin.json(`/enrollments/${enrollment.id}/vagas/${slots[0]!.id}`, "POST"));
    const depois = await body<{ slots: Slot[] }>(await admin.json(`/enrollments/${enrollment.id}/vagas`));
    expect(depois.slots.find((x) => x.id === slots[0]!.id)!.mine).toBe(true);
    expect(depois.slots.find((x) => x.id === slots[0]!.id)!.seatsLeft).toBe(slots[0]!.seatsLeft - 1);

    // de novo, não
    const repetida = await admin.json(`/enrollments/${enrollment.id}/vagas/${slots[0]!.id}`, "POST");
    expect(repetida.status).toBe(422);
  });

  it("reservar em aula de outro nível é recusado", async () => {
    const outra = await ofertaOpen("Open N2 · ter 11h", n2, "11:00");
    const s = await aluno("Aluno Nivel Errado");
    const { enrollment } = await matriculaOpen(s.id, n1);
    const aulas = await body<{ lessons: { id: string }[] }>(await admin.json(`/class-groups/${outra.classGroup.id}`));
    const res = await admin.json(`/enrollments/${enrollment.id}/vagas/${aulas.lessons[0]!.id}`, "POST");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ message: expect.stringContaining("outro nível") });
  });

  it("a vaga acaba: turma de 1 lugar não aceita o segundo", async () => {
    const oferta = await body<{ classGroup: { id: string } }>(
      await admin.json("/class-groups", "POST", {
        courseId, moduleId: n1, name: "Open N1 · qua 08h (1 vaga)", teacherId: profId, regime: "open_entry", capacity: 1,
        startsOn: hoje, endsOn: daqui90, schedules: [{ weekday: 3, startTime: "08:00" }], generateWeeks: 4,
      }),
    );
    const a = await aluno("Primeiro da Fila");
    const b = await aluno("Segundo da Fila");
    const ea = await matriculaOpen(a.id, n1);
    const eb = await matriculaOpen(b.id, n1);
    // pela listagem de vagas, e não pela primeira aula da turma: se o teste
    // roda numa quarta, a aula de hoje já está dentro da janela de reserva
    const { slots } = await body<{ slots: Slot[] }>(await admin.json(`/enrollments/${ea.enrollment.id}/vagas`));
    const alvo = slots.find((x) => x.className === "Open N1 · qua 08h (1 vaga)")!.id;
    await body(await admin.json(`/enrollments/${ea.enrollment.id}/vagas/${alvo}`, "POST"));
    const cheio = await admin.json(`/enrollments/${eb.enrollment.id}/vagas/${alvo}`, "POST");
    expect(cheio.status).toBe(422);
    expect(await cheio.json()).toMatchObject({ message: expect.stringContaining("cheia") });
  });

  it("choque com outra aula do próprio aluno é recusado", async () => {
    // duas ofertas no mesmo horário só existem com professores diferentes:
    // o mesmo professor é barrado antes, pela sobreposição de agenda dele
    const { teacher: outroProf } = await body<{ teacher: { id: string } }>(
      await admin.json("/teachers", "POST", { person: { name: "Prof Paralelo" }, availability: manha, courses: [{ courseId, moduleIds: null }] }),
    );
    await ofertaOpen("Open N1 · qui 09h A", n1, "09:00", 4);
    await ofertaOpen("Open N1 · qui 09h B", n1, "09:00", 4, outroProf.id);

    const s = await aluno("Aluna Ocupada");
    const { enrollment } = await matriculaOpen(s.id, n1);
    const { slots } = await body<{ slots: Slot[] }>(await admin.json(`/enrollments/${enrollment.id}/vagas`));
    const alvo = slots.find((x) => x.className === "Open N1 · qui 09h A")!;
    await body(await admin.json(`/enrollments/${enrollment.id}/vagas/${alvo.id}`, "POST"));

    const mesmoHorario = slots.find((x) => x.className === "Open N1 · qui 09h B" && x.startsAt === alvo.startsAt)!;
    const res = await admin.json(`/enrollments/${enrollment.id}/vagas/${mesmoHorario.id}`, "POST");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ message: expect.stringContaining("nesse horário") });
  });

  it("o saldo conta as reservas em aberto, não só as aulas já dadas", async () => {
    await ofertaOpen("Open N1 · seg 11h", n1, "11:00", 1);
    const s = await aluno("Aluna Pacote Curto");
    const { enrollment } = await matriculaOpen(s.id, n1, 2); // pacote de 2 aulas
    const { slots } = await body<{ slots: Slot[] }>(await admin.json(`/enrollments/${enrollment.id}/vagas`));
    const minhas = slots.filter((x) => x.className === "Open N1 · seg 11h");
    expect(minhas.length).toBeGreaterThanOrEqual(3);

    // as duas primeiras entram; a terceira não, porque o pacote é de 2
    await body(await admin.json(`/enrollments/${enrollment.id}/vagas/${minhas[0]!.id}`, "POST"));
    await body(await admin.json(`/enrollments/${enrollment.id}/vagas/${minhas[1]!.id}`, "POST"));
    const terceira = await admin.json(`/enrollments/${enrollment.id}/vagas/${minhas[2]!.id}`, "POST");
    expect(terceira.status).toBe(422);
    expect(await terceira.json()).toMatchObject({ message: expect.stringContaining("já reservou") });

    // cancelar uma libera a vaga de volta
    await body(await admin.json(`/lessons/${minhas[1]!.id}/students/${enrollment.id}/cancel`, "POST", {}));
    expect((await admin.json(`/enrollments/${enrollment.id}/vagas/${minhas[2]!.id}`, "POST")).status).toBe(201);
  });

  it("sem saldo não reserva", async () => {
    await ofertaOpen("Open N1 · sex 10h", n1, "10:00");
    const s = await aluno("Aluno Sem Saldo");
    const { enrollment } = await matriculaOpen(s.id, n1, 1);
    const { slots } = await body<{ slots: Slot[] }>(await admin.json(`/enrollments/${enrollment.id}/vagas`));
    // gasta o único crédito do pacote
    await body(await admin.json(`/enrollments/${enrollment.id}/credits`, "POST", { kind: "ajuste", amount: -1, justification: "teste" }));
    const res = await admin.json(`/enrollments/${enrollment.id}/vagas/${slots[0]!.id}`, "POST");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ message: expect.stringContaining("saldo") });
  });

  it("matrícula open-entry aparece nas listagens, mesmo sem turma", async () => {
    const s = await aluno("Aluna Listada");
    const { enrollment } = await matriculaOpen(s.id, n2);
    const { enrollments } = await body<{ enrollments: { id: string; regime: string; className: string | null; moduleName: string | null }[] }>(
      await admin.json(`/enrollments?studentId=${s.id}`),
    );
    const e = enrollments.find((x) => x.id === enrollment.id)!;
    expect(e.regime).toBe("open_entry");
    expect(e.className).toBeNull();
    expect(e.moduleName).toBe("Nível 2");
  });

  it("regular continua igual: inscrição automática em todas as aulas da turma", async () => {
    const turma = await body<{ classGroup: { id: string } }>(
      await admin.json("/class-groups", "POST", {
        courseId, moduleId: n1, name: "Regular N1 · seg 08h", teacherId: profId,
        startsOn: hoje, endsOn: daqui90, schedules: [{ weekday: 1, startTime: "08:00" }], generateWeeks: 4,
      }),
    );
    const s = await aluno("Aluno Regular");
    const { enrollment } = await body<{ enrollment: { id: string; regime: string } }>(
      await admin.json("/enrollments", "POST", { studentId: s.id, classGroupId: turma.classGroup.id, contract: false }),
    );
    expect(enrollment.regime).toBe("regular");
    const aulas = await body<{ lessons: { id: string; students: unknown[] }[] }>(await admin.json(`/class-groups/${turma.classGroup.id}`));
    expect(aulas.lessons.length).toBeGreaterThan(0);
    // e não dá para reservar por vaga: isso é só do open-entry
    const res = await admin.json(`/enrollments/${enrollment.id}/vagas`);
    expect(res.status).toBe(422);
  });

  it("o aluno pega a própria vaga quando o curso deixa, e não quando o curso não deixa", async () => {
    await ofertaOpen("Open N1 · sab 09h", n1, "09:00", 6);
    const email = "portal.open@openentry.classa.dev";
    const { student } = await body<{ student: { id: string; personId: string } }>(
      await admin.json("/students", "POST", { person: { name: "Aluno Portal Open", email } }),
    );
    const { enrollment } = await matriculaOpen(student.id, n1);

    const inv = await body<{ link: string }>(await admin.json("/invitations", "POST", { personId: student.personId, profileType: "aluno" }));
    const cookie = await t.signUp(email, "Aluno Portal Open");
    expect((await t.call(`/api/invitations/${inv.link.split("/convite/")[1]}/accept`, { method: "POST", cookie })).status).toBe(200);

    const comoAluno = (path: string, method = "GET") => t.call(`/api/t/openentry${path}`, { method, cookie });

    // ele enxerga as próprias vagas, agrupadas por matrícula
    const { matriculas } = await body<{ matriculas: { enrollmentId: string; moduleName: string; slots: Slot[] }[] }>(await comoAluno("/minha-area/vagas"));
    expect(matriculas).toHaveLength(1);
    expect(matriculas[0]!.moduleName).toBe("Nível 1");
    const vaga = matriculas[0]!.slots.find((x) => x.className === "Open N1 · sab 09h")!;

    // e pega sozinho, porque o curso está com auto_agenda
    expect((await comoAluno(`/minha-area/vagas/${enrollment.id}/${vaga.id}`, "POST")).status).toBe(201);

    // com auto_agenda desligado, quem marca é a secretaria
    await body(await admin.json(`/courses/${courseId}`, "PATCH", { autoAgenda: false }));
    const outra = matriculas[0]!.slots.find((x) => x.id !== vaga.id)!;
    const res = await comoAluno(`/minha-area/vagas/${enrollment.id}/${outra.id}`, "POST");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ message: expect.stringContaining("secretaria") });

    // mas a secretaria marca
    expect((await admin.json(`/enrollments/${enrollment.id}/vagas/${outra.id}`, "POST")).status).toBe(201);
  });

  it("a vaga de outro aluno não é reservável pelo portal", async () => {
    const outro = await aluno("Aluno Alheio");
    const { enrollment } = await matriculaOpen(outro.id, n1);
    const { slots } = await body<{ slots: Slot[] }>(await admin.json(`/enrollments/${enrollment.id}/vagas`));
    const cookie = await t.signUp("intruso@openentry.classa.dev", "Intruso");
    const res = await t.call(`/api/t/openentry/minha-area/vagas/${enrollment.id}/${slots[0]!.id}`, { method: "POST", cookie });
    expect(res.status).toBe(404);
  });
});

describe("open-entry: a lista não oferece o que a reserva recusa", () => {
  it("aula dentro da janela de antecedência some das vagas", async () => {
    // curso com 48h de antecedência: quase tudo da próxima semana some
    const { course } = await body<{ course: { id: string } }>(
      await admin.json("/courses", "POST", { name: "Alemão", type: "grupo", cancelNoticeHours: 48 }),
    );
    const mod = (await body<{ module: { id: string } }>(await admin.json(`/courses/${course.id}/modules`, "POST", { name: "A1" }))).module;
    const { teacher } = await body<{ teacher: { id: string } }>(
      await admin.json("/teachers", "POST", { person: { name: "Prof Alemão" }, availability: manha, courses: [{ courseId: course.id, moduleIds: null }] }),
    );
    await body(
      await admin.json("/class-groups", "POST", {
        courseId: course.id, moduleId: mod.id, name: "Open A1 · todo dia 08h", teacherId: teacher.id, regime: "open_entry",
        startsOn: hoje, endsOn: daqui90,
        schedules: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "08:00" })),
        generateWeeks: 2,
      }),
    );
    const s = await aluno("Aluna Alemão");
    const { enrollment } = await body<{ enrollment: { id: string } }>(
      await admin.json("/enrollments", "POST", { studentId: s.id, regime: "open_entry", courseId: course.id, moduleId: mod.id, contract: false }),
    );
    const { slots } = await body<{ slots: Slot[] }>(await admin.json(`/enrollments/${enrollment.id}/vagas`));
    const limite = Date.now() + 48 * 3600_000;
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((x) => new Date(x.startsAt).getTime() >= limite)).toBe(true);
  });
});
