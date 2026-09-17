import { eachDay, toMinutes, weekdayOf, zonedToUtc } from "./time.ts";

export type OperatingDay = { weekday: number; open: string; close: string } | { weekday: number; closed: true };

export type LessonSlot = { date: string; startTime: string; startsAt: Date; endsAt: Date };

export type SkippedSlot = { date: string; startTime: string; reason: "domingo" | "feriado" | "fora_do_funcionamento" };

/**
 * Aulas de uma turma num intervalo: uma por (dia, horário) dentro do período da turma.
 * Não gera no domingo, em feriado/recesso, nem se a aula não couber no horário de funcionamento.
 */
export function generateLessonSlots(input: {
  period: { startsOn: string; endsOn: string };
  range: { from: string; to: string };
  schedules: { weekday: number; startTime: string }[];
  lessonMinutes: number;
  holidays: Set<string>;
  operatingHours: OperatingDay[];
  timeZone: string;
}): { slots: LessonSlot[]; skipped: SkippedSlot[] } {
  const from = input.range.from > input.period.startsOn ? input.range.from : input.period.startsOn;
  const to = input.range.to < input.period.endsOn ? input.range.to : input.period.endsOn;
  const slots: LessonSlot[] = [];
  const skipped: SkippedSlot[] = [];
  if (from > to) return { slots, skipped };

  for (const date of eachDay(from, to)) {
    const weekday = weekdayOf(date);
    for (const s of input.schedules.filter((x) => x.weekday === weekday)) {
      const startTime = s.startTime.slice(0, 5);
      if (weekday === 0) {
        skipped.push({ date, startTime, reason: "domingo" });
        continue;
      }
      if (input.holidays.has(date)) {
        skipped.push({ date, startTime, reason: "feriado" });
        continue;
      }
      const day = input.operatingHours.find((d) => d.weekday === weekday);
      const start = toMinutes(startTime);
      const end = start + input.lessonMinutes;
      if (!day || "closed" in day || start < toMinutes(day.open) || end > toMinutes(day.close)) {
        skipped.push({ date, startTime, reason: "fora_do_funcionamento" });
        continue;
      }
      const startsAt = zonedToUtc(date, startTime, input.timeZone);
      slots.push({ date, startTime, startsAt, endsAt: new Date(startsAt.getTime() + input.lessonMinutes * 60000) });
    }
  }
  return { slots, skipped };
}

/** Intervalos [a, b) se sobrepõem. */
export function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}
