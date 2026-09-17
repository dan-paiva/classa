import type { AttendanceStatus } from "./types.ts";

export type CreditPolicy = { noShowDebits: boolean; lateCancelDebits: boolean };

/** Lançamento que a situação final do aluno na aula gera no extrato (null = nenhum). */
export function creditForAttendance(
  status: AttendanceStatus,
  cancelledInTime: boolean | null,
  policy: CreditPolicy,
): { kind: "presenca" | "falta" | "cancelamento_tardio"; amount: -1 } | null {
  if (status === "presente") return { kind: "presenca", amount: -1 };
  if (status === "falta") return policy.noShowDebits ? { kind: "falta", amount: -1 } : null;
  if (status === "cancelou" && cancelledInTime === false && policy.lateCancelDebits) return { kind: "cancelamento_tardio", amount: -1 };
  return null;
}

/** Cancelou com a antecedência mínima do curso? */
export function cancelledInTime(now: Date, lessonStartsAt: Date, cancelNoticeHours: number): boolean {
  return lessonStartsAt.getTime() - now.getTime() >= cancelNoticeHours * 3600_000;
}
