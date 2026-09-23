import { patch, post, request, type Modality } from "./api.ts";

/* -------------------------------------------------------------------- pessoas */

export type Person = { id: string; name: string; email: string | null; cpf: string | null; phone: string | null; birthDate: string | null };
export type PersonInput = { name: string; email?: string | null; cpf?: string | null; phone?: string | null; birthDate?: string | null };

export type TeacherCourse = { teacherId: string; courseId: string; moduleIds: string[] | null; courseName: string; color: string };
export type Teacher = {
  id: string;
  personId: string;
  weeklyLimit: number;
  hourlyRateCents: number | null;
  availability: number[];
  deactivatedAt: string | null;
  person: Person;
  courses: TeacherCourse[];
  weeklyLoad: number;
};

export const STUDENT_STATUSES = ["ativo", "suspenso", "congelado", "inadimplente", "cancelado", "inativo"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  ativo: "Ativo",
  suspenso: "Suspenso",
  congelado: "Congelado",
  inadimplente: "Inadimplente",
  cancelado: "Cancelado",
  inativo: "Inativo",
};

export type StudentRow = {
  id: string;
  status: StudentStatus;
  previousStatus: StudentStatus | null;
  availability: number[];
  person: Person;
  companyName: string | null;
  activeEnrollments: number;
  balance: number;
  overdueInstallments: number;
};

export type CompanyModel = "b2b" | "b2b2c";
export const COMPANY_MODEL_LABELS: Record<CompanyModel, string> = { b2b: "B2B · empresa paga", b2b2c: "B2B2C · benefício dividido" };
export type CompanyAlert = { tone: "danger" | "warn" | "muted"; message: string };
export type Company = {
  id: string;
  name: string;
  cnpj: string | null;
  segment: string | null;
  model: CompanyModel;
  hrName: string | null;
  hrEmail: string | null;
  startsOn: string;
  endsOn: string;
  licenses: number;
  contractedLessons: number;
  licensePriceCents: number;
  subsidyPercent: number;
  discountPercent: number;
  autoRenew: boolean;
  allowedCourseIds: string[] | null;
  lastReportSentAt: string | null;
  linked: number;
  licensesInUse: number;
  consumed: number;
  attendancePercent: number | null;
  delinquent: number;
  status: "ativo" | "renovacao" | "encerrado";
  daysLeft: number;
  monthlyCompanyCents: number;
  monthlyCollaboratorCents: number;
  alerts: CompanyAlert[];
};
export type CompanyInput = Pick<Company, "name" | "model" | "startsOn" | "endsOn" | "licenses" | "contractedLessons" | "licensePriceCents" | "subsidyPercent" | "discountPercent" | "autoRenew"> & {
  cnpj?: string | null;
  segment?: string | null;
  hrName?: string | null;
  hrEmail?: string | null;
  allowedCourseIds?: string[] | null;
};
export type CompanyCharge = { id: string; month: string; billedLicenses: number; amountCents: number; dueDate: string; paidOn: string | null; method: PaymentMethod | null };

export type Room = { id: string; name: string; kind: "virtual" | "presencial" | "auditorio"; link: string | null; capacity: number | null; deactivatedAt: string | null };
export const ROOM_KIND_LABELS = { virtual: "Virtual", presencial: "Presencial", auditorio: "Auditório" } as const;

/* --------------------------------------------------------------------- agenda */

export type Schedule = { weekday: number; startTime: string };

/** Como o aluno se liga à turma. Não confundir com modalidade (online/presencial). */
export const CLASS_REGIMES = ["regular", "open_entry", "particular"] as const;
export type ClassRegime = (typeof CLASS_REGIMES)[number];
export const REGIME_LABELS: Record<ClassRegime, string> = {
  regular: "Turma regular",
  open_entry: "Open-entry",
  particular: "Particular",
};
export const REGIME_HINTS: Record<ClassRegime, string> = {
  regular: "O aluno pertence à turma e entra em todas as aulas dela.",
  open_entry: "Ninguém fica preso à turma: as vagas ficam abertas e o aluno reserva aula a aula, no nível dele.",
  particular: "Turma de uma vaga, criada na alocação da matrícula.",
};

/** Uma aula open-entry com vaga, do ponto de vista de uma matrícula. */
export type OpenSlot = {
  id: string;
  startsAt: string;
  endsAt: string;
  className: string;
  moduleName: string | null;
  teacherName: string | null;
  roomName: string | null;
  modality: Modality;
  capacity: number;
  taken: number;
  seatsLeft: number;
  full: boolean;
  mine: boolean;
};

export type ClassGroup = {
  id: string;
  courseId: string;
  moduleId: string | null;
  name: string;
  teacherId: string | null;
  roomId: string | null;
  modality: Modality;
  regime: ClassRegime;
  capacity: number;
  individual: boolean;
  startsOn: string;
  endsOn: string;
  deactivatedAt: string | null;
  courseName: string;
  courseColor: string;
  courseType: string;
  moduleName: string | null;
  teacherName: string | null;
  roomName: string | null;
  schedules: Schedule[];
  enrolled: number;
  teacherRateCents: number | null;
};

export const LESSON_STATE_LABELS = {
  agendada: "Agendada",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  nao_finalizada: "Não finalizada",
  cancelada: "Cancelada",
} as const;
export type LessonState = keyof typeof LESSON_STATE_LABELS;

export type Lesson = {
  id: string;
  classGroupId: string;
  courseId: string;
  moduleId: string | null;
  startsAt: string;
  endsAt: string;
  teacherId: string | null;
  originalTeacherId: string | null;
  roomId: string | null;
  state: LessonState;
  cancelReason: string | null;
  className: string;
  individual: boolean;
  capacity: number;
  modality: Modality;
  courseName: string;
  courseColor: string;
  moduleName: string | null;
  teacherName: string | null;
  originalTeacherName: string | null;
  roomName: string | null;
  roomLink: string | null;
  enrolled: number;
  present: number;
  absent: number;
  flags: { semProfessor: boolean; semAlunos: boolean; substituida: boolean };
  rateOverrideCents: number | null;
  rateOverrideReason: string | null;
  supportReason: SupportReason | null;
  supportDetail: string | null;
  myStatus?: AttendanceStatus | null;
  cancelledInTime?: boolean | null;
};

export type AttendanceStatus = "inscrito" | "cancelou" | "presente" | "falta";
export type RosterEntry = {
  id: string;
  enrollmentId: string;
  studentId: string;
  studentName: string;
  status: AttendanceStatus;
  cancelledInTime: boolean | null;
  balance: number;
};

/* ------------------------------------------------------ matrícula e financeiro */

export type Enrollment = {
  id: string;
  studentId: string;
  courseId: string;
  regime: ClassRegime;
  /** Vazia no open-entry: a matrícula não fica presa a turma nenhuma. */
  classGroupId: string | null;
  moduleId: string | null;
  modality: Modality;
  packageLessons: number;
  startsOn: string;
  endsOn: string;
  endedAt: string | null;
  studentName: string;
  studentStatus: StudentStatus;
  courseName: string;
  courseColor: string;
  className: string | null;
  moduleName: string | null;
  /** Paga antes do nivelamento: ainda sem turma nem nível (DOMINIO.md §7.5.1). */
  levelPending: boolean;
  balance: number;
  used: number;
  granted: number;
  usage: number;
};

export const CREDIT_KIND_LABELS: Record<string, string> = {
  contratacao: "Contratação",
  renovacao: "Renovação",
  promocional: "Crédito promocional",
  devolucao: "Devolução",
  presenca: "Presença",
  falta: "Falta",
  cancelamento_tardio: "Cancelamento fora do prazo",
  expiracao: "Expiração",
  ajuste: "Ajuste manual",
  estorno: "Estorno",
};

export type CreditEntry = {
  entry: { id: string; kind: string; amount: number; justification: string | null; createdAt: string; lessonId: string | null };
  lessonStartsAt: string | null;
};

export const INSTALLMENT_STATUS_LABELS = { a_vencer: "A vencer", vencida: "Vencida", paga: "Paga", cancelada: "Cancelada" } as const;
export type InstallmentStatus = keyof typeof INSTALLMENT_STATUS_LABELS;

export type Installment = {
  id: string;
  contractId: string;
  number: number;
  dueDate: string;
  amountCents: number;
  cancelledAt: string | null;
  paidCents: number;
  status: InstallmentStatus;
  daysLate: number;
  installmentsCount: number;
  enrollmentId: string;
  studentId: string;
  studentName: string;
  studentStatus: StudentStatus;
  courseName: string;
  lastPaidOn: string | null;
};

export const PAYMENT_METHOD_LABELS = {
  pix: "Pix",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  boleto: "Boleto",
  transferencia: "Transferência",
  dinheiro: "Dinheiro",
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHOD_LABELS;

export type Payment = { id: string; amountCents: number; method: PaymentMethod; paidOn: string; reversalOfId: string | null; justification: string | null; createdAt: string };

export type FinanceSummary = {
  month: string;
  recognizedCents: number;
  concludedLessons: number;
  receivedCents: number;
  dueThisMonthCents: number;
  dueThisMonthOpenCents: number;
  overdueCents: number;
  overdueCount: number;
  overdueStudents: number;
  portfolioCents: number;
  payrollCostCents: number;
  payrollStatus: MonthStatus;
  marginCents: number;
};

export const SUPPORT_REASON_LABELS = {
  pedagogico: "Pedagógico: conteúdo ou turma",
  tecnico: "Técnico: plataforma, sala ou material",
  comportamento: "Comportamento do aluno",
  substituicao_parcial: "Substituição parcial durante a aula",
  outro: "Outro",
} as const;
export type SupportReason = keyof typeof SUPPORT_REASON_LABELS;

export type PayrollSituation = "paga" | "descontada" | "pendente" | "fora";
export type PayrollLesson = {
  lessonId: string;
  startsAt: string;
  className: string;
  courseName: string;
  state: LessonState;
  situation: PayrollSituation;
  valueCents: number;
  minutes: number;
  individual: boolean;
  overridden: boolean;
  supportReason: SupportReason | null;
  substitute: boolean;
  present: number;
  absent: number;
};
export type PayrollLine = {
  teacherId: string;
  teacherName: string;
  paidLessons: number;
  discountedLessons: number;
  pendingLessons: number;
  minutes: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  lessons: PayrollLesson[];
  lineId?: string;
  paidOn?: string | null;
};
export type MonthStatus = "em_andamento" | "travada" | "pronta" | "fechada";
export type Payroll = {
  month: string;
  status: MonthStatus;
  period: { id: string; closedAt: string; netCents: number } | null;
  lines: PayrollLine[];
  totals: Omit<PayrollLine, "teacherId" | "teacherName" | "lessons">;
};
export type PayrollPeriod = { id: string; month: string; closedAt: string; netCents: number; lessons: number; reopenedAt: string | null; reopenJustification: string | null };

export type Lead = {
  id: string;
  /** Card do fluxo de entrada do aluno, se já começou. */
  entry: { cardId: string; stage: string } | null;
  /** A pessoa nasce na captação e o id acompanha até depois de virar aluno. */
  personId: string;
  name: string;
  email: string | null;
  phone: string | null;
  cpf: string | null;
  origin: string;
  campaign: string | null;
  courseId: string | null;
  courseName: string | null;
  stage: "captado" | "contato" | "nivelamento" | "proposta" | "matriculado" | "perdido";
  lostReason: string | null;
  temperature: "frio" | "morno" | "quente" | null;
  nextAction: string | null;
  nextActionOn: string | null;
  studentId: string | null;
  daysInStage: number;
  stalled: boolean;
};

export type WorkflowCard = {
  id: string;
  flow: string;
  stage: string;
  title: string;
  data: Record<string, unknown>;
  stageChangedAt: string;
  createdAt: string;
  /** Quem vê sem operar acompanha o card: já passou por ele (DOMINIO.md §7.5). */
  canOperate?: boolean;
};
export type WorkflowTransition = { id: string; fromStage: string | null; toStage: string; note: string | null; createdAt: string };
export type FlowOptions = {
  lessons?: { id: string; startsAt: string; endsAt?: string; className: string; courseId: string; moduleId: string | null; teacherId: string | null }[];
  enrollments?: { id: string; studentName: string; className: string; courseId: string; endsOn: string }[];
  absences?: { id: string; studentName: string; startsAt: string; className: string; courseId: string }[];
  students?: { id: string; name: string; cents?: number }[];
  leads?: { id: string; name: string; cpf: string | null; email: string | null; courseId: string | null; busy: boolean }[];
  courses?: { id: string; name: string }[];
  modules?: { id: string; name: string; courseId: string }[];
  evaluators?: { id: string; name: string }[];
  classGroups?: { id: string; name: string; courseId: string; moduleId: string | null }[];
  lostReasons?: string[];
};

/* ------------------------------------------------------ agenda geral e eventos */

export type AgendaItemType = "aula" | "reuniao" | "evento" | "nivelamento";
export const AGENDA_TYPE_LABELS: Record<AgendaItemType, string> = { aula: "Aula", reuniao: "Reunião", evento: "Evento", nivelamento: "Nivelamento" };
export type AgendaItem = {
  type: AgendaItemType;
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  state: string;
  cancelled: boolean;
  color: string | null;
  detail: string | null;
  seatsLeft?: number;
};
export type AgendaFilters = {
  from: string;
  to: string;
  type?: string;
  teacherId?: string;
  roomId?: string;
  classGroupId?: string;
  courseId?: string;
  moduleId?: string;
  personId?: string;
  openSlots?: string;
};
export type EventKind = Exclude<AgendaItemType, "aula">;
export type EventState = "agendado" | "realizado" | "nao_compareceu" | "cancelado";
export const EVENT_STATE_LABELS: Record<EventState, string> = { agendado: "Agendado", realizado: "Realizado", nao_compareceu: "Não compareceu", cancelado: "Cancelado" };
export type AgendaEvent = {
  id: string;
  kind: EventKind;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  notes: string | null;
  state: EventState;
  cancelReason: string | null;
  evaluatedPersonId: string | null;
  evaluatorPersonId: string | null;
  courseId: string | null;
  suggestedModuleId: string | null;
  resultNotes: string | null;
  createdBy: string | null;
  evaluatedName: string | null;
  evaluatorName: string | null;
  courseName: string | null;
  suggestedModuleName: string | null;
};
export type EventInput = {
  kind: EventKind;
  title: string;
  /** "AAAA-MM-DDTHH:MM" na hora da escola. */
  startsAt: string;
  endsAt: string;
  location?: string | null;
  notes?: string | null;
  participantIds?: string[];
  evaluatedPersonId?: string | null;
  evaluatorPersonId?: string | null;
  courseId?: string | null;
  force?: boolean;
};
export type AgendaPerson = { id: string; name: string; roles: string[]; canEvaluate: boolean };
export type RenewalItem = { enrollmentId: string; endsOn: string; studentId: string; studentName: string; className: string; courseName: string; balance: number; urgent: boolean };

export type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  profileType: "admin" | "colaborador" | "prestador" | "aluno";
  level: number;
  areas: Record<string, "total" | "restrito">;
  personName: string | null;
  status: "ativo" | "bloqueado";
  lastSeenAt: string | null;
};
export type Invite = { id: string; email: string; profileType: Member["profileType"]; level: number; areas: Record<string, string>; personName: string | null; expiresAt: string; expired: boolean };
export type MyArea = {
  student: { id: string; status: StudentStatus; name: string; email: string | null };
  enrollments: Omit<Enrollment, "studentStatus">[];
  installments: Installment[];
  lessons: { id: string; startsAt: string; endsAt: string; state: LessonState; className: string; courseName: string; courseColor: string; teacherName: string | null; roomName: string | null; roomLink: string | null; enrollmentId?: string; myStatus?: AttendanceStatus; cancelledInTime?: boolean | null }[];
  materials: { id: string; title: string; url: string; notes: string | null; courseName: string; moduleName: string | null; deliveredAt: string }[];
};

/** Material do aluno (DOMINIO.md §4.5): link por curso e, opcionalmente, por nível. */
export type Material = {
  id: string;
  courseId: string;
  moduleId: string | null;
  title: string;
  url: string;
  notes: string | null;
  deactivatedAt: string | null;
  courseName: string;
  moduleName: string | null;
};
export type MaterialInput = { courseId: string; moduleId?: string | null; title: string; url: string; notes?: string | null };

export type Alert = { key: string; tone: "danger" | "warn" | "info"; title: string; detail: string; count: number; resource: string };

export type FinanceReport = {
  months: { month: string; receivedCents: number; recognizedCents: number; payrollCents: number; marginCents: number; lessons: number; students: number; payrollStatus: string }[];
};

type AttendanceCounts = { present: number; absent: number; cancelledInTime: number; cancelledLate: number; attendancePercent: number | null };

export type AttendanceReport = {
  range: { from: string; to: string };
  totals: AttendanceCounts & { lessons: number };
  groups: (AttendanceCounts & { classGroupId: string; className: string; courseName: string; courseColor: string; lessons: number })[];
  students: (AttendanceCounts & { studentId: string; studentName: string })[];
};

export type TeacherReport = {
  range: { from: string; to: string };
  weeks: number;
  teachers: {
    teacherId: string;
    teacherName: string;
    weeklyLimit: number | null;
    lessons: number;
    cancelled: number;
    unfinished: number;
    minutes: number;
    substitutions: number;
    support: number;
    hours: number;
    lessonsPerWeek: number;
    overLimit: boolean;
    costCents: number | null;
  }[];
};

export type EnrollmentReport = {
  months: { month: string; started: number; ended: number }[];
  byStatus: { status: string; n: number }[];
  byCourse: { courseName: string; courseColor: string; active: number; students: number }[];
};

export type AuditEntry = {
  id: string;
  createdAt: string;
  entity: string;
  entityId: string;
  action: string;
  actorName: string;
  actorEmail: string | null;
  justification: string | null;
  changed: string[];
  before: unknown;
  after: unknown;
};

export type GenerationResult = { created: number; existing: number; skipped: { date: string; startTime: string; reason: string }[]; conflicts: { date: string; startTime: string }[] };

/* ---------------------------------------------------------------------- rotas */

const t = (slug: string) => `/t/${slug}`;
const qs = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : "";
};

export const school = {
  teachers: (slug: string) => request<{ teachers: Teacher[] }>(`${t(slug)}/teachers`),
  teacher: (slug: string, id: string) => request<{ teacher: Teacher; classGroups: ClassGroup[]; lessons: Lesson[] }>(`${t(slug)}/teachers/${id}`),
  createTeacher: (slug: string, input: { person: PersonInput; weeklyLimit?: number; hourlyRateCents?: number | null; availability: number[]; courses: { courseId: string; moduleIds: string[] | null }[] }) =>
    request<{ teacher: Teacher }>(`${t(slug)}/teachers`, post(input)),
  updateTeacher: (slug: string, id: string, input: { person?: PersonInput; weeklyLimit?: number; hourlyRateCents?: number | null; availability?: number[]; courses?: { courseId: string; moduleIds: string[] | null }[] }) =>
    request<{ teacher: Teacher }>(`${t(slug)}/teachers/${id}`, patch(input)),
  setTeacherActive: (slug: string, id: string, active: boolean) => request(`${t(slug)}/teachers/${id}/${active ? "reactivate" : "deactivate"}`, post()),

  students: (slug: string, filters: { q?: string; status?: string } = {}) => request<{ students: StudentRow[] }>(`${t(slug)}/students${qs(filters)}`),
  student: (slug: string, id: string) =>
    request<{ student: { id: string; status: StudentStatus; previousStatus: StudentStatus | null; availability: number[]; person: Person; company: { id: string; name: string; model: CompanyModel } | null }; enrollments: Enrollment[]; installments: Installment[]; lessons: Lesson[] }>(
      `${t(slug)}/students/${id}`,
    ),
  createStudent: (slug: string, input: { person: PersonInput; availability?: number[] }) => request<{ student: { id: string } }>(`${t(slug)}/students`, post(input)),
  updateStudent: (slug: string, id: string, input: { person?: PersonInput; availability?: number[] }) => request(`${t(slug)}/students/${id}`, patch(input)),
  setStudentStatus: (slug: string, id: string, status: StudentStatus | "reativar") => request(`${t(slug)}/students/${id}/status`, post({ status })),

  rooms: (slug: string) => request<{ rooms: Room[] }>(`${t(slug)}/rooms`),
  createRoom: (slug: string, input: { name: string; kind: Room["kind"]; link?: string | null; capacity?: number | null }) => request<{ room: Room }>(`${t(slug)}/rooms`, post(input)),

  classGroups: (slug: string, filters: { courseId?: string; teacherId?: string } = {}) => request<{ classGroups: ClassGroup[] }>(`${t(slug)}/class-groups${qs(filters)}`),
  classGroup: (slug: string, id: string) => request<{ classGroup: ClassGroup; enrollments: Enrollment[]; lessons: Lesson[] }>(`${t(slug)}/class-groups/${id}`),
  createClassGroup: (
    slug: string,
    input: { courseId: string; moduleId?: string | null; name: string; teacherId?: string | null; roomId?: string | null; modality?: Modality; regime?: ClassRegime; capacity?: number; startsOn: string; endsOn: string; schedules: Schedule[]; generateWeeks?: number },
  ) => request<{ classGroup: ClassGroup; warnings: string[]; generation: GenerationResult | null }>(`${t(slug)}/class-groups`, post(input)),
  generateLessons: (slug: string, id: string, range: { from: string; to: string }) => request<{ generation: GenerationResult }>(`${t(slug)}/class-groups/${id}/generate`, post(range)),

  lessons: (slug: string, filters: { from: string; to: string; teacherId?: string; courseId?: string; classGroupId?: string; studentId?: string }) =>
    request<{ lessons: Lesson[] }>(`${t(slug)}/lessons${qs(filters)}`),
  lesson: (slug: string, id: string) => request<{ lesson: Lesson; roster: RosterEntry[] }>(`${t(slug)}/lessons/${id}`),
  setAttendance: (slug: string, id: string, entries: { enrollmentId: string; status: "presente" | "falta" }[]) => request(`${t(slug)}/lessons/${id}/attendance`, post({ entries })),
  startLesson: (slug: string, id: string) => request(`${t(slug)}/lessons/${id}/start`, post()),
  concludeLesson: (slug: string, id: string) => request(`${t(slug)}/lessons/${id}/conclude`, post()),
  cancelLesson: (slug: string, id: string, reason: string, undo = false) => request(`${t(slug)}/lessons/${id}/cancel`, post({ reason, undo })),
  changeLessonTeacher: (slug: string, id: string, teacherId: string) => request(`${t(slug)}/lessons/${id}/teacher`, post({ teacherId })),
  cancelStudentLesson: (slug: string, id: string, enrollmentId: string, undo = false) => request(`${t(slug)}/lessons/${id}/students/${enrollmentId}/cancel`, post({ undo })),

  holidays: (slug: string, year: number) => request<{ holidays: { id: string; date: string; name: string; kind: string }[] }>(`${t(slug)}/holidays?year=${year}`),
  importHolidays: (slug: string, year: number) => request(`${t(slug)}/holidays/import`, post({ year })),
  addRecess: (slug: string, input: { from: string; to: string; name: string }) => request(`${t(slug)}/holidays/recess`, post(input)),

  enrollments: (slug: string, filters: { studentId?: string; classGroupId?: string; active?: "1" } = {}) => request<{ enrollments: Enrollment[] }>(`${t(slug)}/enrollments${qs(filters)}`),
  createEnrollment: (
    slug: string,
    input: {
      studentId: string;
      /** Fora do open-entry, a turma é obrigatória. */
      classGroupId?: string;
      regime?: ClassRegime;
      /** Open-entry: curso e nível, já que não há turma. */
      courseId?: string;
      moduleId?: string;
      packageLessons?: number;
      startsOn?: string;
      modality?: Modality;
      contract?: false | { discountCents?: number; installments?: number; dueDay?: number };
    },
  ) => request<{ enrollment: Enrollment }>(`${t(slug)}/enrollments`, post(input)),

  /** Vagas open-entry que esta matrícula pode pegar (mesmo curso, mesmo nível). */
  openSlots: (slug: string, enrollmentId: string, filters: { from?: string; to?: string } = {}) =>
    request<{ slots: OpenSlot[] }>(`${t(slug)}/enrollments/${enrollmentId}/vagas${qs(filters)}`),
  reserveSlot: (slug: string, enrollmentId: string, lessonId: string) =>
    request<{ reserva: { id: string } }>(`${t(slug)}/enrollments/${enrollmentId}/vagas/${lessonId}`, post()),
  endEnrollment: (slug: string, id: string) => request(`${t(slug)}/enrollments/${id}/end`, post()),
  reactivateEnrollment: (slug: string, id: string) => request(`${t(slug)}/enrollments/${id}/reactivate`, post()),
  transferEnrollment: (slug: string, id: string, classGroupId: string) => request(`${t(slug)}/enrollments/${id}/transfer`, post({ classGroupId })),
  credits: (slug: string, id: string) => request<{ entries: CreditEntry[] }>(`${t(slug)}/enrollments/${id}/credits`),
  addCredits: (slug: string, id: string, input: { kind: "ajuste" | "promocional" | "renovacao"; amount: number; justification?: string }) =>
    request(`${t(slug)}/enrollments/${id}/credits`, post(input)),

  financeSummary: (slug: string, month?: string) => request<{ summary: FinanceSummary }>(`${t(slug)}/finance/summary${qs({ month })}`),
  installments: (slug: string, filters: { status?: InstallmentStatus; studentId?: string; from?: string; to?: string } = {}) =>
    request<{ installments: Installment[] }>(`${t(slug)}/installments${qs(filters)}`),
  payments: (slug: string, installmentId: string) => request<{ payments: Payment[] }>(`${t(slug)}/installments/${installmentId}/payments`),
  registerPayment: (slug: string, installmentId: string, input: { method: PaymentMethod; amountCents?: number; paidOn?: string }) =>
    request(`${t(slug)}/installments/${installmentId}/payments`, post(input)),
  reversePayment: (slug: string, paymentId: string, justification: string) => request(`${t(slug)}/payments/${paymentId}/reverse`, post({ justification })),

  companies: (slug: string) => request<{ companies: Company[] }>(`${t(slug)}/companies`),
  company: (slug: string, id: string) =>
    request<{ company: Company; students: { id: string; status: StudentStatus; name: string; email: string | null; activeEnrollments: number; used: number }[]; charges: CompanyCharge[] }>(`${t(slug)}/companies/${id}`),
  createCompany: (slug: string, input: CompanyInput) => request<{ company: Company }>(`${t(slug)}/companies`, post(input)),
  updateCompany: (slug: string, id: string, input: CompanyInput) => request<{ company: Company }>(`${t(slug)}/companies/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  renewCompany: (slug: string, id: string, input: { endsOn: string; licenses?: number; addLessons?: number }) => request(`${t(slug)}/companies/${id}/renew`, post(input)),
  linkStudent: (slug: string, id: string, studentId: string) => request<{ warning: string | null }>(`${t(slug)}/companies/${id}/students`, post({ studentId })),
  unlinkStudent: (slug: string, id: string, studentId: string) => request(`${t(slug)}/companies/${id}/students/${studentId}`, { method: "DELETE" }),
  generateCharge: (slug: string, id: string, month: string) => request(`${t(slug)}/companies/${id}/charges`, post({ month })),
  payCharge: (slug: string, chargeId: string, method: PaymentMethod) => request(`${t(slug)}/company-charges/${chargeId}/pay`, post({ method })),
  recordReport: (slug: string, id: string) => request(`${t(slug)}/companies/${id}/report`, post()),

  leads: (slug: string) => request<{ leads: Lead[] }>(`${t(slug)}/leads`),
  createLead: (slug: string, input: Partial<Lead> & { name: string; origin: string }) => request<{ lead: Lead }>(`${t(slug)}/leads`, post(input)),
  moveLead: (slug: string, id: string, body: { to: "avancar" } | { to: "perdido"; reason: string } | { to: "reabrir" }) => request<{ lead: Lead }>(`${t(slug)}/leads/${id}/move`, post(body)),
  convertLead: (slug: string, id: string) => request<{ lead: Lead }>(`${t(slug)}/leads/${id}/convert`, post()),

  flows: (slug: string) => request<{ openCounts: Record<string, number>; stageAreas: Record<string, Record<string, string>> }>(`${t(slug)}/flows`),
  saveFlowSettings: (slug: string, input: { entryEnrollmentArea: string }) => request(`${t(slug)}/settings/flows`, patch(input)),
  cards: (slug: string, flow: string) => request<{ cards: WorkflowCard[] }>(`${t(slug)}/flows/${flow}/cards`),
  flowOptions: (slug: string, flow: string) => request<{ options: FlowOptions }>(`${t(slug)}/flows/${flow}/options`),
  renewalQueue: (slug: string) => request<{ queue: RenewalItem[] }>(`${t(slug)}/renewal-queue`),
  createCard: (slug: string, flow: string, data: Record<string, unknown>) => request<{ card: WorkflowCard }>(`${t(slug)}/flows/${flow}/cards`, post({ data })),
  card: (slug: string, id: string) => request<{ card: WorkflowCard; transitions: WorkflowTransition[]; canOperate: boolean }>(`${t(slug)}/cards/${id}`),
  updateCard: (slug: string, id: string, data: Record<string, unknown>) => request<{ card: WorkflowCard }>(`${t(slug)}/cards/${id}`, patch({ data })),
  moveCard: (slug: string, id: string, to: string, note?: string) => request<{ card: WorkflowCard }>(`${t(slug)}/cards/${id}/move`, post({ to, note })),
  entryNoShow: (slug: string, id: string) => request<{ card: WorkflowCard }>(`${t(slug)}/cards/${id}/no-show`, post()),
  entryNoSlot: (slug: string, id: string, nextPossibleOn: string) => request<{ card: WorkflowCard }>(`${t(slug)}/cards/${id}/no-slot`, post({ nextPossibleOn })),

  agenda: (slug: string, filters: AgendaFilters) => request<{ items: AgendaItem[] }>(`${t(slug)}/agenda${qs(filters)}`),
  agendaPeople: (slug: string) => request<{ people: AgendaPerson[] }>(`${t(slug)}/agenda/people`),
  event: (slug: string, id: string) =>
    request<{ event: AgendaEvent; participants: { id: string; name: string }[]; can: { edit: boolean; cancel: boolean; record: boolean } }>(`${t(slug)}/events/${id}`),
  createEvent: (slug: string, input: EventInput) => request<{ event: AgendaEvent }>(`${t(slug)}/events`, post(input)),
  updateEvent: (slug: string, id: string, input: EventInput) => request<{ event: AgendaEvent }>(`${t(slug)}/events/${id}`, patch(input)),
  cancelEvent: (slug: string, id: string, reason: string) => request<{ event: AgendaEvent }>(`${t(slug)}/events/${id}/cancel`, post({ reason })),
  eventResult: (slug: string, id: string, input: { suggestedModuleId: string; resultNotes?: string | null }) => request<{ event: AgendaEvent }>(`${t(slug)}/events/${id}/result`, post(input)),
  eventNoShow: (slug: string, id: string) => request<{ event: AgendaEvent }>(`${t(slug)}/events/${id}/no-show`, post()),

  users: (slug: string) => request<{ members: Member[]; invites: Invite[] }>(`${t(slug)}/users`),
  invite: (slug: string, input: { email?: string | null; personId?: string | null; profileType: string; level: number; areas: Record<string, string> }) =>
    request<{ link: string }>(`${t(slug)}/invitations`, post(input)),
  revokeInvite: (slug: string, id: string) => request(`${t(slug)}/invitations/${id}`, { method: "DELETE" }),
  updateMember: (slug: string, id: string, input: { profileType: string; level: number; areas: Record<string, string> }) => request(`${t(slug)}/users/${id}`, patch(input)),
  setMemberBlocked: (slug: string, id: string, blocked: boolean) => request(`${t(slug)}/users/${id}/${blocked ? "block" : "unblock"}`, post()),
  myArea: (slug: string) => request<MyArea>(`${t(slug)}/minha-area`),
  materials: (slug: string) => request<{ materials: Material[] }>(`${t(slug)}/materials`),
  createMaterial: (slug: string, input: MaterialInput) => request<{ material: Material }>(`${t(slug)}/materials`, post(input)),
  updateMaterial: (slug: string, id: string, input: MaterialInput) => request<{ material: Material }>(`${t(slug)}/materials/${id}`, patch(input)),
  setMaterialActive: (slug: string, id: string, active: boolean) => request(`${t(slug)}/materials/${id}/${active ? "reactivate" : "deactivate"}`, post()),
  myLesson: (slug: string, lessonId: string, action: "cancelar" | "reagendar") => request(`${t(slug)}/minha-area/aulas/${lessonId}/${action}`, post()),

  /** Vagas abertas do próprio aluno, agrupadas por matrícula open-entry. */
  myOpenSlots: (slug: string) =>
    request<{
      matriculas: { enrollmentId: string; courseName: string; moduleName: string | null; balance: number; available: number; slots: OpenSlot[] }[];
    }>(`${t(slug)}/minha-area/vagas`),
  reserveMySlot: (slug: string, enrollmentId: string, lessonId: string) =>
    request<{ reserva: { id: string } }>(`${t(slug)}/minha-area/vagas/${enrollmentId}/${lessonId}`, post()),

  alerts: (slug: string) => request<{ alerts: Alert[] }>(`${t(slug)}/alerts`),

  reportFinance: (slug: string, months: number) => request<FinanceReport>(`${t(slug)}/reports/financeiro?months=${months}`),

  reportAttendance: (slug: string, range: { from: string; to: string }) => request<AttendanceReport>(`${t(slug)}/reports/frequencia${qs(range)}`),

  reportTeachers: (slug: string, range: { from: string; to: string }) => request<TeacherReport>(`${t(slug)}/reports/professores${qs(range)}`),

  reportEnrollments: (slug: string, months: number) => request<EnrollmentReport>(`${t(slug)}/reports/matriculas?months=${months}`),

  audit: (slug: string, filters: { entity?: string; page?: number }) =>
    request<{ entries: AuditEntry[]; hasMore: boolean; entities: { entity: string; n: number }[] }>(
      `${t(slug)}/audit${qs({ entity: filters.entity, page: filters.page ? String(filters.page) : undefined })}`,
    ),

  payroll: (slug: string, month: string) => request<{ payroll: Payroll; periods: PayrollPeriod[] }>(`${t(slug)}/payroll?month=${month}`),
  closeMonth: (slug: string, month: string) => request(`${t(slug)}/payroll/${month}/close`, post()),
  reopenMonth: (slug: string, month: string, justification: string) => request(`${t(slug)}/payroll/${month}/reopen`, post({ justification })),
  markLinePaid: (slug: string, lineId: string, paidOn: string) => request(`${t(slug)}/payroll/lines/${lineId}/paid`, post({ paidOn })),
  requestSupport: (slug: string, lessonId: string, reason: SupportReason | null, detail?: string) => request(`${t(slug)}/lessons/${lessonId}/support`, post({ reason, detail })),
  overrideRate: (slug: string, lessonId: string, cents: number | null, reason = "") => request(`${t(slug)}/lessons/${lessonId}/rate`, post({ cents, reason })),
  setTeacherRate: (slug: string, classGroupId: string, cents: number | null) => request(`${t(slug)}/class-groups/${classGroupId}/teacher-rate`, post({ cents })),
};
