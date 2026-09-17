import { COURSE_TYPES } from "@classa/db";
import { describe, expect, it } from "vitest";
import { allowsModules, defaultRules } from "./domain.ts";

describe("regras de curso", () => {
  it("particular é sempre um aluno por aula e sem módulos", () => {
    expect(defaultRules("particular").capacity).toBe(1);
    expect(allowsModules("particular")).toBe(false);
  });

  it("grupo e turmas dedicadas aceitam módulos", () => {
    expect(COURSE_TYPES.filter(allowsModules)).toEqual(["grupo", "turmas_dedicadas"]);
  });

  it("todo tipo tem regras válidas", () => {
    for (const type of COURSE_TYPES) {
      const r = defaultRules(type);
      expect(r.capacity).toBeGreaterThan(0);
      expect(r.lessonMinutes).toBeGreaterThan(0);
      expect(r.packageLessons).toBeGreaterThan(0);
      expect(r.modalities.length).toBeGreaterThan(0);
    }
  });
});
