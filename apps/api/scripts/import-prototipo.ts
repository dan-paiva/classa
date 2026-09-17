/**
 * Traz para o Classa o cadastro do protótipo em HTML (uso local).
 *
 *   pnpm import:prototipo -- <arquivo.html> --escola <slug>
 *   pnpm import:prototipo -- <arquivo.html> --escola minha-escola --simular   # só mostra o que faria
 *
 * Importa o que é cadastro de verdade: horário de funcionamento, feriados, cursos e
 * módulos, salas, professores, empresas, alunos e matrículas. Não importa aula,
 * presença, pagamento nem painel: no protótipo esses números são sorteados na hora.
 *
 * Roda duas vezes sem duplicar: o que já existe (mesmo nome, e-mail ou CNPJ) é pulado.
 * Recusa banco remoto a menos que receba --allow-remote, e nada do arquivo vai para o
 * repositório: o relatório do que ficou pendente é gravado ao lado do arquivo lido.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  and,
  company,
  COURSE_TYPES,
  course,
  courseModule,
  createDb,
  DEFAULT_TENANT_SETTINGS,
  enrollment,
  eq,
  holiday,
  isNull,
  person,
  room,
  sql,
  student,
  teacher,
  tenant,
  type CourseType,
  type RoomKind,
  type TenantSettings,
} from "@classa/db";
import { isValidCnpj, isValidCpf, onlyDigits } from "@classa/domain";
import { defaultRules } from "../src/modules/courses/domain.ts";
import { createCompany, linkStudent } from "../src/services/companies.ts";
import type { ServiceContext } from "../src/services/context.ts";
import { addCreditEntry, createEnrollment } from "../src/services/enrollments.ts";
import { createRoom, createStudent, createTeacher } from "../src/services/people.ts";
import { listClassGroups } from "../src/services/schedule.ts";

/* ------------------------------------------------------------------ o arquivo */

type CadCourse = { name: string; tipo: string; modulos: string[]; idioma?: string; active?: boolean };
type CadTeacher = { name: string; email?: string; cursos?: string[]; active?: boolean };
type CadRoom = { name: string; tipo?: string; atende?: string; zoom?: boolean; active?: boolean };
type CadCompany = { name: string; cnpj?: string; segment?: string; rep?: string; alunos?: number; fimEmDias?: number; active?: boolean };
type CadHoliday = { data: string; nome: string; origem?: string };
type CadHours = { dia: string; on: boolean; ini: string; fim: string };
type Cad = {
  courses: CadCourse[];
  teachers: CadTeacher[];
  rooms: CadRoom[];
  companies: CadCompany[];
  holidays: CadHoliday[];
  operatingHours: CadHours[];
};

type ProtoEnrollment = { usedLessons: number; totalLessons: number; modalidade?: string; currentModule: { name: string } | null; course: { name: string } };
type ProtoStudent = { name: string; email?: string; cpf?: string; status?: string; company?: { name: string } | null; enrollments: ProtoEnrollment[] };

/** Fecha o objeto que começa em `start`, ignorando chaves dentro de texto e comentário. */
function balanced(src: string, start: number): number {
  let depth = 0;
  let quote = "";
  let comment: "" | "linha" | "bloco" = "";
  for (let i = start; i < src.length; i++) {
    const c = src[i]!;
    const next = src[i + 1];
    if (comment === "linha") {
      if (c === "\n") comment = "";
      continue;
    }
    if (comment === "bloco") {
      if (c === "*" && next === "/") {
        comment = "";
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && next === "/") {
      comment = "linha";
      i++;
    } else if (c === "/" && next === "*") {
      comment = "bloco";
      i++;
    } else if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("não achei o fim do bloco de dados no arquivo");
}

function readPrototype(path: string): { cad: Cad; students: ProtoStudent[] } {
  const html = readFileSync(path, "utf8");

  const cadAt = html.indexOf("const CAD={");
  if (cadAt < 0) throw new Error("este arquivo não parece o protótipo: não achei o bloco de cadastro (CAD)");
  const cadStart = cadAt + "const CAD=".length;
  const cad = JSON.parse(html.slice(cadStart, balanced(html, cadStart) + 1)) as Cad;

  // os alunos ficam num literal de JavaScript, com funções auxiliares logo acima
  const from = html.indexOf("const emDias");
  const dbAt = html.indexOf("const DB={");
  if (from < 0 || dbAt < 0) throw new Error("este arquivo não parece o protótipo: não achei o bloco de alunos (DB)");
  const code = `${html.slice(from, balanced(html, dbAt + "const DB=".length) + 1)}; DB`;
  const db = runInNewContext(code, Object.create(null), { timeout: 5000 }) as { alunos: ProtoStudent[] };
  return { cad, students: db.alunos ?? [] };
}

/* ------------------------------------------------------------ correspondências */

const COURSE_TYPE: Record<string, CourseType> = {
  "Em grupo": "grupo",
  Particular: "particular",
  Híbrido: "hibrido",
  Workshop: "workshop",
  "Turmas dedicadas": "turmas_dedicadas",
};
const ROOM_KIND = (r: CadRoom): RoomKind => (r.zoom || /virtual|zoom|online/i.test(r.tipo ?? "") ? "virtual" : /auditório|auditorio/i.test(r.tipo ?? "") ? "auditorio" : "presencial");
const STUDENT_STATUS: Record<string, string> = { Ativo: "ativo", Suspenso: "suspenso", Congelado: "congelado", Inadimplente: "inadimplente", Cancelado: "cancelado", Inativo: "inativo" };
const WEEKDAY: Record<string, number> = { Domingo: 0, "Segunda-feira": 1, "Terça-feira": 2, "Quarta-feira": 3, "Quinta-feira": 4, "Sexta-feira": 5, "Sábado": 6 };
const key = (s: string) => s.trim().toLowerCase();
const isoFromBr = (br: string) => {
  const [d, m, y] = br.split("/");
  return `${y}-${m}-${d}`;
};
const addDaysIso = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

/* -------------------------------------------------------------------- entrada */

const args = process.argv.slice(2);
const VALUE_FLAGS = ["escola", "link-sala-virtual"];
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

async function main() {
  const file = args.find((a: string, i: number) => !a.startsWith("--") && !VALUE_FLAGS.some((f) => args[i - 1] === `--${f}`));
  const slug = flag("escola");
  const dryRun = has("simular");
  if (!file || !slug) {
    console.error("uso: pnpm import:prototipo -- <arquivo.html> --escola <slug> [--link-sala-virtual <url>] [--simular] [--allow-remote]");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL ?? "postgres://classa:classa@localhost:5432/classa";
  const local = /localhost|127\.0\.0\.1/.test(url);
  if (!local && !has("allow-remote")) {
    console.error("Este banco não é o local. Importe primeiro na sua máquina; para insistir, use --allow-remote.");
    process.exit(1);
  }

  const { cad, students } = readPrototype(file);
  const { db, close } = createDb(url);
  try {
    const [school] = await db.select().from(tenant).where(eq(tenant.slug, slug));
    if (!school) throw new Error(`não existe escola com o link "${slug}". Crie a escola no Classa antes de importar.`);
    const ctx: ServiceContext = { db, tenantId: school.id, actorId: null, timezone: school.timezone, settings: school.settings, now: new Date() };

    const pending: string[] = [];
    const feito: string[] = [];
    const log = (line: string) => {
      feito.push(line);
      console.log(`  ${line}`);
    };
    const step = (title: string) => console.log(`\n${title}`);

    /* -------------------------------------------------- horário de funcionamento */
    step("Horário de funcionamento");
    const operatingHours: TenantSettings["operatingHours"] = cad.operatingHours.map((h) => {
      const weekday = WEEKDAY[h.dia];
      if (weekday === undefined) throw new Error(`dia da semana desconhecido no arquivo: ${h.dia}`);
      return h.on ? { weekday, open: h.ini, close: h.fim } : { weekday, closed: true };
    });
    if (!dryRun) await db.update(tenant).set({ settings: { ...DEFAULT_TENANT_SETTINGS, ...school.settings, operatingHours } }).where(eq(tenant.id, school.id));
    log(`${operatingHours.filter((h) => !("closed" in h)).length} dias abertos por semana`);

    /* ------------------------------------------------------------------ feriados */
    step("Feriados");
    const holidayRows = cad.holidays.map((h) => ({ tenantId: school.id, date: isoFromBr(h.data), name: h.nome, kind: h.origem === "Nacional" ? ("nacional" as const) : ("manual" as const) }));
    const holidays = dryRun ? holidayRows : await db.insert(holiday).values(holidayRows).onConflictDoNothing().returning();
    log(`${holidays.length} feriados novos (de ${holidayRows.length} no arquivo)`);

    /* ----------------------------------------------------------- cursos e módulos */
    step("Cursos e módulos");
    const existingCourses = await db.select().from(course).where(eq(course.tenantId, school.id));
    const courseByName = new Map(existingCourses.map((c) => [key(c.name), c]));
    const moduleId = new Map<string, string>(); // "curso|módulo" -> id
    for (const row of await db.select().from(courseModule).where(eq(courseModule.tenantId, school.id))) {
      const parent = existingCourses.find((c) => c.id === row.courseId);
      if (parent) moduleId.set(`${key(parent.name)}|${key(row.name)}`, row.id);
    }

    for (const c of cad.courses) {
      const type = COURSE_TYPE[c.tipo];
      if (!type || !COURSE_TYPES.includes(type)) {
        pending.push(`curso "${c.name}": tipo "${c.tipo}" não existe no Classa`);
        continue;
      }
      let row = courseByName.get(key(c.name));
      if (!row) {
        const rules = defaultRules(type);
        if (dryRun) {
          log(`criaria o curso ${c.name} (${type})`);
        } else {
          [row] = await db
            .insert(course)
            .values({ tenantId: school.id, name: c.name.trim(), type, color: "#1e46c8", ...rules })
            .returning();
          courseByName.set(key(c.name), row!);
          log(`curso ${c.name} (${type})`);
        }
        pending.push(`curso "${c.name}": vagas por aula, duração, pacote e preço entraram com o padrão do Classa — confira em Cursos`);
      }
      if (!row) continue;
      let position = (await db.select({ n: sql<number>`count(*)::int` }).from(courseModule).where(eq(courseModule.courseId, row.id)))[0]!.n;
      for (const m of c.modulos ?? []) {
        if (moduleId.has(`${key(c.name)}|${key(m)}`)) continue;
        if (dryRun) {
          log(`criaria o módulo ${c.name} · ${m}`);
          continue;
        }
        const [mod] = await db
          .insert(courseModule)
          .values({ tenantId: school.id, courseId: row.id, name: m.trim(), color: row.color, position: ++position })
          .returning();
        moduleId.set(`${key(c.name)}|${key(m)}`, mod!.id);
      }
    }
    log(`${cad.courses.length} cursos no arquivo`);

    /* ---------------------------------------------------------------------- salas */
    step("Salas");
    const rooms = await db.select().from(room).where(eq(room.tenantId, school.id));
    const roomNames = new Set(rooms.map((r) => key(r.name)));
    const zoomLink = flag("link-sala-virtual");
    for (const r of cad.rooms) {
      if (roomNames.has(key(r.name))) continue;
      const kind = ROOM_KIND(r);
      // sala virtual sem link não entra: o arquivo não guarda o endereço da reunião
      if (kind === "virtual" && !zoomLink) {
        pending.push(`sala "${r.name}" é virtual e o arquivo não traz o link da reunião — crie em Configurações, ou rode de novo com --link-sala-virtual <url>`);
        continue;
      }
      if (dryRun) {
        log(`criaria a sala ${r.name}`);
        continue;
      }
      await createRoom(ctx, { name: r.name.trim(), kind, link: kind === "virtual" ? zoomLink : null });
      log(`sala ${r.name}`);
      if (kind === "virtual") pending.push(`sala "${r.name}": entrou com o link informado na importação — confira se é o certo`);
    }

    /* --------------------------------------------------------------- professores */
    step("Professores");
    const teachers = await db.select({ id: teacher.id, name: person.name, email: person.email }).from(teacher).innerJoin(person, eq(person.id, teacher.personId)).where(eq(teacher.tenantId, school.id));
    const teacherByEmail = new Set(teachers.filter((t) => t.email).map((t) => key(t.email!)));
    const teacherByName = new Set(teachers.map((t) => key(t.name)));
    for (const t of cad.teachers) {
      if ((t.email && teacherByEmail.has(key(t.email))) || teacherByName.has(key(t.name))) continue;
      const courses = (t.cursos ?? [])
        .map((name) => courseByName.get(key(name)))
        .filter((c) => c != null)
        .map((c) => ({ courseId: c.id, moduleIds: null }));
      if (courses.length < (t.cursos ?? []).length) pending.push(`professor "${t.name}": algum curso do arquivo não existe no Classa`);
      if (dryRun) {
        log(`criaria o professor ${t.name}`);
        continue;
      }
      await createTeacher(ctx, { person: { name: t.name.trim(), email: t.email?.trim() || undefined }, courses });
      log(`professor ${t.name}`);
      pending.push(`professor "${t.name}": o arquivo não traz os horários disponíveis nem o valor da hora — preencha na ficha`);
    }

    /* ------------------------------------------------------------------ empresas */
    step("Empresas");
    const companies = await db.select({ id: company.id, name: company.name }).from(company).where(eq(company.tenantId, school.id));
    const companyByName = new Map(companies.map((c) => [key(c.name), c]));
    for (const c of cad.companies) {
      if (companyByName.has(key(c.name))) continue;
      if (dryRun) {
        log(`criaria a empresa ${c.name}`);
        continue;
      }
      const cnpj = c.cnpj ? onlyDigits(c.cnpj) : "";
      if (cnpj && !isValidCnpj(cnpj)) pending.push(`empresa "${c.name}": o CNPJ do arquivo (${cnpj}) não é válido — entrou sem CNPJ`);
      const created = await createCompany(ctx, {
        name: c.name.trim(),
        cnpj: cnpj && isValidCnpj(cnpj) ? cnpj : null,
        segment: c.segment ?? null,
        model: "b2b",
        hrName: c.rep ?? null,
        startsOn: new Date().toISOString().slice(0, 10),
        endsOn: addDaysIso(c.fimEmDias ?? 365),
        licenses: c.alunos && c.alunos > 0 ? c.alunos : 1,
        licensePriceCents: 0,
      });
      companyByName.set(key(c.name), { id: created.id, name: created.name });
      log(`empresa ${c.name}`);
      pending.push(`empresa "${c.name}": o arquivo não traz valor por licença, aulas contratadas nem subsídio — entraram zerados`);
    }

    /* ----------------------------------------------------- alunos e matrículas */
    step("Alunos e matrículas");
    const groups = await listClassGroups(ctx);
    const existingStudents = await db
      .select({ id: student.id, name: person.name, email: person.email })
      .from(student)
      .innerJoin(person, eq(person.id, student.personId))
      .where(eq(student.tenantId, school.id));
    const studentByEmail = new Map(existingStudents.filter((s) => s.email).map((s) => [key(s.email!), s]));
    const studentByName = new Map(existingStudents.map((s) => [key(s.name), s]));
    const enrollmentsOf = new Map<string, Set<string>>();
    for (const e of await db.select({ studentId: enrollment.studentId, classGroupId: enrollment.classGroupId }).from(enrollment).where(and(eq(enrollment.tenantId, school.id), isNull(enrollment.endedAt)))) {
      const set = enrollmentsOf.get(e.studentId) ?? new Set<string>();
      set.add(e.classGroupId);
      enrollmentsOf.set(e.studentId, set);
    }

    let novos = 0;
    let matriculas = 0;
    for (const a of students) {
      const found = (a.email && studentByEmail.get(key(a.email))) || studentByName.get(key(a.name));
      let studentId = found?.id;
      if (!studentId) {
        if (dryRun) {
          novos++;
          continue;
        }
        const cpf = a.cpf ? onlyDigits(a.cpf) : "";
        if (cpf && !isValidCpf(cpf)) pending.push(`aluno "${a.name}": o CPF do arquivo (${cpf}) não é válido — entrou sem CPF`);
        const created = await createStudent(ctx, {
          person: { name: a.name.trim(), email: a.email?.trim() || undefined, cpf: cpf && isValidCpf(cpf) ? cpf : undefined },
        });
        studentId = created.id;
        novos++;
        const status = STUDENT_STATUS[a.status ?? "Ativo"];
        if (status && status !== "ativo") pending.push(`aluno "${a.name}": estava como "${a.status}" no arquivo — ajuste a situação na ficha`);
        const company = a.company ? companyByName.get(key(a.company.name)) : null;
        if (company) await linkStudent(ctx, company.id, studentId);
        else if (a.company) pending.push(`aluno "${a.name}": empresa "${a.company.name}" não encontrada`);
      }

      for (const e of a.enrollments ?? []) {
        // a turma é o que casa curso e módulo; o protótipo sorteia horário, então não invento turma
        const candidate = groups.find((g) => key(g.courseName) === key(e.course.name) && (!e.currentModule || key(g.moduleName ?? "") === key(e.currentModule.name)));
        if (!candidate) {
          pending.push(`matrícula de "${a.name}" em ${e.course.name}${e.currentModule ? ` · ${e.currentModule.name}` : ""}: crie a turma no Classa e matricule depois`);
          continue;
        }
        if (enrollmentsOf.get(studentId)?.has(candidate.id)) continue;
        if (dryRun) {
          matriculas++;
          continue;
        }
        const enrollment = await createEnrollment(ctx, {
          studentId,
          classGroupId: candidate.id,
          packageLessons: e.totalLessons,
          modality: e.modalidade?.toLowerCase() === "presencial" ? "presencial" : "online",
          contract: false,
        });
        if (e.usedLessons > 0) {
          await addCreditEntry(ctx, enrollment.id, { kind: "ajuste", amount: -e.usedLessons, justification: "aulas já usadas antes da migração" });
        }
        matriculas++;
        pending.push(`matrícula de "${a.name}" em ${candidate.name}: entrou sem contrato nem parcelas — o arquivo não traz valores`);
      }
    }
    log(`${novos} alunos novos e ${matriculas} matrículas (de ${students.length} alunos no arquivo)`);

    /* ------------------------------------------------------------------ pendências */
    const report = join(dirname(file), `${basename(file, ".html")} - pendencias.md`);
    const text = [
      `# O que ficou pendente na importação${dryRun ? " (simulação)" : ""}`,
      "",
      `Escola: ${school.name} (/e/${school.slug}) · ${new Date().toLocaleString("pt-BR")}`,
      "",
      ...pending.map((p) => `- ${p}`),
      "",
      "## O que entrou",
      "",
      ...feito.map((f) => `- ${f}`),
      "",
    ].join("\n");
    writeFileSync(report, text, "utf8");
    console.log(`\n${pending.length} pendências. Relatório em: ${report}`);
    if (dryRun) console.log("Simulação: nada foi gravado.");
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
