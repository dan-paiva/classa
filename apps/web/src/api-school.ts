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

export type ClassGroup = {
  id: string;
  courseId: string;
  moduleId: string | null;
  name: string;
  teacherId: string | null;
  roomId: string | null;
  modality: Modality;
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
  classGroupId: string;
  modality: Modality;
  packageLessons: number;
  startsOn: string;
  endsOn: string;
  endedAt: string | null;
  studentName: string;
  studentStatus: StudentStatus;
  courseName: string;
  courseColor: string;
  className: string;
  moduleName: string | null;
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
    input: { courseId: string; moduleId?: string | null; name: string; teacherId?: string | null; roomId?: string | null; modality?: Modality; capacity?: number; startsOn: string; endsOn: string; schedules: Schedule[]; generateWeeks?: number },
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
    input: { studentId: string; classGroupId: string; packageLessons?: number; startsOn?: string; modality?: Modality; contract?: false | { discountCents?: number; installments?: number; dueDay?: number } },
  ) => request<{ enrollment: Enrollment }>(`${t(slug)}/enrollments`, post(input)),
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

  payroll: (slug: string, month: string) => request<{ payroll: Payroll; periods: PayrollPeriod[] }>(`${t(slug)}/payroll?month=${month}`),
  closeMonth: (slug: string, month: string) => request(`${t(slug)}/payroll/${month}/close`, post()),
  reopenMonth: (slug: string, month: string, justification: string) => request(`${t(slug)}/payroll/${month}/reopen`, post({ justification })),
  markLinePaid: (slug: string, lineId: string, paidOn: string) => request(`${t(slug)}/payroll/lines/${lineId}/paid`, post({ paidOn })),
  requestSupport: (slug: string, lessonId: string, reason: SupportReason | null, detail?: string) => request(`${t(slug)}/lessons/${lessonId}/support`, post({ reason, detail })),
  overrideRate: (slug: string, lessonId: string, cents: number | null, reason = "") => request(`${t(slug)}/lessons/${lessonId}/rate`, post({ cents, reason })),
  setTeacherRate: (slug: string, classGroupId: string, cents: number | null) => request(`${t(slug)}/class-groups/${classGroupId}/teacher-rate`, post({ cents })),
};
