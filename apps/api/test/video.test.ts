import { course, DEFAULT_TENANT_SETTINGS, eq, lesson, tenant, type Database } from "@classa/db";
import { createTestDb } from "@classa/db/testing";
import { slotKey } from "@classa/domain";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/services/context.ts";
import { createRoom, createTeacher } from "../src/services/people.ts";
import { createClassGroup, generateLessons } from "../src/services/schedule.ts";
import { createVideoAccount, videoOccupancy } from "../src/services/video.ts";

let db: Database;
let ctx: ServiceContext;
let courseId: string;
const teachers: string[] = [];
const evenings = [1, 2, 3, 4, 5].flatMap((d) => [18, 19, 20, 21].map((h) => slotKey(d, h)));

beforeAll(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenant).values({ name: "Escola Vídeo", slug: "video", settings: DEFAULT_TENANT_SETTINGS }).returning();
  ctx = { db, tenantId: t!.id, actorId: null, timezone: "America/Sao_Paulo", settings: DEFAULT_TENANT_SETTINGS, now: new Date("2026-09-01T12:00:00Z") };
  const [c] = await db
    .insert(course)
    .values({
      tenantId: t!.id, name: "Inglês", type: "regular", color: "#1e46c8", capacity: 4, lessonMinutes: 60,
      packageLessons: 10, cancelNoticeHours: 6, lessonPriceCents: 6000, modalities: ["online"],
    })
    .returning();
  courseId = c!.id;
  for (const n of [1, 2, 3, 4]) {
    teachers.push((await createTeacher(ctx, { person: { name: `Professora ${n}`, email: `p${n}@t.dev` }, availability: evenings, courses: [{ courseId, moduleIds: null }] })).id);
  }
});

const turma = (name: string, teacher: number, roomId: string | null = null) =>
  createClassGroup(ctx, {
    courseId, name, teacherId: teachers[teacher]!, roomId, startsOn: "2026-09-14", endsOn: "2026-09-30",
    schedules: [{ weekday: 1, startTime: "19:00" }],
  }).then((r) => r.classGroup);

describe("contas de vídeo na geração das aulas", () => {
  it("a turma online sem sala ganha uma, e a terceira aula ao mesmo tempo vai para outra conta", async () => {
    const a = await createVideoAccount(ctx, { name: "Conta 1", login: "conta1@escola.dev" });
    const b = await createVideoAccount(ctx, { name: "Conta 2" });
    const salas = [];
    for (const [n, acc] of [[1, a], [2, a], [3, a], [4, b], [5, b]] as const) {
      salas.push(await createRoom(ctx, { name: `Zoom ${n}`, kind: "virtual", link: `https://zoom.us/j/${n}`, videoAccountId: acc.id }));
    }

    const results = [];
    for (const n of [0, 1, 2]) {
      const g = await turma(`Turma ${n}`, n);
      results.push({ g, r: await generateLessons(ctx, g.id, { from: "2026-09-14", to: "2026-09-21" }) });
    }
    // as duas primeiras cabem na Conta 1 (a menos ocupada empata e a ordem decide); a terceira não
    const roomsUsed = results.map((x) => x.r.assignedRoomId);
    expect(roomsUsed.every(Boolean)).toBe(true);
    const accountOf = new Map(salas.map((s) => [s.id, s.videoAccountId]));
    const perAccount = roomsUsed.reduce<Record<string, number>>((m, r) => ({ ...m, [accountOf.get(r!)!]: (m[accountOf.get(r!)!] ?? 0) + 1 }), {});
    expect(Math.max(...Object.values(perAccount))).toBeLessThanOrEqual(2);
    expect(results.every((x) => x.r.withoutRoom.length === 0)).toBe(true);

    const occ = await videoOccupancy(ctx, { from: new Date("2026-09-14T00:00:00Z"), to: new Date("2026-09-22T00:00:00Z") });
    expect(occ.accounts.every((acc) => acc.overloads.length === 0)).toBe(true);
    expect(occ.withoutRoom).toHaveLength(0);
  });

  it("com as duas contas cheias, a quinta aula fica sem sala e a geração diz por quê", async () => {
    const g4 = await turma("Turma 3", 3);
    const r4 = await generateLessons(ctx, g4.id, { from: "2026-09-14", to: "2026-09-21" });
    // Conta 1 com 2 e Conta 2 com 1: ainda cabe uma
    expect(r4.withoutRoom).toHaveLength(0);

    const p5 = (await createTeacher(ctx, { person: { name: "Professora 5", email: "p5@t.dev" }, availability: evenings, courses: [{ courseId, moduleIds: null }] })).id;
    teachers.push(p5);
    const g5 = await turma("Turma 4", 4);
    const r5 = await generateLessons(ctx, g5.id, { from: "2026-09-14", to: "2026-09-21" });
    expect(r5.assignedRoomId).toBeNull();
    const cheia = "Todas as contas de vídeo estão cheias nesse horário";
    expect(r5.withoutRoom).toEqual([
      { date: "2026-09-14", startTime: "19:00", reason: cheia },
      { date: "2026-09-21", startTime: "19:00", reason: cheia },
    ]);
    const ls = await db.select().from(lesson).where(eq(lesson.classGroupId, g5.id));
    expect(ls.map((l) => l.roomId)).toEqual([null, null]);

    const occ = await videoOccupancy(ctx, { from: new Date("2026-09-14T00:00:00Z"), to: new Date("2026-09-22T00:00:00Z") });
    expect(occ.withoutRoom.map((x) => x.className)).toEqual(["Turma 4", "Turma 4"]);
  });

  it("a folga separa aulas que se encostam: 19h às 20h e 20h05 não dividem vaga", async () => {
    const solo = await createVideoAccount(ctx, { name: "Conta solo", maxConcurrent: 1, bufferMinutes: 10 });
    const sala = await createRoom(ctx, { name: "Zoom solo", kind: "virtual", link: "https://zoom.us/j/solo", videoAccountId: solo.id });
    const [c2] = await db
      .insert(course)
      .values({
        tenantId: ctx.tenantId, name: "Conversa", type: "regular", color: "#0f766e", capacity: 4, lessonMinutes: 60,
        packageLessons: 10, cancelNoticeHours: 6, lessonPriceCents: 6000, modalities: ["online"],
      })
      .returning();
    const p = (await createTeacher(ctx, { person: { name: "Professora 6", email: "p6@t.dev" }, availability: evenings, courses: [{ courseId: c2!.id, moduleIds: null }] })).id;
    const q = (await createTeacher(ctx, { person: { name: "Professora 7", email: "p7@t.dev" }, availability: evenings, courses: [{ courseId: c2!.id, moduleIds: null }] })).id;
    const g1 = (await createClassGroup(ctx, { courseId: c2!.id, name: "Ter 19h", teacherId: p, roomId: sala.id, startsOn: "2026-09-15", endsOn: "2026-09-15", schedules: [{ weekday: 2, startTime: "19:00" }] })).classGroup;
    expect((await generateLessons(ctx, g1.id, { from: "2026-09-15", to: "2026-09-15" })).withoutRoom).toHaveLength(0);
    const g2 = (await createClassGroup(ctx, { courseId: c2!.id, name: "Ter 20h05", teacherId: q, roomId: sala.id, startsOn: "2026-09-15", endsOn: "2026-09-15", schedules: [{ weekday: 2, startTime: "20:05" }] })).classGroup;
    const r = await generateLessons(ctx, g2.id, { from: "2026-09-15", to: "2026-09-15" });
    // a sala da turma não cabia; a aula foi para outra conta, só ela, e a turma continua com a sala dela
    const [l] = await db.select().from(lesson).where(eq(lesson.classGroupId, g2.id));
    expect(r.withoutRoom).toHaveLength(0);
    expect(l!.roomId).not.toBe(sala.id);
    expect(l!.roomId).not.toBeNull();
  });
});
