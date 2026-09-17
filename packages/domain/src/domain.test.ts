import { describe, expect, it } from "vitest";
import {
  cancelledInTime,
  cpfFromBase,
  creditForAttendance,
  easterSunday,
  fitsAvailability,
  generateLessonSlots,
  hoursTouched,
  isValidCpf,
  nationalHolidays,
  zonedToUtc,
  type OperatingDay,
} from "./index.ts";

const HOURS: OperatingDay[] = [
  { weekday: 0, closed: true },
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, open: "07:00", close: "22:00" })),
  { weekday: 6, open: "08:00", close: "13:00" },
];

describe("fuso horário", () => {
  it("converte hora de São Paulo para UTC (UTC-3)", () => {
    expect(zonedToUtc("2026-09-21", "18:30", "America/Sao_Paulo").toISOString()).toBe("2026-09-21T21:30:00.000Z");
  });
});

describe("feriados nacionais", () => {
  it("calcula a Páscoa e os feriados móveis", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    const dates = nationalHolidays(2026).map((h) => h.date);
    expect(dates).toContain("2026-02-16"); // carnaval segunda
    expect(dates).toContain("2026-04-03"); // sexta-feira santa
    expect(dates).toContain("2026-06-04"); // corpus christi
    expect(dates).toContain("2026-11-20");
  });
});

describe("geração de aulas", () => {
  const base = {
    period: { startsOn: "2026-09-01", endsOn: "2026-09-30" },
    lessonMinutes: 60,
    operatingHours: HOURS,
    timeZone: "America/Sao_Paulo",
  };

  it("gera uma aula por dia e horário dentro do período", () => {
    const { slots } = generateLessonSlots({
      ...base,
      range: { from: "2026-09-14", to: "2026-09-20" },
      schedules: [
        { weekday: 1, startTime: "19:00" },
        { weekday: 3, startTime: "19:00:00" },
      ],
      holidays: new Set(),
    });
    expect(slots.map((s) => s.date)).toEqual(["2026-09-14", "2026-09-16"]);
    expect(slots[0]!.endsAt.getTime() - slots[0]!.startsAt.getTime()).toBe(60 * 60000);
  });

  it("pula feriado e aula que não cabe no funcionamento", () => {
    const { slots, skipped } = generateLessonSlots({
      ...base,
      range: { from: "2026-09-05", to: "2026-09-12" },
      schedules: [
        { weekday: 1, startTime: "08:00" }, // 7/9 é feriado
        { weekday: 6, startTime: "12:30" }, // sábado fecha 13h e a aula tem 60 min
      ],
      holidays: new Set(["2026-09-07"]),
    });
    expect(slots).toEqual([]);
    expect(skipped.map((s) => s.reason).sort()).toEqual(["feriado", "fora_do_funcionamento", "fora_do_funcionamento"]);
  });

  it("respeita o fim do período da turma", () => {
    const { slots } = generateLessonSlots({
      ...base,
      period: { startsOn: "2026-09-01", endsOn: "2026-09-15" },
      range: { from: "2026-09-14", to: "2026-09-30" },
      schedules: [{ weekday: 1, startTime: "19:00" }],
      holidays: new Set(),
    });
    expect(slots.map((s) => s.date)).toEqual(["2026-09-14"]);
  });
});

describe("disponibilidade", () => {
  it("considera a duração inteira da aula", () => {
    expect(hoursTouched(1, "18:30", 60)).toEqual([118, 119]);
    expect(fitsAvailability([118], 1, "18:30", 60)).toBe(false);
    expect(fitsAvailability([118, 119], 1, "18:30", 60)).toBe(true);
    expect(fitsAvailability([118], 1, "18:00", 45)).toBe(true);
  });
});

describe("CPF", () => {
  it("gera e valida dígitos verificadores", () => {
    const cpf = cpfFromBase("123456789");
    expect(cpf).toBe("12345678909");
    expect(isValidCpf(cpf)).toBe(true);
    expect(isValidCpf("123.456.789-00")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });
});

describe("créditos", () => {
  const policy = { noShowDebits: true, lateCancelDebits: true };

  it("presença sempre gasta; falta e cancelamento tardio seguem a política", () => {
    expect(creditForAttendance("presente", null, policy)).toEqual({ kind: "presenca", amount: -1 });
    expect(creditForAttendance("falta", null, policy)).toEqual({ kind: "falta", amount: -1 });
    expect(creditForAttendance("falta", null, { ...policy, noShowDebits: false })).toBeNull();
    expect(creditForAttendance("cancelou", true, policy)).toBeNull();
    expect(creditForAttendance("cancelou", false, policy)).toEqual({ kind: "cancelamento_tardio", amount: -1 });
  });

  it("antecedência mínima", () => {
    const aula = new Date("2026-09-21T21:00:00Z");
    expect(cancelledInTime(new Date("2026-09-21T15:00:00Z"), aula, 6)).toBe(true);
    expect(cancelledInTime(new Date("2026-09-21T15:00:01Z"), aula, 6)).toBe(false);
  });
});

import { buildInstallments, daysLate, installmentStatus } from "./finance.ts";

describe("parcelas", () => {
  it("divide em centavos com a última absorvendo o arredondamento", () => {
    const p = buildInstallments(100000, 3, 10, "2026-09-05");
    expect(p.map((x) => x.amountCents)).toEqual([33333, 33333, 33334]);
    expect(p.map((x) => x.dueDate)).toEqual(["2026-09-10", "2026-10-10", "2026-11-10"]);
  });

  it("começa no mês seguinte se o dia de vencimento já passou e vira o ano", () => {
    const p = buildInstallments(60000, 3, 10, "2026-11-20");
    expect(p.map((x) => x.dueDate)).toEqual(["2026-12-10", "2027-01-10", "2027-02-10"]);
  });

  it("vence no dia seguinte ao vencimento", () => {
    const i = { dueDate: "2026-09-10", amountCents: 100, paidCents: 0, cancelledAt: null };
    expect(installmentStatus(i, "2026-09-10")).toBe("a_vencer");
    expect(installmentStatus(i, "2026-09-11")).toBe("vencida");
    expect(installmentStatus({ ...i, paidCents: 100 }, "2026-09-30")).toBe("paga");
    expect(daysLate("2026-09-10", "2026-09-26")).toBe(16);
  });
});

import { lessonPayValue, monthStatus, nextMonthStart, payrollSituation } from "./payroll.ts";

describe("folha", () => {
  it("situação da aula", () => {
    expect(payrollSituation({ state: "concluida", teacherId: "t", supportReason: null })).toBe("paga");
    expect(payrollSituation({ state: "concluida", teacherId: "t", supportReason: "tecnico" })).toBe("descontada");
    expect(payrollSituation({ state: "nao_finalizada", teacherId: "t", supportReason: null })).toBe("pendente");
    expect(payrollSituation({ state: "cancelada", teacherId: "t", supportReason: null })).toBe("fora");
    expect(payrollSituation({ state: "concluida", teacherId: null, supportReason: null })).toBe("fora");
  });

  it("valor: particular fixo, grupo por hora, ajuste vence", () => {
    expect(lessonPayValue({ individual: true, classRateCents: null, overrideCents: null, hourlyRateCents: 9000, minutes: 60 })).toBe(12000);
    expect(lessonPayValue({ individual: true, classRateCents: 15000, overrideCents: null, hourlyRateCents: null, minutes: 60 })).toBe(15000);
    expect(lessonPayValue({ individual: false, classRateCents: null, overrideCents: null, hourlyRateCents: 7000, minutes: 45 })).toBe(5250);
    expect(lessonPayValue({ individual: true, classRateCents: 15000, overrideCents: 9000, hourlyRateCents: null, minutes: 60 })).toBe(9000);
  });

  it("competência", () => {
    expect(monthStatus("2026-09", "2026-09-17", 0, false)).toBe("em_andamento");
    expect(monthStatus("2026-08", "2026-09-17", 2, false)).toBe("travada");
    expect(monthStatus("2026-08", "2026-09-17", 0, false)).toBe("pronta");
    expect(monthStatus("2026-08", "2026-09-17", 0, true)).toBe("fechada");
    expect(nextMonthStart("2026-12")).toBe("2027-01-01");
  });
});

import { cnpjFromBase, collaboratorDiscountCents, companyAlerts, companyContractStatus, companyMonthlyCharge, isValidCnpj } from "./company.ts";

describe("empresas", () => {
  it("CNPJ", () => {
    const cnpj = cnpjFromBase("112223330001");
    expect(isValidCnpj(cnpj)).toBe(true);
    expect(cnpj).toBe("11222333000181");
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
  });

  it("situação do contrato", () => {
    expect(companyContractStatus("2026-12-31", "2026-09-17").status).toBe("ativo");
    expect(companyContractStatus("2026-10-17", "2026-09-17")).toEqual({ status: "renovacao", daysLeft: 30 });
    expect(companyContractStatus("2026-09-10", "2026-09-17")).toEqual({ status: "encerrado", daysLeft: -7 });
  });

  it("cobrança da empresa e parte do colaborador", () => {
    expect(companyMonthlyCharge({ model: "b2b", licenses: 5, activeStudents: 2, licensePriceCents: 40000, subsidyPercent: 100 })).toEqual({ billedLicenses: 5, amountCents: 200000 });
    expect(companyMonthlyCharge({ model: "b2b2c", licenses: 10, activeStudents: 4, licensePriceCents: 30000, subsidyPercent: 50 })).toEqual({ billedLicenses: 4, amountCents: 60000 });
    // bruto 1000: empresa 50%, colaborador paga 500 com 20% de desconto = 400 → desconto no contrato 600
    expect(collaboratorDiscountCents(1000, 50, 20)).toBe(600);
    expect(collaboratorDiscountCents(1000, 100, 0)).toBe(1000);
  });

  it("alertas da conta", () => {
    const a = companyAlerts({ status: "renovacao", daysLeft: 20, autoRenew: false, licensesInUse: 6, licenses: 5, consumed: 90, contractedLessons: 100, attendancePercent: 70, delinquentStudents: 1 });
    expect(a.map((x) => x.tone)).toEqual(["danger", "danger", "warn", "warn", "danger"]);
  });
});

import { checkRequires, FLOWS, missingRequired, transitionPath } from "./workflows.ts";

describe("fluxos", () => {
  const sub = FLOWS.substituicao;
  it("pular etapas atravessa as intermediárias; alternativa e volta não", () => {
    const r = transitionPath(sub, "pedido", "concluido");
    expect(r.ok && r.path.map((s) => s.key)).toEqual(["buscando", "confirmado", "concluido"]);
    const alt = transitionPath(sub, "buscando", "cancelado");
    expect(alt.ok && alt.path.map((s) => s.key)).toEqual(["cancelado"]);
    const back = transitionPath(sub, "confirmado", "pedido");
    expect(back.ok && back.path).toEqual([]);
    expect(transitionPath(sub, "concluido", "buscando").ok).toBe(false);
    expect(transitionPath(sub, "concluido", "pedido").ok).toBe(true);
  });

  it("requisitos da etapa e dos campos", () => {
    expect(checkRequires(sub.stages[2]!, {}, sub)).toBe("Para Confirmado, preencha: Substituto.");
    expect(checkRequires(sub.stages[2]!, { substituteId: "x" }, sub)).toBeNull();
    expect(missingRequired(FLOWS.admissao, { name: "" })).toEqual(["name"]);
  });
});
