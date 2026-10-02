import type { CourseKind } from "./course-types.ts";

/**
 * Vocabulário da escola (DOMINIO.md §4.6): cada escola chama curso, nível e
 * turma, e os tipos de curso, pelo nome que usa no dia a dia. Só muda o que
 * aparece na tela; as regras continuam presas ao tipo.
 */
export type Term = {
  singular: string;
  plural: string;
  /** Concordância: "novo curso", "nova turma". */
  feminine: boolean;
};

export type Vocabulary = {
  course: Term;
  level: Term;
  classGroup: Term;
  kinds: Record<CourseKind, string>;
};

export const DEFAULT_VOCABULARY: Vocabulary = {
  course: { singular: "Curso", plural: "Cursos", feminine: false },
  level: { singular: "Nível", plural: "Níveis", feminine: false },
  classGroup: { singular: "Turma", plural: "Turmas", feminine: true },
  kinds: { regular: "Regular", open_entry: "Open entry", particular: "Private" },
};

/** Completa o que a escola não personalizou com o padrão. */
export function resolveVocabulary(custom?: Partial<{ [K in keyof Vocabulary]: Partial<Vocabulary[K]> }> | null): Vocabulary {
  const term = (k: "course" | "level" | "classGroup") => {
    const c = custom?.[k] as Partial<Term> | undefined;
    const d = DEFAULT_VOCABULARY[k];
    return {
      singular: c?.singular?.trim() || d.singular,
      plural: c?.plural?.trim() || d.plural,
      feminine: c?.feminine ?? d.feminine,
    };
  };
  const kinds = custom?.kinds as Partial<Record<CourseKind, string>> | undefined;
  return {
    course: term("course"),
    level: term("level"),
    classGroup: term("classGroup"),
    kinds: {
      regular: kinds?.regular?.trim() || DEFAULT_VOCABULARY.kinds.regular,
      open_entry: kinds?.open_entry?.trim() || DEFAULT_VOCABULARY.kinds.open_entry,
      particular: kinds?.particular?.trim() || DEFAULT_VOCABULARY.kinds.particular,
    },
  };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "Novo curso", "Nova turma". */
export const newTerm = (t: Term) => `${t.feminine ? "Nova" : "Novo"} ${lower(t.singular)}`;
/** Primeira letra minúscula, para usar no meio da frase. */
export const lowerTerm = lower;

/** Troca {turma}, {nível}, {níveis}, {curso} e {open_entry} pelos nomes da escola. */
export function ruleText(text: string, v: Vocabulary) {
  return text
    .replaceAll("{turma}", lower(v.classGroup.singular))
    .replaceAll("{níveis}", lower(v.level.plural))
    .replaceAll("{nível}", lower(v.level.singular))
    .replaceAll("{curso}", lower(v.course.singular))
    .replaceAll("{open_entry}", v.kinds.open_entry);
}
