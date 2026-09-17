import { onlyDigits } from "./cpf.ts";
import { daysLate } from "./finance.ts";

export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(cnpj[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

/** CNPJ válido a partir de 12 dígitos base. Uso: dados de demonstração. */
export function cnpjFromBase(base12: string): string {
  const digits = onlyDigits(base12).padStart(12, "0").slice(0, 12);
  for (let d1 = 0; d1 <= 9; d1++) {
    for (let d2 = 0; d2 <= 9; d2++) {
      if (isValidCnpj(`${digits}${d1}${d2}`)) return `${digits}${d1}${d2}`;
    }
  }
  return digits;
}

export type CompanyContractStatus = "ativo" | "renovacao" | "encerrado";

/** Encerrado se já venceu; em renovação se vence em até 60 dias. */
export function companyContractStatus(endsOn: string, today: string): { status: CompanyContractStatus; daysLeft: number } {
  const daysLeft = today > endsOn ? -daysLate(endsOn, today) : daysLate(today, endsOn);
  return { status: daysLeft < 0 ? "encerrado" : daysLeft <= 60 ? "renovacao" : "ativo", daysLeft };
}

/**
 * Cobrança mensal da parte da empresa:
 * - B2B: licenças contratadas × valor, 100% da empresa;
 * - B2B2C: colaboradores ativos × valor × subsídio (a parte do colaborador vai no contrato dele).
 */
export function companyMonthlyCharge(input: { model: "b2b" | "b2b2c"; licenses: number; activeStudents: number; licensePriceCents: number; subsidyPercent: number }) {
  if (input.model === "b2b") return { billedLicenses: input.licenses, amountCents: input.licenses * input.licensePriceCents };
  return {
    billedLicenses: input.activeStudents,
    amountCents: Math.round((input.activeStudents * input.licensePriceCents * input.subsidyPercent) / 100),
  };
}

/**
 * Desconto no contrato individual do colaborador B2B2C: ele paga só a parte que a empresa
 * não subsidia, com o desconto aplicado sobre essa parte (decisão D5).
 */
export function collaboratorDiscountCents(grossCents: number, subsidyPercent: number, discountPercent: number) {
  const share = Math.round(grossCents * (1 - subsidyPercent / 100) * (1 - discountPercent / 100));
  return grossCents - share;
}

export type CompanyAlert = { tone: "danger" | "warn" | "muted"; message: string };

export function companyAlerts(input: {
  status: CompanyContractStatus;
  daysLeft: number;
  autoRenew: boolean;
  licensesInUse: number;
  licenses: number;
  consumed: number;
  contractedLessons: number;
  attendancePercent: number | null;
  delinquentStudents: number;
}): CompanyAlert[] {
  const alerts: CompanyAlert[] = [];
  if (input.status === "encerrado") alerts.push({ tone: "muted", message: `Contrato encerrado há ${-input.daysLeft} dias` });
  else if (input.daysLeft <= 60)
    alerts.push({ tone: input.daysLeft <= 30 ? "danger" : "warn", message: `Vence em ${input.daysLeft} dias · ${input.autoRenew ? "renova sozinho" : "sem renovação automática"}` });
  if (input.licensesInUse > input.licenses) alerts.push({ tone: "danger", message: `${input.licensesInUse - input.licenses} acima das licenças` });
  if (input.contractedLessons > 0 && input.consumed / input.contractedLessons >= 0.85)
    alerts.push({ tone: "warn", message: `Consumo em ${Math.round((input.consumed / input.contractedLessons) * 100)}% das aulas` });
  if (input.attendancePercent != null && input.attendancePercent < 80) alerts.push({ tone: "warn", message: `Presença em ${input.attendancePercent}%` });
  if (input.delinquentStudents > 0) alerts.push({ tone: "danger", message: `${input.delinquentStudents} aluno(s) inadimplente(s)` });
  return alerts;
}
