import type { CourseType, Modality } from "@classa/db";
import { COURSE_KIND_RULES, defaultCourseRules, DEFAULT_VOCABULARY, hasLevels } from "@classa/domain";

export type CourseRules = {
  capacity: number;
  lessonMinutes: number;
  packageLessons: number;
  cancelNoticeHours: number;
  lessonPriceCents: number;
  modalities: Modality[];
  autoAgenda: boolean;
};

export const COURSE_TYPE_LABELS: Record<CourseType, string> = DEFAULT_VOCABULARY.kinds;

/** Regular e open entry se dividem em níveis; private não (DOMINIO.md §4.1). */
export function allowsModules(type: CourseType): boolean {
  return hasLevels(type);
}

/** Alunos por aula fixados pelo tipo (private = 1); `null` deixa a escola escolher. */
export const fixedCapacity = (type: CourseType) => COURSE_KIND_RULES[type].fixedCapacity;

/** Regras iniciais por tipo de curso. A escola ajusta depois; são só um ponto de partida. */
export function defaultRules(type: CourseType): CourseRules {
  return defaultCourseRules(type);
}
