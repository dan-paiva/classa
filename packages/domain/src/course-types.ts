/**
 * Tipos de curso (DOMINIO.md §4.1). O tipo é a regra, não um rótulo: ele decide
 * como o aluno se liga às aulas, se o curso tem níveis, quantas vagas cabem e
 * quem marca a aula. O tipo não muda depois de criado.
 *
 * - `regular`: o aluno pertence a uma turma, com horário e professor fixos, e
 *   entra sozinho em todas as aulas dela;
 * - `open_entry`: o aluno não pertence a turma nenhuma; a escola publica os
 *   horários que já têm professor e ele escolhe aula a aula, só no nível dele,
 *   encontrando colegas diferentes em cada horário;
 * - `particular` (private): só o aluno e um professor, numa turma de 1 vaga.
 *
 * O regime da turma e da matrícula é sempre o tipo do curso.
 */
export const COURSE_KINDS = ["regular", "open_entry", "particular"] as const;
export type CourseKind = (typeof COURSE_KINDS)[number];

export type CourseKindRules = {
  /** O curso se divide em níveis. */
  levels: "obrigatorio" | "opcional" | "nao";
  /** Alunos por aula fixo pelo tipo; `null` deixa a escola definir. */
  fixedCapacity: number | null;
  /** A matrícula fica presa a uma turma (horário e professor fixos). */
  enrollsInClassGroup: boolean;
  /** O aluno escolhe a aula; vale o "quem marca" do curso. */
  studentBooks: boolean;
  /** A folha paga valor fixo por aula, não o valor hora. */
  fixedTeacherRate: boolean;
  /** Regras para mostrar na tela do curso, em frases curtas. Termos entre chaves vêm do vocabulário (`ruleText`). */
  summary: string[];
};

export const COURSE_KIND_RULES: Record<CourseKind, CourseKindRules> = {
  regular: {
    levels: "opcional",
    fixedCapacity: null,
    enrollsInClassGroup: true,
    studentBooks: false,
    fixedTeacherRate: false,
    summary: [
      "Horário e professor fixos: o aluno não troca de {turma}.",
      "A matrícula inscreve o aluno em todas as aulas futuras.",
      "Com {níveis}, cada {turma} é de um {nível}.",
    ],
  },
  open_entry: {
    levels: "obrigatorio",
    fixedCapacity: null,
    enrollsInClassGroup: false,
    studentBooks: true,
    fixedTeacherRate: false,
    summary: [
      "O aluno não fica preso a horário: escolhe aula a aula os horários que já têm professor.",
      "Só aparecem horários do {nível} do aluno, e a cada aula ele encontra colegas diferentes.",
      "A reserva fecha na mesma antecedência do cancelamento e respeita vagas e saldo.",
      "Precisa de ao menos um {nível} para publicar horários.",
    ],
  },
  particular: {
    levels: "nao",
    fixedCapacity: 1,
    enrollsInClassGroup: true,
    studentBooks: false,
    fixedTeacherRate: true,
    summary: [
      "Só o aluno e um professor: sempre 1 vaga.",
      "Vaga única, com horário e professor combinados com o aluno.",
      "O professor recebe valor fixo por aula.",
      "Recebe as aulas bônus do {open_entry}, quando a escola usa essa regra.",
    ],
  },
};

export const courseKindRules = (kind: CourseKind) => COURSE_KIND_RULES[kind];
export const hasLevels = (kind: CourseKind) => COURSE_KIND_RULES[kind].levels !== "nao";

/** Ponto de partida das regras de um curso novo. A escola ajusta depois. */
export function defaultCourseRules(kind: CourseKind) {
  switch (kind) {
    case "particular":
      return { capacity: 1, lessonMinutes: 60, packageLessons: 32, cancelNoticeHours: 24, lessonPriceCents: 14000, modalities: ["online", "presencial"] as ("online" | "presencial")[], autoAgenda: false };
    case "open_entry":
      return { capacity: 6, lessonMinutes: 60, packageLessons: 48, cancelNoticeHours: 6, lessonPriceCents: 6000, modalities: ["online"] as ("online" | "presencial")[], autoAgenda: true };
    case "regular":
      return { capacity: 8, lessonMinutes: 60, packageLessons: 48, cancelNoticeHours: 6, lessonPriceCents: 6000, modalities: ["online", "presencial"] as ("online" | "presencial")[], autoAgenda: false };
  }
}

/* ------------------------------------------------------------------ aula bônus */

export type BonusRule = {
  enabled: boolean;
  /** A cada quantas presenças em aula open entry o aluno ganha uma aula private. */
  every: number;
};

export const DEFAULT_BONUS_RULE: BonusRule = { enabled: false, every: 5 };

/** Quantas aulas bônus o aluno já conquistou com essas presenças. */
export function bonusLessonsEarned(presences: number, rule: BonusRule) {
  if (!rule.enabled || rule.every < 1) return 0;
  return Math.floor(presences / rule.every);
}
