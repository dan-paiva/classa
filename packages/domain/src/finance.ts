import { addDays } from "./time.ts";

const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

function dateOn(year: number, month0: number, day: number): string {
  const y = year + Math.floor(month0 / 12);
  const m = ((month0 % 12) + 12) % 12;
  const d = Math.min(day, daysInMonth(y, m));
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parcelas mensais: valor em centavos dividido igualmente, com a última absorvendo o arredondamento.
 * A primeira vence no próximo `dueDay` a partir do início (se o dia já passou, no mês seguinte).
 */
export function buildInstallments(totalCents: number, count: number, dueDay: number, startsOn: string) {
  const base = Math.floor(totalCents / count);
  const [y, m, d] = startsOn.split("-").map(Number);
  const firstMonth0 = d! <= dueDay ? m! - 1 : m!;
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    dueDate: dateOn(y!, firstMonth0 + i, dueDay),
    amountCents: i === count - 1 ? totalCents - base * (count - 1) : base,
  }));
}

export type InstallmentStatus = "a_vencer" | "vencida" | "paga" | "cancelada";

/** Vencida a partir do dia seguinte ao vencimento (decisão D9). */
export function installmentStatus(i: { dueDate: string; amountCents: number; paidCents: number; cancelledAt: Date | null }, today: string): InstallmentStatus {
  if (i.cancelledAt) return "cancelada";
  if (i.paidCents >= i.amountCents) return "paga";
  return today > i.dueDate ? "vencida" : "a_vencer";
}

export function daysLate(dueDate: string, today: string): number {
  if (today <= dueDate) return 0;
  let n = 0;
  for (let d = dueDate; d < today; d = addDays(d, 1)) n++;
  return n;
}
