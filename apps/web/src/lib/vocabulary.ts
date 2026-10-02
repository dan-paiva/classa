import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { COURSE_KIND_RULES, DEFAULT_VOCABULARY, lowerTerm, newTerm, ruleText, type CourseKind, type Vocabulary } from "@classa/domain";
import { school } from "../api-school.ts";

/**
 * Como a escola chama curso, nível, turma e os tipos de curso (DOMINIO.md §4.6).
 * Enquanto carrega, vale o vocabulário padrão: a tela nunca fica sem rótulo.
 */
export function useSchoolSettings() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  return useQuery({ queryKey: ["school-settings", slug], queryFn: () => school.schoolSettings(slug!), enabled: !!slug, staleTime: 60_000 });
}

export type Vocab = Vocabulary & {
  /** Nome do tipo de curso na escola. */
  kind: (k: CourseKind) => string;
  /** "Novo curso", "Nova turma". */
  novo: (t: keyof Pick<Vocabulary, "course" | "level" | "classGroup">) => string;
  /** Regras do tipo de curso já com os nomes da escola. */
  rules: (k: CourseKind) => string[];
  /** Termo em minúscula, para o meio da frase. */
  lower: (t: keyof Pick<Vocabulary, "course" | "level" | "classGroup">, plural?: boolean) => string;
};

export function useVocab(): Vocab {
  const v = useSchoolSettings().data?.vocabulary ?? DEFAULT_VOCABULARY;
  return {
    ...v,
    kind: (k) => v.kinds[k],
    novo: (t) => newTerm(v[t]),
    rules: (k) => COURSE_KIND_RULES[k].summary.map((r) => ruleText(r, v)),
    lower: (t, plural) => lowerTerm(plural ? v[t].plural : v[t].singular),
  };
}

export { COURSE_KIND_RULES };
