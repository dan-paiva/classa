/** Valor padrão por aula particular quando a turma não define um (herdado do protótipo). */
export const DEFAULT_PRIVATE_LESSON_RATE_CENTS = 12000;

export type PayrollSituation = "paga" | "descontada" | "pendente" | "fora";

/**
 * Situação da aula na folha:
 * - cancelada ou sem professor: fora;
 * - não finalizada (ou ainda sem conclusão): pendente, e trava o fechamento;
 * - concluída com pedido de suporte: descontada;
 * - concluída: paga (com presença ou com falta do aluno).
 */
export function payrollSituation(l: { state: string; teacherId: string | null; supportReason: string | null }): PayrollSituation {
  if (l.state === "cancelada" || !l.teacherId) return "fora";
  if (l.state !== "concluida") return "pendente";
  return l.supportReason ? "descontada" : "paga";
}

export function lessonPayValue(input: {
  individual: boolean;
  classRateCents: number | null;
  overrideCents: number | null;
  hourlyRateCents: number | null;
  minutes: number;
}): number {
  if (input.overrideCents != null) return input.overrideCents;
  if (input.individual) return input.classRateCents ?? DEFAULT_PRIVATE_LESSON_RATE_CENTS;
  return Math.round(((input.hourlyRateCents ?? 0) * input.minutes) / 60);
}

export type MonthStatus = "em_andamento" | "travada" | "pronta" | "fechada";

export function monthStatus(month: string, today: string, pending: number, closed: boolean): MonthStatus {
  if (closed) return "fechada";
  if (today.slice(0, 7) <= month) return "em_andamento";
  return pending > 0 ? "travada" : "pronta";
}

/** Primeiro dia do mês seguinte, "AAAA-MM-DD". */
export function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, "0")}-01`;
}
