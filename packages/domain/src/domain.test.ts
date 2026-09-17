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
