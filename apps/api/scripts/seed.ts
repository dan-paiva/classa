/**
 * Escola de demonstração com dados 100% inventados.
 *
 *   pnpm db:seed                       # cria a escola "demo" (falha se já existir)
 *   pnpm db:seed --reset               # apaga a escola "demo" e cria de novo
 *   pnpm db:seed --member voce@x.com   # também dá acesso de admin a um usuário que já existe
 *
 * Tudo passa pelos serviços da API, então as regras (vagas, disponibilidade, choque de
 * horário, créditos, parcelas) valem aqui também. Recusa rodar fora do Postgres local
 * a menos que receba --allow-remote.
 */
import {
  authUser,
  course,
  courseModule,
  DEFAULT_TENANT_SETTINGS,
  eq,
  lesson,
  lessonStudent,
  membership,
  sql,
  tenant,
  type Database,
  type PaymentMethod,
} from "@classa/db";
import { createDb } from "@classa/db";
import { addDays, cnpjFromBase, cpfFromBase, dateInZone, slotKey } from "@classa/domain";
import { createAuth } from "../src/auth.ts";
import { createCompany, generateCharge, linkStudent, payCharge } from "../src/services/companies.ts";
import type { ServiceContext } from "../src/services/context.ts";
import { createEnrollment, listEnrollments } from "../src/services/enrollments.ts";
import { listInstallments, refreshDelinquency, registerPayment, reversePayment } from "../src/services/finance.ts";
import { cancelLesson, cancelStudentLesson, changeLessonTeacher, concludeLesson, markUnfinishedLessons, setAttendance } from "../src/services/lessons.ts";
import { createRoom, createStudent, createTeacher, setStudentStatus } from "../src/services/people.ts";
import { closeMonth, markLinePaid, overrideLessonRate, requestSupport, setClassGroupTeacherRate, computePayroll } from "../src/services/payroll.ts";
import { createClassGroup, generateLessons, importNationalHolidays } from "../src/services/schedule.ts";
import { convertLead, createCard, createLead, flowOptions, moveCard, moveLead, updateCard } from "../src/services/workflows.ts";

const SLUG = "demo";
const TZ = "America/Sao_Paulo";
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/* ---------------------------------------------------------- aleatório com semente */
let state = 20260917;
const rand = () => {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const chance = (p: number) => rand() < p;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

/* --------------------------------------------------------------- nomes inventados */
const FIRST = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabriela", "Heitor", "Isabela", "João", "Karina", "Lucas", "Marina", "Nicolas", "Olívia", "Paulo", "Rafaela", "Samuel", "Tatiana", "Vitor", "Yasmin", "André", "Beatriz", "Caio", "Débora", "Eduardo", "Fernanda", "Gustavo", "Helena", "Igor", "Júlia", "Leonardo", "Manuela", "Otávio", "Priscila", "Renato", "Sofia", "Thiago", "Valéria", "William"];
const LAST = ["Almeida", "Barros", "Cardoso", "Duarte", "Esteves", "Ferraz", "Gouveia", "Holanda", "Lacerda", "Macedo", "Nogueira", "Oliveira", "Pacheco", "Queiroz", "Rezende", "Siqueira", "Toledo", "Vasconcelos", "Xavier", "Zanetti", "Brandão", "Coutinho", "Dantas", "Figueira", "Guimarães", "Leal", "Moreira", "Peixoto", "Rocha", "Teixeira"];
const usedNames = new Set<string>();
function fullName() {
  for (;;) {
    const name = `${pick(FIRST)} ${pick(LAST)}${chance(0.35) ? ` ${pick(LAST)}` : ""}`;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
}
const emailOf = (name: string) =>
  `${name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(" ").join(".")}@exemplo.com`;
let cpfSeq = 100000000;
const nextCpf = () => cpfFromBase(String(cpfSeq++ * 7 + 13).slice(-9));
const phone = () => `119${int(10000000, 99999999)}`;

/* ------------------------------------------------------------------------ util */
const log = (msg: string) => console.log(`· ${msg}`);
const at = (base: Omit<ServiceContext, "now">, now: Date): ServiceContext => ({ ...base, now });
const localMidnight = (date: string) => new Date(`${date}T03:00:00Z`); // 00:00 em São Paulo (UTC-3)

async function resetDemo(db: Database) {
  const [t] = await db.select().from(tenant).where(eq(tenant.slug, SLUG));
  if (!t) return;
  const id = t.id;
  // ordem inversa das dependências
  for (const table of [
    "membership", "invitation", "workflow_transition", "workflow_card", "lead", "company_charge", "payroll_line", "payroll_period", "payment", "installment", "contract", "credit_entry", "lesson_student", "lesson", "enrollment",
    "class_schedule", "class_group", "holiday", "teacher_course", "teacher", "student", "company", "person",
    "room", "course_module", "course", "audit_log",
  ]) {
    await db.execute(sql.raw(`delete from ${table} where tenant_id = '${id}'`));
  }
  await db.delete(tenant).where(eq(tenant.id, id));
  log("escola demo anterior apagada");
}

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://classa:classa@localhost:5432/classa";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !flag("--allow-remote")) {
    throw new Error("O seed só roda no Postgres local. Use --allow-remote se tiver certeza.");
  }
  const { db, close } = createDb(url);
  try {
    if (flag("--reset")) await resetDemo(db);
    const [exists] = await db.select().from(tenant).where(eq(tenant.slug, SLUG));
    if (exists) throw new Error('A escola "demo" já existe. Rode com --reset para recriar.');

    const realNow = new Date();
    const today = dateInZone(realNow, TZ);

    /* ---------------------------------------------------------- escola e acesso */
    const [school] = await db.insert(tenant).values({ name: "Escola Demo", slug: SLUG, settings: DEFAULT_TENANT_SETTINGS }).returning();
    const auth = createAuth({ db, secret: "seed-local-nao-usado-em-producao-000000", baseURL: "http://localhost:8787" });
    const demoEmail = "admin@demo.classa.dev";
    let [demoUser] = await db.select().from(authUser).where(eq(authUser.email, demoEmail));
    if (!demoUser) {
      await auth.api.signUpEmail({ body: { email: demoEmail, password: "classa-demo-123", name: "Admin Demo" } });
      [demoUser] = await db.select().from(authUser).where(eq(authUser.email, demoEmail));
    }
    await db.insert(membership).values({ tenantId: school!.id, userId: demoUser!.id, role: "admin" });
    const member = option("--member");
    if (member) {
      const [u] = await db.select().from(authUser).where(eq(authUser.email, member.toLowerCase()));
      if (u) {
        await db.insert(membership).values({ tenantId: school!.id, userId: u.id, role: "admin" }).onConflictDoNothing();
        log(`${member} também é admin da escola demo`);
      } else {
        log(`${member} não tem conta local; ignorado`);
      }
    }
    const base = { db, tenantId: school!.id, actorId: demoUser!.id, timezone: TZ, settings: DEFAULT_TENANT_SETTINGS };
    const nowCtx = at(base, realNow);

    const start = addDays(today, -49); // 7 semanas atrás
    const end = addDays(today, 150);
    await importNationalHolidays(nowCtx, Number(today.slice(0, 4)));
    await importNationalHolidays(nowCtx, Number(today.slice(0, 4)) + 1);

    /* ------------------------------------------------------------------ cursos */
    const mkCourse = async (v: Omit<typeof course.$inferInsert, "tenantId">, modules: string[] = []) => {
      const [c] = await db.insert(course).values({ ...v, tenantId: school!.id }).returning();
      const mods = [];
      for (const [i, name] of modules.entries()) {
        const [m] = await db.insert(courseModule).values({ tenantId: school!.id, courseId: c!.id, name, color: v.color, position: i + 1 }).returning();
        mods.push(m!);
      }
      return { ...c!, modules: mods };
    };
    const ingles = await mkCourse(
      { name: "Inglês em Grupo", type: "grupo", color: "#1e46c8", capacity: 8, lessonMinutes: 60, packageLessons: 48, cancelNoticeHours: 6, lessonPriceCents: 6000, modalities: ["online", "presencial"] },
      ["Básico 1", "Básico 2", "Intermediário 1", "Intermediário 2", "Avançado"],
    );
    const espanhol = await mkCourse(
      { name: "Espanhol em Grupo", type: "grupo", color: "#b42318", capacity: 6, lessonMinutes: 60, packageLessons: 36, cancelNoticeHours: 6, lessonPriceCents: 6600, modalities: ["online"] },
      ["Básico", "Intermediário"],
    );
    const particular = await mkCourse({
      name: "Inglês Particular", type: "particular", color: "#0b1220", capacity: 1, lessonMinutes: 60, packageLessons: 32, cancelNoticeHours: 24, lessonPriceCents: 14000, modalities: ["online", "presencial"],
    });
    const corporativo = await mkCourse(
      { name: "Inglês Corporativo", type: "turmas_dedicadas", color: "#0f766e", capacity: 12, lessonMinutes: 60, packageLessons: 36, cancelNoticeHours: 6, lessonPriceCents: 5000, modalities: ["presencial"] },
      ["Turma Manhã", "Turma Almoço"],
    );
    await mkCourse({ name: "Workshop de Pronúncia", type: "workshop", color: "#6d28d9", capacity: 20, lessonMinutes: 90, packageLessons: 1, cancelNoticeHours: 24, lessonPriceCents: 8000, modalities: ["online"] });
    log("5 cursos e 9 módulos");

    /* ------------------------------------------------------------------- salas */
    const rooms = {
      v1: await createRoom(nowCtx, { name: "Sala Virtual 1", kind: "virtual", link: "https://meet.jit.si/classa-demo-sala-1" }),
      v2: await createRoom(nowCtx, { name: "Sala Virtual 2", kind: "virtual", link: "https://meet.jit.si/classa-demo-sala-2" }),
      v3: await createRoom(nowCtx, { name: "Sala Virtual 3", kind: "virtual", link: "https://meet.jit.si/classa-demo-sala-3" }),
      s101: await createRoom(nowCtx, { name: "Sala 101", kind: "presencial", capacity: 10 }),
      s102: await createRoom(nowCtx, { name: "Sala 102", kind: "presencial", capacity: 12 }),
      aud: await createRoom(nowCtx, { name: "Auditório", kind: "auditorio", capacity: 40 }),
    };
    log("6 salas");

    /* -------------------------------------------------------------- professores */
    const range = (days: number[], hours: number[]) => days.flatMap((d) => hours.map((h) => slotKey(d, h)));
    const all = (c: { id: string }) => ({ courseId: c.id, moduleIds: null });
    const teacherSpecs = [
      { avail: range([1, 3, 5], [18, 19, 20, 21]), courses: [all(ingles), all(particular)], rate: 7000 },
      { avail: range([2, 4], [18, 19, 20, 21]), courses: [all(ingles)], rate: 6500 },
      { avail: range([1, 2, 3, 4, 5], [7, 8, 9, 12, 13]), courses: [all(corporativo), all(ingles)], rate: 8000 },
      { avail: range([1, 3], [18, 19, 20]), courses: [all(espanhol)], rate: 7000 },
      { avail: range([2, 4, 6], [9, 10, 11, 18, 19]), courses: [all(espanhol), { courseId: ingles.id, moduleIds: [ingles.modules[0]!.id, ingles.modules[1]!.id] }], rate: 6000 },
      { avail: range([6], [8, 9, 10, 11, 12]), courses: [all(ingles), all(particular)], rate: 7500 },
      { avail: range([1, 2, 3, 4, 5], [14, 15, 16, 17]), courses: [all(particular)], rate: 9000 },
      { avail: range([1, 2, 3, 4, 5], [18, 19, 20, 21]), courses: [all(particular), all(ingles)], rate: 8500 },
      { avail: range([2, 4], [12, 13, 18, 19]), courses: [all(ingles), all(corporativo)], rate: 7000 },
      { avail: range([1, 3, 5], [7, 8, 18, 19]), courses: [all(ingles), all(espanhol)], rate: 6500, inactive: true },
    ];
    const teachers = [];
    for (const spec of teacherSpecs) {
      const name = fullName();
      const t = await createTeacher(nowCtx, {
        person: { name, email: emailOf(name), phone: phone(), cpf: nextCpf() },
        availability: spec.avail,
        courses: spec.courses,
        hourlyRateCents: spec.rate,
        weeklyLimit: pick([16, 20, 24]),
      });
      teachers.push({ ...t, name });
    }
    log(`${teachers.length} professores`);

    /* ------------------------------------------------------------------- turmas */
    type Spec = { course: typeof ingles; module?: number; name: string; teacher: number; room: keyof typeof rooms; modality: "online" | "presencial"; schedules: [number, string][]; capacity?: number };
    const groupSpecs: Spec[] = [
      { course: ingles, module: 0, name: "Básico 1 · Seg e Qua 19h", teacher: 0, room: "v1", modality: "online", schedules: [[1, "19:00"], [3, "19:00"]] },
      { course: ingles, module: 1, name: "Básico 2 · Ter e Qui 19h", teacher: 1, room: "v1", modality: "online", schedules: [[2, "19:00"], [4, "19:00"]] },
      { course: ingles, module: 2, name: "Intermediário 1 · Seg e Qua 20h", teacher: 0, room: "v2", modality: "online", schedules: [[1, "20:00"], [3, "20:00"]] },
      { course: ingles, module: 3, name: "Intermediário 2 · Ter e Qui 20h", teacher: 1, room: "v2", modality: "online", schedules: [[2, "20:00"], [4, "20:00"]] },
      { course: ingles, module: 4, name: "Avançado · Sábado 9h", teacher: 5, room: "s101", modality: "presencial", schedules: [[6, "09:00"]] },
      { course: ingles, module: 0, name: "Básico 1 · Sábado 11h", teacher: 5, room: "s101", modality: "presencial", schedules: [[6, "11:00"]] },
      { course: ingles, module: 2, name: "Intermediário 1 · Ter e Qui 18h", teacher: 8, room: "s102", modality: "presencial", schedules: [[2, "18:00"], [4, "18:00"]] },
      { course: espanhol, module: 0, name: "Básico · Seg e Qua 18h", teacher: 3, room: "v3", modality: "online", schedules: [[1, "18:00"], [3, "18:00"]] },
      { course: espanhol, module: 1, name: "Intermediário · Ter e Qui 18h", teacher: 4, room: "v3", modality: "online", schedules: [[2, "18:00"], [4, "18:00"]] },
      { course: corporativo, module: 0, name: "Empresa Alfa · Manhã", teacher: 2, room: "s102", modality: "presencial", schedules: [[2, "08:00"], [4, "08:00"]] },
      { course: corporativo, module: 1, name: "Empresa Alfa · Almoço", teacher: 8, room: "s101", modality: "presencial", schedules: [[2, "12:00"], [4, "12:00"]] },
    ];
    const groups: Awaited<ReturnType<typeof createClassGroup>>["classGroup"][] = [];
    for (const g of groupSpecs) {
      const { classGroup } = await createClassGroup(nowCtx, {
        courseId: g.course.id,
        moduleId: g.module === undefined ? null : g.course.modules[g.module]!.id,
        name: g.name,
        teacherId: teachers[g.teacher]!.id,
        roomId: rooms[g.room].id,
        modality: g.modality,
        capacity: g.capacity,
        startsOn: start,
        endsOn: end,
        schedules: g.schedules.map(([weekday, startTime]) => ({ weekday, startTime })),
      });
      groups.push(classGroup);
    }
    // uma turma nova, que começa daqui a 2 semanas e ainda está vazia
    const nova = await createClassGroup(nowCtx, {
      courseId: espanhol.id, moduleId: espanhol.modules[0]!.id, name: "Básico · Sábado 10h (nova)", teacherId: teachers[4]!.id,
      roomId: rooms.v3.id, modality: "online", startsOn: addDays(today, 14), endsOn: end, schedules: [{ weekday: 6, startTime: "10:00" }],
    });
    groups.push(nova.classGroup);
    log(`${groups.length} turmas em grupo`);

    /* ------------------------------------------------------------------- alunos */
    const students: { id: string; name: string }[] = [];
    for (let i = 0; i < 62; i++) {
      const name = fullName();
      const s = await createStudent(nowCtx, {
        person: { name, email: chance(0.9) ? emailOf(name) : null, cpf: chance(0.85) ? nextCpf() : null, phone: chance(0.8) ? phone() : null },
        availability: range([1, 2, 3, 4, 5], [18, 19, 20]),
      });
      students.push({ id: s.id, name });
    }
    log(`${students.length} alunos`);

    /* ----------------------------------------------------------------- empresas */
    const vetor = await createCompany(nowCtx, {
      name: "Vetor Engenharia", cnpj: cnpjFromBase("481203550001"), segment: "Engenharia", model: "b2b",
      hrName: "Equipe de Pessoas", hrEmail: "pessoas@vetor.exemplo.com", startsOn: addDays(today, -58), endsOn: addDays(today, 25),
      licenses: 5, contractedLessons: 120, licensePriceCents: 42000, autoRenew: false,
    });
    const bemEstar = await createCompany(nowCtx, {
      name: "Rede Bem Estar", cnpj: cnpjFromBase("732118040001"), segment: "Saúde", model: "b2b2c",
      hrName: "Benefícios", hrEmail: "beneficios@bemestar.exemplo.com", startsOn: addDays(today, -120), endsOn: addDays(today, 245),
      licenses: 12, contractedLessons: 480, licensePriceCents: 36000, subsidyPercent: 50, discountPercent: 15,
    });
    const alfa = await createCompany(nowCtx, {
      name: "Alfa Logística", cnpj: cnpjFromBase("905531770001"), segment: "Logística", model: "b2b",
      hrName: "Treinamento", startsOn: addDays(today, -60), endsOn: addDays(today, 300), licenses: 24, contractedLessons: 600, licensePriceCents: 25000,
      allowedCourseIds: [corporativo.id],
    });
    for (const st of students.slice(40, 46)) await linkStudent(nowCtx, vetor.id, st.id);
    for (const st of students.slice(46, 52)) await linkStudent(nowCtx, bemEstar.id, st.id);
    log("3 empresas (B2B perto de vencer e acima das licenças, B2B2C com subsídio, B2B de turmas dedicadas)");

    /* -------------------------------------------------------- aulas particulares */
    const particularSpecs: [number, [number, string][], "online" | "presencial", keyof typeof rooms][] = [
      [6, [[1, "15:00"], [3, "15:00"]], "online", "v1"],
      [6, [[2, "16:00"]], "presencial", "s101"],
      [7, [[5, "19:00"]], "online", "v2"],
      [7, [[2, "21:00"], [4, "21:00"]], "online", "v3"],
      [0, [[5, "18:00"]], "online", "v3"],
      [5, [[6, "12:00"]], "presencial", "s102"],
    ];
    const particulares = [];
    for (const [i, [teacherIdx, schedules, modality, roomKey]] of particularSpecs.entries()) {
      const s = students[i]!;
      const { classGroup } = await createClassGroup(nowCtx, {
        courseId: particular.id, name: `Particular · ${s.name}`, teacherId: teachers[teacherIdx]!.id, roomId: rooms[roomKey].id, modality,
        startsOn: start, endsOn: end, schedules: schedules.map(([weekday, startTime]) => ({ weekday, startTime })),
      });
      await setClassGroupTeacherRate(nowCtx, classGroup.id, pick([10000, 12000, 12000, 15000]));
      particulares.push({ classGroup, student: s });
    }
    log(`${particulares.length} aulas particulares`);

    /* -------------------------------------------------------------------- aulas */
    let generated = 0;
    for (const g of [...groups, ...particulares.map((p) => p.classGroup)]) {
      const r = await generateLessons(nowCtx, g.id, { from: start, to: addDays(today, 56) });
      generated += r.created;
      if (r.conflicts.length) log(`atenção: ${r.conflicts.length} choques em ${g.name}`);
    }
    log(`${generated} aulas geradas (7 semanas para trás e 8 para a frente)`);

    /* --------------------------------------------------------------- matrículas */
    const methods: PaymentMethod[] = ["pix", "pix", "pix", "cartao_credito", "cartao_credito", "boleto", "transferencia", "cartao_debito", "dinheiro"];
    let enrollments = 0;
    const enroll = async (studentId: string, classGroupId: string, opts: { startsOn: string; packageLessons?: number; contract?: false | { discountCents?: number; installments?: number } }) => {
      try {
        await createEnrollment(at(base, localMidnight(opts.startsOn)), { studentId, classGroupId, ...opts });
        enrollments++;
      } catch (err) {
        if ((err as { status?: number }).status !== 422) throw err; // curso fora do contrato da empresa: segue
      }
    };

    for (const p of particulares) {
      await enroll(p.student.id, p.classGroup.id, { startsOn: start, packageLessons: pick([16, 24, 32]), contract: { installments: pick([3, 6, 6]) } });
    }
    let si = 0;
    const fill = [6, 5, 8, 4, 7, 3, 6, 5, 4, 10, 9, 0]; // ocupação alvo por turma (a de índice 2 fica cheia)
    for (const [gi, g] of groups.entries()) {
      for (let k = 0; k < Math.min(fill[gi]!, g.capacity); k++) {
        const s = students[si++ % students.length]!;
        const corporate = g.courseId === corporativo.id;
        const late = chance(0.25);
        await enroll(s.id, g.id, {
          startsOn: late ? addDays(start, int(7, 28)) : start,
          // pacotes pequenos para quem entrou no começo: aparecem com 80%+ usado e perto de renovar
          packageLessons: corporate ? 36 : late ? pick([48, 36, 24]) : pick([48, 36, 24, 16, 14, 13]),
          contract: corporate ? false : { installments: pick([6, 6, 6, 3, 12, 1]), discountCents: chance(0.2) ? pick([10000, 20000, 28800]) : 0 },
        });
      }
    }
    log(`${enrollments} matrículas com contrato e parcelas (turmas corporativas e alunos B2B sem cobrança individual)`);

    // colaboradores das turmas dedicadas ficam ligados à empresa cliente
    const corporateGroups = new Set(groups.filter((g) => g.courseId === corporativo.id).map((g) => g.id));
    const corporateStudents = (await listEnrollments(nowCtx, { activeOnly: true })).filter((e) => corporateGroups.has(e.classGroupId));
    for (const e of corporateStudents) {
      try {
        await linkStudent(nowCtx, alfa.id, e.studentId);
      } catch {
        // já vinculado a outra empresa
      }
    }

    /* --------------------------------------------- simulação das aulas passadas */
    const past = await db
      .select({ id: lesson.id, startsAt: lesson.startsAt, endsAt: lesson.endsAt, courseId: lesson.courseId, moduleId: lesson.moduleId, teacherId: lesson.teacherId })
      .from(lesson)
      .where(sql`${lesson.tenantId} = ${school!.id} and ${lesson.endsAt} < ${realNow.toISOString()}`)
      .orderBy(lesson.startsAt);
    let concluded = 0;
    let cancelled = 0;
    let substituted = 0;
    let unfinished = 0;
    let supports = 0;
    const recent = new Date(realNow.getTime() - 7 * 86400_000);
    for (const l of past) {
      const before = (hours: number) => at(base, new Date(l.startsAt.getTime() - hours * 3600_000));
      if (chance(0.04)) {
        await cancelLesson(before(48), l.id, pick(["Professor doente", "Feriado local", "Problema na sala", "Evento da escola"]));
        cancelled++;
        continue;
      }
      if (chance(0.04)) {
        for (const t of teachers.filter((x) => x.id !== l.teacherId)) {
          try {
            await changeLessonTeacher(before(24), l.id, t.id);
            substituted++;
            break;
          } catch {
            // professor não habilitado, indisponível ou com choque: tenta o próximo
          }
        }
      }
      const roster = await db.select().from(lessonStudent).where(eq(lessonStudent.lessonId, l.id));
      for (const r of roster) {
        if (chance(0.05)) await cancelStudentLesson(before(30), l.id, r.enrollmentId);
        else if (chance(0.02)) await cancelStudentLesson(before(2), l.id, r.enrollmentId);
      }
      if (new Date(l.startsAt).getTime() > recent.getTime() && chance(0.15)) {
        unfinished++;
        continue; // o professor esqueceu de fechar a aula
      }
      const after = at(base, new Date(l.endsAt.getTime() + 20 * 60000));
      const present = (await db.select().from(lessonStudent).where(eq(lessonStudent.lessonId, l.id))).filter((r) => r.status === "inscrito");
      if (present.length) {
        await setAttendance(after, l.id, present.map((r) => ({ enrollmentId: r.enrollmentId, status: chance(0.86) ? ("presente" as const) : ("falta" as const) })));
      }
      await concludeLesson(after, l.id);
      concluded++;
      if (chance(0.03)) {
        await requestSupport(after, l.id, { reason: pick(["pedagogico", "tecnico", "comportamento", "substituicao_parcial"] as const), detail: "Registrado pelo professor ao fim da aula" });
        supports++;
      }
    }
    await markUnfinishedLessons(nowCtx);
    log(`${concluded} aulas concluídas com presença, ${cancelled} canceladas, ${substituted} com substituto, ${unfinished} não finalizadas, ${supports} com pedido de suporte`);

    /* ------------------------------------------------------------------ folha */
    const privateLessons = await db
      .select({ id: lesson.id, endsAt: lesson.endsAt })
      .from(lesson)
      .where(sql`${lesson.tenantId} = ${school!.id} and ${lesson.state} = 'concluida' and ${lesson.classGroupId} in (${sql.join(particulares.map((p) => sql`${p.classGroup.id}`), sql`, `)})`)
      .limit(3);
    for (const pl of privateLessons.slice(0, 2)) {
      await overrideLessonRate(at(base, new Date(pl.endsAt.getTime() + 3600_000)), pl.id, { cents: 8000, reason: "Aula encerrada 20 minutos antes" });
    }
    const lastMonth = (() => {
      const [y, m] = today.split("-").map(Number);
      return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
    })();
    const folha = await computePayroll(nowCtx, lastMonth);
    if (folha.status === "pronta") {
      await closeMonth(nowCtx, lastMonth);
      const fechada = await computePayroll(nowCtx, lastMonth);
      for (const line of fechada.lines.slice(0, -2)) await markLinePaid(nowCtx, line.lineId!, today);
      log(`folha de ${lastMonth} fechada (${fechada.lines.length} professores, 2 ainda sem pagamento)`);
    } else {
      log(`folha de ${lastMonth} não fechada: ${folha.status}`);
    }

    /* --------------------------------------------------------------- pagamentos */
    const due = (await listInstallments(nowCtx)).filter((i) => i.dueDate <= today && i.status !== "cancelada");
    const debtors = new Set(students.slice(10, 16).map((s) => s.id)); // alguns alunos atrasam de propósito
    let paid = 0;
    let partial = 0;
    let open = 0;
    const payments: string[] = [];
    for (const i of due) {
      const debtor = debtors.has(i.studentId);
      if (debtor && i.dueDate >= addDays(today, -45)) {
        open++;
        continue;
      }
      if (!debtor && chance(0.05)) {
        open++;
        continue;
      }
      const paidOn = [addDays(i.dueDate, int(-5, 3)), today].sort()[0]!;
      const ctx = at(base, new Date(`${paidOn}T15:00:00Z`));
      if (chance(0.06)) {
        await registerPayment(ctx, i.id, { method: pick(methods), paidOn, amountCents: Math.floor(i.amountCents / 2) });
        partial++;
      } else {
        const p = await registerPayment(ctx, i.id, { method: pick(methods), paidOn });
        payments.push(p.id);
        paid++;
      }
    }
    for (const id of payments.slice(3, 5)) {
      await reversePayment(nowCtx, id, "Pagamento contestado no cartão");
    }
    log(`${paid} parcelas pagas, ${partial} pagas pela metade, ${open} em aberto, 2 estornos`);

    /* ------------------------------------------------ cobranças das empresas */
    for (const co of [vetor, bemEstar, alfa]) {
      for (const month of [lastMonth, today.slice(0, 7)]) {
        try {
          const ch = await generateCharge(nowCtx, co.id, month);
          if (month === lastMonth && co.id !== bemEstar.id) await payCharge(nowCtx, ch.id, { method: "boleto", paidOn: `${month}-12` });
        } catch {
          // mês fora da vigência
        }
      }
    }
    log("cobranças das empresas do mês anterior e do atual (Rede Bem Estar com o mês anterior em aberto)");

    /* ------------------------------------------------------ situações variadas */
    const act = students.slice(30);
    await setStudentStatus(nowCtx, act[0]!.id, "cancelado");
    await setStudentStatus(nowCtx, act[1]!.id, "congelado");
    await setStudentStatus(nowCtx, act[2]!.id, "suspenso");
    await setStudentStatus(nowCtx, students[61]!.id, "inativo");
    const changed = await refreshDelinquency(nowCtx);
    log(`situações: 1 cancelado, 1 congelado, 1 suspenso, 1 inativo, ${changed} inadimplentes automáticos`);

    /* ------------------------------------------------------------------ leads */
    const origins = ["Site", "Redes sociais", "Indicação", "Buscador", "Empresa parceira", "Evento"];
    const courseIds = [ingles.id, espanhol.id, particular.id];
    let leads = 0;
    for (let i = 0; i < 28; i++) {
      const name = fullName();
      const born = at(base, new Date(realNow.getTime() - int(1, 40) * 86400_000));
      const l = await createLead(born, { name, email: chance(0.8) ? emailOf(name) : null, phone: phone(), origin: pick(origins), courseId: pick(courseIds), temperature: pick(["frio", "morno", "quente", null] as const), consent: true });
      const steps = pick([0, 0, 1, 1, 2, 3, 3, 4, 5]);
      const later = at(base, new Date(Math.min(realNow.getTime(), born.now.getTime() + int(1, 20) * 86400_000)));
      for (let k = 0; k < Math.min(steps, 3); k++) await moveLead(later, l.id, { to: "avancar" });
      if (steps === 4) await convertLead(later, l.id);
      if (steps === 5) await moveLead(later, l.id, { to: "perdido", reason: pick(["Preço", "Horário", "Sem resposta", "Escolheu outra escola", "Adiou os estudos"]) });
      leads++;
    }
    log(`${leads} leads espalhados pelo funil`);

    /* ----------------------------------------------------------------- fluxos */
    const tryFlow = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        log(`fluxo "${label}" pulado: ${(err as Error).message}`);
      }
    };
    const subOptions = ((await flowOptions(nowCtx, "substituicao")) as { lessons?: { id: string; teacherId: string | null }[] }).lessons ?? [];
    const levelOptions = (await flowOptions(nowCtx, "nivel")).enrollments ?? [];
    await tryFlow("substituição", async () => {
      const aula = subOptions.find((l) => l.teacherId);
      const card = await createCard(nowCtx, "substituicao", { lessonId: aula!.id, reason: "Doença" });
      await moveCard(nowCtx, card.id, "buscando", "Pedi disponibilidade para dois professores");
    });
    await tryFlow("substituição", async () => {
      await createCard(nowCtx, "substituicao", { lessonId: subOptions[5]!.id, reason: "Compromisso pessoal" });
    });
    await tryFlow("mudança de nível", async () => {
      const e = levelOptions.find((x) => x.className.startsWith("Básico 1 · Seg"));
      const target = groups.find((g) => g.name.startsWith("Básico 2"));
      const card = await createCard(nowCtx, "nivel", { enrollmentId: e!.id });
      await moveCard(nowCtx, card.id, "teste");
      await updateCard(nowCtx, card.id, { result: "A2 consolidado", targetClassGroupId: target!.id });
    });
    await tryFlow("reposição", async () => {
      const absences = (await flowOptions(nowCtx, "reposicao")).absences ?? [];
      await createCard(nowCtx, "reposicao", { missedLessonStudentId: absences[0]!.id, notes: "Atestado médico" });
    });
    await tryFlow("admissão", async () => {
      await createCard(nowCtx, "admissao", { name: "Candidata Aula Teste", email: "candidata@exemplo.com", notes: "Indicação de professor" });
      const c2 = await createCard(nowCtx, "admissao", { name: "Candidato Espanhol", email: "candidato.es@exemplo.com" });
      await moveCard(nowCtx, c2.id, "entrevista");
    });
    await tryFlow("cobrança", async () => {
      const debtors = (await flowOptions(nowCtx, "cobranca")).students ?? [];
      const card = await createCard(nowCtx, "cobranca", { studentId: debtors[0]!.id, method: "pix" });
      await moveCard(nowCtx, card.id, "contato", "Mensagem enviada");
      await updateCard(nowCtx, card.id, { agreement: "Quita tudo até o dia 30" });
      await moveCard(nowCtx, card.id, "negociacao");
    });
    await tryFlow("retenção", async () => {
      const st = students[20]!;
      const card = await createCard(nowCtx, "retencao", { studentId: st.id, reason: "Horário" });
      await updateCard(nowCtx, card.id, { offer: "Troca para a turma de sábado sem custo" });
      await moveCard(nowCtx, card.id, "tentativa");
    });
    await tryFlow("campanha", async () => {
      const c1 = await createCard(nowCtx, "campanha", { name: "Volta às aulas de outubro", channel: "Redes sociais", audience: "Adultos 25-40 na região" });
      await moveCard(nowCtx, c1.id, "producao");
      await createCard(nowCtx, "campanha", { name: "Indique um amigo" });
    });
    log("cartões em todos os fluxos (substituição, nível, reposição, admissão, cobrança, retenção, campanhas)");

    /* --------------------------------------------- contas de cada perfil (demo) */
    const account = async (email: string, name: string) => {
      let [u] = await db.select().from(authUser).where(eq(authUser.email, email));
      if (!u) {
        await auth.api.signUpEmail({ body: { email, password: "classa-demo-123", name } });
        [u] = await db.select().from(authUser).where(eq(authUser.email, email));
      }
      return u!;
    };
    const { person: personTable, student: studentTable, teacher: teacherTable } = await import("@classa/db");
    const [teacherPerson] = await db.select({ personId: teacherTable.personId }).from(teacherTable).where(eq(teacherTable.id, teachers[0]!.id));
    const privateStudent = particulares[0]!.student;
    const [studentPerson] = await db.select({ personId: studentTable.personId }).from(studentTable).where(eq(studentTable.id, privateStudent.id));
    const demoProfiles = [
      { email: "coordenacao@demo.classa.dev", name: "Coordenação Demo", profileType: "colaborador" as const, level: 2, areas: { ped: "total" as const, aca: "restrito" as const }, personId: null },
      { email: "financeiro@demo.classa.dev", name: "Financeiro Demo", profileType: "colaborador" as const, level: 3, areas: { fin: "total" as const, aca: "restrito" as const }, personId: null },
      { email: "professor@demo.classa.dev", name: teachers[0]!.name, profileType: "prestador" as const, level: 4, areas: {}, personId: teacherPerson!.personId },
      { email: "aluno@demo.classa.dev", name: privateStudent.name, profileType: "aluno" as const, level: 5, areas: {}, personId: studentPerson!.personId },
    ];
    for (const prof of demoProfiles) {
      const u = await account(prof.email, prof.name);
      await db.insert(membership).values({ tenantId: school!.id, userId: u.id, role: "admin", profileType: prof.profileType, level: prof.level, areas: prof.areas, personId: prof.personId });
    }
    void personTable;
    log("contas de demonstração: coordenacao@, financeiro@, professor@ e aluno@demo.classa.dev (senha classa-demo-123)");

    const active = await listEnrollments(nowCtx, { activeOnly: true });
    const high = active.filter((e) => e.usage >= 0.8).length;
    log(`${active.length} matrículas ativas; ${high} com 80% ou mais do pacote usado`);

    console.log(`\nPronto. Entre com ${demoEmail} / classa-demo-123 e abra a escola "Escola Demo" (/e/${SLUG}).`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
