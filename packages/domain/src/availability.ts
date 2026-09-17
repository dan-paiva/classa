/** Disponibilidade = horas cheias codificadas como weekday * 100 + hora (1..6, 7..21). */

export const AVAILABILITY_WEEKDAYS = [1, 2, 3, 4, 5, 6] as const;
export const AVAILABILITY_HOURS = Array.from({ length: 15 }, (_, i) => i + 7);

export const slotKey = (weekday: number, hour: number) => weekday * 100 + hour;

export function isValidSlot(key: number): boolean {
  const weekday = Math.floor(key / 100);
  const hour = key % 100;
  return weekday >= 1 && weekday <= 6 && hour >= 7 && hour <= 21;
}

/**
 * Horas que a aula ocupa (considera a duração inteira, não só o início).
 * Ex.: segunda 18:30 por 60 min ocupa 118 e 119.
 */
export function hoursTouched(weekday: number, startTime: string, minutes: number): number[] {
  const [h, m] = startTime.split(":").map(Number);
  const start = h! * 60 + (m ?? 0);
  const end = start + minutes;
  const keys: number[] = [];
  for (let hour = Math.floor(start / 60); hour * 60 < end; hour++) keys.push(slotKey(weekday, hour));
  return keys;
}

/** A aula cabe inteira na disponibilidade? */
export function fitsAvailability(availability: readonly number[], weekday: number, startTime: string, minutes: number): boolean {
  const set = new Set(availability);
  return hoursTouched(weekday, startTime, minutes).every((k) => set.has(k));
}
