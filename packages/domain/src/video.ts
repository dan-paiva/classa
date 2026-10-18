/**
 * Contas de videoconferência (DOMINIO.md §4.3.1).
 *
 * Uma conta Zoom hospeda no máximo duas reuniões ao mesmo tempo, e abrir a terceira derruba a
 * mais antiga — que é, quase sempre, a aula que passou do horário. Por isso cada aula ocupa a
 * conta com uma folga antes e depois: a aula que estoura é justamente a que cai.
 *
 * Tudo aqui é função pura, sem banco: a mesma regra decide na geração das aulas, na escolha da
 * sala da turma e no painel de ocupação.
 */

export type Interval = { start: number; end: number };

/** Faixa que a aula ocupa na conta: do início menos a folga ao fim mais a folga, em ms. */
export function withBuffer(i: Interval, bufferMinutes: number): Interval {
  const b = bufferMinutes * 60_000;
  return { start: i.start - b, end: i.end + b };
}

/**
 * Maior número de faixas abertas ao mesmo tempo. Uma faixa que termina no instante em que a
 * outra começa não se sobrepõe a ela.
 */
export function peakConcurrency(intervals: readonly Interval[]): number {
  const edges = intervals.flatMap((i) => [
    { t: i.start, d: 1 },
    { t: i.end, d: -1 },
  ]);
  // no mesmo instante, quem sai sai antes de quem entra
  edges.sort((a, b) => a.t - b.t || a.d - b.d);
  let open = 0;
  let peak = 0;
  for (const e of edges) {
    open += e.d;
    peak = Math.max(peak, open);
  }
  return peak;
}

/** Os trechos em que a conta passa do limite, com as aulas que estão neles. */
export function overloads<T extends Interval>(intervals: readonly T[], max: number, bufferMinutes: number): { start: number; end: number; items: T[] }[] {
  const padded = intervals.map((i) => ({ item: i, ...withBuffer(i, bufferMinutes) }));
  const times = [...new Set(padded.flatMap((p) => [p.start, p.end]))].sort((a, b) => a - b);
  const result: { start: number; end: number; items: T[] }[] = [];
  for (let k = 0; k < times.length - 1; k++) {
    const start = times[k]!;
    const end = times[k + 1]!;
    const open = padded.filter((p) => p.start < end && p.end > start);
    if (open.length <= max) continue;
    const last = result.at(-1);
    const items = open.map((p) => p.item);
    if (last && last.end === start && sameSet(last.items, items)) last.end = end;
    else result.push({ start, end, items });
  }
  return result;
}

function sameSet<T>(a: readonly T[], b: readonly T[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** As aulas novas cabem na conta junto com as que ela já tem? */
export function fitsAccount(busy: readonly Interval[], added: readonly Interval[], max: number, bufferMinutes: number): boolean {
  if (!added.length) return true;
  const all = [...busy, ...added].map((i) => withBuffer(i, bufferMinutes));
  // só importa o pico nos trechos das aulas novas: a conta pode já estar cheia em outro horário
  return added.every((a) => {
    const w = withBuffer(a, bufferMinutes);
    return peakConcurrency(all.filter((i) => i.start < w.end && i.end > w.start)) <= max;
  });
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && a.end > b.start;

export type RoomCandidate = {
  roomId: string;
  accountId: string;
  maxConcurrent: number;
  bufferMinutes: number;
  /** aulas que já usam esta sala (o mesmo link não serve a duas aulas ao mesmo tempo) */
  roomBusy: readonly Interval[];
  /** aulas que já usam qualquer sala desta conta */
  accountBusy: readonly Interval[];
};

export type RoomPick =
  | { ok: true; roomId: string; accountId: string }
  | { ok: false; reason: string };

/**
 * Escolhe a sala virtual para um conjunto de aulas (as de uma turma, ou uma aula só).
 *
 * Critério: a sala precisa estar livre e a conta dela precisa caber. Entre as que servem, a
 * preferida (a que a turma já usa, para o link não mudar); depois a conta menos ocupada.
 */
export function pickVideoRoom(candidates: readonly RoomCandidate[], added: readonly Interval[], preferRoomId?: string | null): RoomPick {
  if (!candidates.length) return { ok: false, reason: "Nenhuma sala virtual ligada a uma conta de vídeo" };
  const fit = candidates.filter(
    (c) => !c.roomBusy.some((b) => added.some((a) => overlaps(a, b))) && fitsAccount(c.accountBusy, added, c.maxConcurrent, c.bufferMinutes),
  );
  if (!fit.length) return { ok: false, reason: "Todas as contas de vídeo estão cheias nesse horário" };
  const load = (c: RoomCandidate) => c.accountBusy.reduce((s, i) => s + (i.end - i.start), 0);
  const best = fit.find((c) => c.roomId === preferRoomId) ?? [...fit].sort((a, b) => load(a) - load(b))[0]!;
  return { ok: true, roomId: best.roomId, accountId: best.accountId };
}
