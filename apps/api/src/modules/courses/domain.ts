import type { CourseType, Modality } from "@classa/db";

export type CourseRules = {
  capacity: number;
  lessonMinutes: number;
  packageLessons: number;
  cancelNoticeHours: number;
  lessonPriceCents: number;
  modalities: Modality[];
};

export const COURSE_TYPE_LABELS: Record<CourseType, string> = {
  grupo: "Em grupo",
  particular: "Particular",
  hibrido: "Híbrido",
  workshop: "Workshop",
  turmas_dedicadas: "Turmas dedicadas",
};

/** Só cursos em grupo e turmas dedicadas se dividem em módulos (no caso das turmas, cada turma ocupa o lugar do módulo). */
export function allowsModules(type: CourseType): boolean {
  return type === "grupo" || type === "turmas_dedicadas";
}

/** Regras iniciais por tipo de curso. A escola ajusta depois; são só um ponto de partida. */
export function defaultRules(type: CourseType): CourseRules {
  switch (type) {
    case "particular":
      return { capacity: 1, lessonMinutes: 60, packageLessons: 32, cancelNoticeHours: 24, lessonPriceCents: 14000, modalities: ["online", "presencial"] };
    case "turmas_dedicadas":
      return { capacity: 25, lessonMinutes: 50, packageLessons: 36, cancelNoticeHours: 6, lessonPriceCents: 40000, modalities: ["presencial", "online"] };
    case "workshop":
      return { capacity: 20, lessonMinutes: 90, packageLessons: 1, cancelNoticeHours: 24, lessonPriceCents: 8000, modalities: ["online"] };
    case "hibrido":
      return { capacity: 8, lessonMinutes: 45, packageLessons: 48, cancelNoticeHours: 6, lessonPriceCents: 6000, modalities: ["online", "presencial"] };
    case "grupo":
      return { capacity: 8, lessonMinutes: 45, packageLessons: 48, cancelNoticeHours: 6, lessonPriceCents: 6000, modalities: ["online"] };
  }
}
