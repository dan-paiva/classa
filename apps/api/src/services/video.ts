import { and, asc, classGroup, course, eq, gte, inArray, isNull, lesson, lt, ne, person, room, sql, teacher, videoAccount } from "@classa/db";
import { overloads, pickVideoRoom, type Interval, type RoomCandidate } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { conflict, invalid, notFound } from "../http/errors.ts";
import { isUniqueViolation } from "../http/pg-errors.ts";
import type { Db, ServiceContext } from "./context.ts";

/* ------------------------------------------------------------------ cadastro */

export type VideoAccountInput = { name: string; login?: string | null; maxConcurrent?: number; bufferMinutes?: number; notes?: string | null };

function checkAccount(input: VideoAccountInput) {
  const name = input.name.trim();
  if (name.length < 2) throw invalid("name", "Nome precisa de pelo menos 2 caracteres");
  const max = input.maxConcurrent ?? 2;
  if (!Number.isInteger(max) || max < 1 || max > 10) throw invalid("maxConcurrent", "Reuniões ao mesmo tempo: de 1 a 10");
  const buffer = input.bufferMinutes ?? 10;
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 60) throw invalid("bufferMinutes", "Folga de 0 a 60 minutos");
  return { name, login: input.login?.trim() || null, maxConcurrent: max, bufferMinutes: buffer, notes: input.notes?.trim() || null };
}

export async function createVideoAccount(ctx: ServiceContext, input: VideoAccountInput) {
  const values = checkAccount(input);
  try {
    return await ctx.db.transaction(async (tx) => {
      const [row] = await tx.insert(videoAccount).values({ ...values, tenantId: ctx.tenantId }).returning();
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "video_account", entityId: row!.id, action: "create", after: row });
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("name", "Já existe uma conta com esse nome");
    throw err;
  }
}

export async function updateVideoAccount(ctx: ServiceContext, id: string, input: VideoAccountInput & { active?: boolean }) {
  const values = checkAccount(input);
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(videoAccount).where(and(eq(videoAccount.id, id), eq(videoAccount.tenantId, ctx.tenantId)));
    if (!before) throw notFound("Conta");
    const deactivatedAt = input.active === false ? (before.deactivatedAt ?? ctx.now) : input.active === true ? null : before.deactivatedAt;
    const [row] = await tx.update(videoAccount).set({ ...values, deactivatedAt, updatedAt: ctx.now }).where(eq(videoAccount.id, id)).returning();
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "video_account", entityId: id, action: "update", before, after: row });
    return row!;
  });
}

/** Pendura a sala virtual numa conta (ou tira dela). */
export async function setRoomAccount(ctx: ServiceContext, roomId: string, accountId: string | null) {
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(room).where(and(eq(room.id, roomId), eq(room.tenantId, ctx.tenantId)));
    if (!before) throw notFound("Sala");
    if (before.kind !== "virtual") throw invalid("roomId", "Só sala virtual fica numa conta de vídeo");
    if (accountId) {
      const [a] = await tx.select().from(videoAccount).where(and(eq(videoAccount.id, accountId), eq(videoAccount.tenantId, ctx.tenantId)));
      if (!a) throw invalid("accountId", "Conta não encontrada");
    }
    const [row] = await tx.update(room).set({ videoAccountId: accountId, updatedAt: ctx.now }).where(eq(room.id, roomId)).returning();
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "room", entityId: roomId, action: "update", before, after: row });
    return row!;
  });
}

export async function listVideoAccounts(ctx: ServiceContext) {
  const accounts = await ctx.db.select().from(videoAccount).where(eq(videoAccount.tenantId, ctx.tenantId)).orderBy(asc(videoAccount.name));
  const rooms = await ctx.db
    .select({ id: room.id, name: room.name, link: room.link, videoAccountId: room.videoAccountId, deactivatedAt: room.deactivatedAt })
    .from(room)
    .where(and(eq(room.tenantId, ctx.tenantId), eq(room.kind, "virtual")))
    .orderBy(asc(room.name));
  return {
    accounts: accounts.map((a) => ({ ...a, rooms: rooms.filter((r) => r.videoAccountId === a.id) })),
    unassignedRooms: rooms.filter((r) => !r.videoAccountId && !r.deactivatedAt),
  };
}

/* ------------------------------------------------------------------- a regra */

const span = (l: { startsAt: Date; endsAt: Date }): Interval => ({ start: l.startsAt.getTime(), end: l.endsAt.getTime() });

/**
 * As salas virtuais ativas, cada uma com a conta dela e o que já ocupa a sala e a conta no
 * intervalo. Aula cancelada não ocupa. As aulas de `ignoreClassGroupId` ficam de fora: são as
 * que estão sendo geradas de novo.
 */
export async function videoCandidates(db: Db, ctx: ServiceContext, window: { from: Date; to: Date }, ignoreClassGroupId?: string): Promise<RoomCandidate[]> {
  const rooms = await db
    .select({ roomId: room.id, accountId: videoAccount.id, maxConcurrent: videoAccount.maxConcurrent, bufferMinutes: videoAccount.bufferMinutes })
    .from(room)
    .innerJoin(videoAccount, eq(videoAccount.id, room.videoAccountId))
    .where(and(eq(room.tenantId, ctx.tenantId), eq(room.kind, "virtual"), isNull(room.deactivatedAt), isNull(videoAccount.deactivatedAt)))
    .orderBy(asc(room.name));
  if (!rooms.length) return [];
  const pad = 60 * 60_000; // a folga máxima: aula que começa antes da janela ainda pode tocar nela
  const busy = await db
    .select({ roomId: lesson.roomId, startsAt: lesson.startsAt, endsAt: lesson.endsAt })
    .from(lesson)
    .where(
      and(
        eq(lesson.tenantId, ctx.tenantId),
        inArray(lesson.roomId, rooms.map((r) => r.roomId)),
        ne(lesson.state, "cancelada"),
        lt(lesson.startsAt, new Date(window.to.getTime() + pad)),
        gte(lesson.endsAt, new Date(window.from.getTime() - pad)),
        ignoreClassGroupId ? ne(lesson.classGroupId, ignoreClassGroupId) : undefined,
      ),
    );
  const accountOf = new Map(rooms.map((r) => [r.roomId, r.accountId]));
  return rooms.map((r) => ({
    ...r,
    roomBusy: busy.filter((b) => b.roomId === r.roomId).map(span),
    accountBusy: busy.filter((b) => accountOf.get(b.roomId!) === r.accountId).map(span),
  }));
}

export type VideoPlan = {
  /** sala de cada aula, na ordem recebida; null = nenhuma conta coube */
  rooms: (string | null)[];
  /** sala que a turma passa a ter, quando ela não tinha */
  classRoomId: string | null;
  refused: { index: number; reason: string }[];
};

/**
 * Decide a sala de cada aula nova de uma turma online.
 *
 * Primeiro tenta uma sala só para todas (o link fixo da turma). Se a sala da turma não couber
 * numa aula, aquela aula vai para outra conta, só ela; se nenhuma couber, fica sem sala e a
 * recusa volta com o motivo — nunca uma terceira reunião na mesma conta.
 */
export function planVideoRooms(candidates: RoomCandidate[], slots: readonly Interval[], classRoomId: string | null): VideoPlan {
  const managed = new Set(candidates.map((c) => c.roomId));
  // sala da turma fora das contas (sem conta, ou de outro tipo): a regra não se aplica a ela
  if (classRoomId && !managed.has(classRoomId)) return { rooms: slots.map(() => classRoomId), classRoomId: null, refused: [] };

  let fixed = classRoomId;
  let newClassRoom: string | null = null;
  if (!fixed && candidates.length) {
    const all = pickVideoRoom(candidates, slots);
    if (all.ok) fixed = newClassRoom = all.roomId;
  }

  // cópia mutável: cada aula decidida passa a ocupar a sala e a conta para as seguintes
  const pool = candidates.map((c) => ({ ...c, roomBusy: [...c.roomBusy], accountBusy: [...c.accountBusy] }));
  const plan: VideoPlan = { rooms: [], classRoomId: newClassRoom, refused: [] };
  slots.forEach((slot, index) => {
    const pick = pickVideoRoom(pool, [slot], fixed);
    if (!pick.ok) {
      plan.rooms.push(null);
      plan.refused.push({ index, reason: pick.reason });
      return;
    }
    plan.rooms.push(pick.roomId);
    for (const c of pool) {
      if (c.roomId === pick.roomId) c.roomBusy.push(slot);
      if (c.accountId === pick.accountId) c.accountBusy.push(slot);
    }
  });
  return plan;
}

/** Trava as contas de vídeo da escola até o fim da transação: duas gerações ao mesmo tempo não escolhem a mesma vaga. */
export async function lockVideoAccounts(db: Db, ctx: ServiceContext) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${"video_account:" + ctx.tenantId}))`);
}

/* ---------------------------------------------------------------- a ocupação */

/**
 * A grade da semana do Pedagógico: cada conta com as aulas dela, os trechos em que passa do
 * limite (aula marcada fora da regra, ou importada) e as aulas online sem sala.
 */
export async function videoOccupancy(ctx: ServiceContext, range: { from: Date; to: Date }) {
  const { accounts } = await listVideoAccounts(ctx);
  const rows = await ctx.db
    .select({
      id: lesson.id,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      state: lesson.state,
      roomId: lesson.roomId,
      roomName: room.name,
      roomLink: room.link,
      videoAccountId: room.videoAccountId,
      className: classGroup.name,
      classRoomId: classGroup.roomId,
      modality: classGroup.modality,
      courseName: course.name,
      courseColor: course.color,
      teacherName: person.name,
    })
    .from(lesson)
    .innerJoin(classGroup, eq(classGroup.id, lesson.classGroupId))
    .innerJoin(course, eq(course.id, lesson.courseId))
    .leftJoin(room, eq(room.id, lesson.roomId))
    .leftJoin(teacher, eq(teacher.id, lesson.teacherId))
    .leftJoin(person, eq(person.id, teacher.personId))
    .where(and(eq(lesson.tenantId, ctx.tenantId), ne(lesson.state, "cancelada"), gte(lesson.startsAt, range.from), lt(lesson.startsAt, range.to)))
    .orderBy(asc(lesson.startsAt));

  const view = (r: (typeof rows)[number]) => ({
    ...r,
    // aula que saiu da sala da turma: o link dela é outro só nesta data
    avulsa: !!r.roomId && !!r.classRoomId && r.roomId !== r.classRoomId,
  });

  return {
    accounts: accounts.map((a) => {
      const lessons = rows.filter((r) => r.videoAccountId === a.id).map(view);
      const over = overloads(
        lessons.map((l) => ({ id: l.id, start: l.startsAt.getTime(), end: l.endsAt.getTime() })),
        a.maxConcurrent,
        a.bufferMinutes,
      );
      return {
        ...a,
        lessons,
        overloads: over.map((o) => ({ startsAt: new Date(o.start), endsAt: new Date(o.end), lessonIds: o.items.map((i) => i.id) })),
      };
    }),
    withoutRoom: rows.filter((r) => r.modality === "online" && !r.roomId).map(view),
    outsideAccounts: rows.filter((r) => r.modality === "online" && r.roomId && !r.videoAccountId).map(view),
  };
}
