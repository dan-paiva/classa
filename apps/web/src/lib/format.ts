export const TZ = "America/Sao_Paulo";

export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const money = (cents: number) => brl.format(cents / 100);

const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short" });
const longDayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" });
const isoFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** "AAAA-MM-DD" no fuso da escola. */
export const isoDay = (d: Date | string) => isoFmt.format(new Date(d));
export const todayIso = () => isoDay(new Date());

/** Data de calendário ("AAAA-MM-DD") → "17/09/2026", sem passar por fuso. */
export const fmtIsoDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const fmtDate = (d: Date | string) => dateFmt.format(new Date(d));
export const fmtShortDate = (d: Date | string) => shortDateFmt.format(new Date(d));
export const fmtTime = (d: Date | string) => timeFmt.format(new Date(d));
export const fmtWeekday = (d: Date | string) => weekdayFmt.format(new Date(d)).replace(".", "");
export const fmtLongDay = (d: Date | string) => longDayFmt.format(new Date(d));

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
export const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

export const scheduleLabel = (schedules: { weekday: number; startTime: string }[]) =>
  schedules.map((s) => `${WEEKDAYS_SHORT[s.weekday]} ${s.startTime}`).join(" · ");

export function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Segunda-feira da semana de uma data ISO. */
export function mondayOf(iso: string) {
  const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDaysIso(iso, wd === 0 ? -6 : 1 - wd);
}

export const formatCpf = (cpf: string | null) =>
  cpf && cpf.length === 11 ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : (cpf ?? "—");

export const formatPhone = (p: string | null) =>
  !p ? "—" : p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : p.length === 10 ? `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}` : p;

/** "58,50" → 5850. */
export function parseReais(text: string): number | null {
  const clean = text.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (clean === "" || Number.isNaN(Number(clean))) return null;
  return Math.round(Number(clean) * 100);
}

/** "1 falta", "3 faltas". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
