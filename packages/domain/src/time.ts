/** Datas de calendário como "AAAA-MM-DD" e horas como "HH:MM". Instantes são Date (UTC). */

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + (m ?? 0);
}

/** Deslocamento do fuso em minutos naquele instante (ex.: -180 para São Paulo). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Converte data + hora de parede no fuso da escola para o instante UTC. */
export function zonedToUtc(isoDate: string, hhmm: string, timeZone: string): Date {
  const naive = new Date(`${isoDate}T${hhmm.slice(0, 5)}:00Z`);
  const first = offsetMinutes(naive, timeZone);
  const guess = new Date(naive.getTime() - first * 60000);
  const second = offsetMinutes(guess, timeZone);
  return second === first ? guess : new Date(naive.getTime() - second * 60000);
}

/** Data de calendário ("AAAA-MM-DD") de um instante no fuso da escola. */
export function dateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}
