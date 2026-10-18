import { describe, expect, it } from "vitest";
import { fitsAccount, overloads, peakConcurrency, pickVideoRoom, type Interval } from "./index.ts";

/** Aula num dia fixo, em minutos do dia: at(19*60, 60) = 19h às 20h. */
const at = (startMin: number, minutes = 60): Interval => ({ start: startMin * 60_000, end: (startMin + minutes) * 60_000 });

describe("contas de vídeo", () => {
  it("uma aula que termina quando a outra começa não se sobrepõe", () => {
    expect(peakConcurrency([at(9 * 60), at(10 * 60)])).toBe(1);
  });

  it("a terceira aula ao mesmo tempo não cabe numa conta de duas", () => {
    expect(fitsAccount([at(19 * 60), at(19 * 60)], [at(19 * 60)], 2, 10)).toBe(false);
    expect(fitsAccount([at(19 * 60)], [at(19 * 60)], 2, 10)).toBe(true);
  });

  it("a folga conta: aula até as 10h e aula às 10h05 se sobrepõem com 10 minutos", () => {
    const busy = [at(9 * 60), at(10 * 60 + 5)];
    expect(fitsAccount(busy, [at(9 * 60 + 30)], 2, 10)).toBe(false);
    expect(fitsAccount(busy, [at(9 * 60 + 30)], 2, 0)).toBe(true);
  });

  it("conta cheia em outro horário não impede a aula nova", () => {
    expect(fitsAccount([at(8 * 60), at(8 * 60), at(8 * 60)], [at(19 * 60)], 2, 10)).toBe(true);
  });

  it("aponta o trecho em que a conta passa do limite, com as aulas dele", () => {
    const a = at(19 * 60), b = at(19 * 60 + 30), c = at(19 * 60 + 45);
    const o = overloads([a, b, c], 2, 0);
    expect(o).toHaveLength(1);
    expect(o[0]!.items).toEqual([a, b, c]);
    expect(o[0]!.start).toBe(c.start);
    expect(o[0]!.end).toBe(a.end);
  });

  const room = (roomId: string, accountId: string, accountBusy: Interval[], roomBusy: Interval[] = []) => ({
    roomId, accountId, maxConcurrent: 2, bufferMinutes: 10, accountBusy, roomBusy,
  });

  it("prefere a sala que a turma já usa, para o link não mudar", () => {
    const pick = pickVideoRoom([room("r1", "c1", []), room("r2", "c2", [at(19 * 60)])], [at(19 * 60)], "r2");
    expect(pick).toEqual({ ok: true, roomId: "r2", accountId: "c2" });
  });

  it("sem preferência, vai para a conta menos ocupada", () => {
    const pick = pickVideoRoom([room("r1", "c1", [at(8 * 60)]), room("r2", "c2", [])], [at(19 * 60)]);
    expect(pick).toMatchObject({ ok: true, roomId: "r2" });
  });

  it("a sala ocupada no horário não serve, mesmo com a conta livre", () => {
    const pick = pickVideoRoom([room("r1", "c1", [at(19 * 60)], [at(19 * 60)])], [at(19 * 60)]);
    expect(pick.ok).toBe(false);
  });

  it("com todas as contas cheias, recusa e diz por quê", () => {
    const full = [at(19 * 60), at(19 * 60)];
    expect(pickVideoRoom([room("r1", "c1", full), room("r2", "c2", full)], [at(19 * 60)])).toEqual({
      ok: false,
      reason: "Todas as contas de vídeo estão cheias nesse horário",
    });
  });
});
