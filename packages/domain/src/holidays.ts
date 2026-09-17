import { addDays } from "./time.ts";

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Feriados nacionais e pontos facultativos usados pela agenda (sem aula). */
export function nationalHolidays(year: number): { date: string; name: string }[] {
  const easter = easterSunday(year);
  const fixed: [string, string][] = [
    ["01-01", "Confraternização Universal"],
    ["04-21", "Tiradentes"],
    ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"],
    ["10-12", "Nossa Senhora Aparecida"],
    ["11-02", "Finados"],
    ["11-15", "Proclamação da República"],
    ["11-20", "Dia da Consciência Negra"],
    ["12-25", "Natal"],
  ];
  return [
    ...fixed.map(([md, name]) => ({ date: `${year}-${md}`, name })),
    { date: addDays(easter, -48), name: "Carnaval (segunda)" },
    { date: addDays(easter, -47), name: "Carnaval (terça)" },
    { date: addDays(easter, -2), name: "Sexta-feira Santa" },
    { date: addDays(easter, 60), name: "Corpus Christi" },
  ].sort((x, y) => x.date.localeCompare(y.date));
}
