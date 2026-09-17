import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const tstz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ---------------------------------------------------------------------------
 * Autenticação (Better Auth). As chaves em camelCase são os nomes de campo que
 * a biblioteca espera; as colunas ficam em snake_case. Ids são texto porque
 * quem gera é o Better Auth (configurado para UUIDv7 em apps/api/src/auth.ts).
 * ------------------------------------------------------------------------- */

export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_account_user_idx").on(t.userId)],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

/* ---------------------------------------------------------------------------
 * Escolas e vínculo de usuários
 * ------------------------------------------------------------------------- */

export type OperatingDay = { weekday: number; open: string; close: string } | { weekday: number; closed: true };

export type TenantSettings = {
  /** weekday: 0 = domingo … 6 = sábado. Horas em "HH:MM". */
  operatingHours: OperatingDay[];
  policies: {
    /** Falta sem aviso gasta a aula (decisão D2). */
    noShowDebits: boolean;
    /** Cancelar depois da antecedência mínima do curso gasta a aula (decisão D2). */
    lateCancelDebits: boolean;
    /** Parcela vencida há mais que isso deixa o aluno inadimplente (decisão D8). */
    delinquencyDays: number;
    installments: number;
    dueDay: number;
  };
};

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  operatingHours: [
    { weekday: 0, closed: true },
    { weekday: 1, open: "07:00", close: "22:00" },
    { weekday: 2, open: "07:00", close: "22:00" },
    { weekday: 3, open: "07:00", close: "22:00" },
    { weekday: 4, open: "07:00", close: "22:00" },
    { weekday: 5, open: "07:00", close: "22:00" },
    { weekday: 6, open: "08:00", close: "13:00" },
  ],
  policies: { noShowDebits: true, lateCancelDebits: true, delinquencyDays: 15, installments: 6, dueDay: 10 },
};

/** A escola. Toda tabela de negócio aponta para um tenant. */
export const tenant = pgTable("tenant", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  /** Horário de funcionamento e políticas da escola. Formato em `TenantSettings`. */
  settings: jsonb("settings").$type<TenantSettings>().notNull().default(DEFAULT_TENANT_SETTINGS),
  createdAt: createdAt(),
  deactivatedAt: tstz("deactivated_at"),
});

export const MEMBERSHIP_ROLES = ["admin"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/**
 * Quem acessa qual escola. Por enquanto só existe o papel admin; a matriz
 * completa (hierarquia × área × escopo) chega na fase de perfis.
 */
export const membership = pgTable(
  "membership",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id),
    role: text("role", { enum: MEMBERSHIP_ROLES }).notNull(),
    createdAt: createdAt(),
    deactivatedAt: tstz("deactivated_at"),
  },
  (t) => [unique("membership_tenant_user_uq").on(t.tenantId, t.userId), index("membership_user_idx").on(t.userId)],
);

export const AUDIT_ACTIONS = ["create", "update", "deactivate", "reactivate", "delete", "cancel", "import", "transition"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Histórico append-only de alterações. Nunca recebe UPDATE nem DELETE. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    /** Sem FK de propósito: a auditoria sobrevive mesmo se o usuário for removido. */
    actorId: text("actor_id"),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action", { enum: AUDIT_ACTIONS }).notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    justification: text("justification"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

/* ---------------------------------------------------------------------------
 * Acadêmico: cursos e módulos
 * ------------------------------------------------------------------------- */

export const COURSE_TYPES = ["grupo", "particular", "hibrido", "workshop", "turmas_dedicadas"] as const;
export type CourseType = (typeof COURSE_TYPES)[number];

export const MODALITIES = ["online", "presencial"] as const;
export type Modality = (typeof MODALITIES)[number];

export const course = pgTable(
  "course",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    type: text("type", { enum: COURSE_TYPES }).notNull(),
    color: text("color").notNull(),
    /** Alunos por aula. */
    capacity: integer("capacity").notNull(),
    lessonMinutes: integer("lesson_minutes").notNull(),
    /** Aulas incluídas no pacote de uma matrícula. */
    packageLessons: integer("package_lessons").notNull(),
    /** Horas de antecedência para o aluno cancelar sem perder a aula. */
    cancelNoticeHours: integer("cancel_notice_hours").notNull(),
    /** Valor de uma aula, em centavos. */
    lessonPriceCents: integer("lesson_price_cents").notNull(),
    modalities: text("modalities", { enum: MODALITIES }).array().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deactivatedAt: tstz("deactivated_at"),
  },
  (t) => [
    unique("course_tenant_name_uq").on(t.tenantId, t.name),
    check("course_capacity_positive", sql`${t.capacity} > 0`),
    check("course_lesson_minutes_positive", sql`${t.lessonMinutes} > 0`),
    check("course_package_lessons_positive", sql`${t.packageLessons} > 0`),
    check("course_cancel_notice_non_negative", sql`${t.cancelNoticeHours} >= 0`),
    check("course_price_non_negative", sql`${t.lessonPriceCents} >= 0`),
  ],
);

export const courseModule = pgTable(
  "course_module",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id),
    name: text("name").notNull(),
    color: text("color").notNull(),
    position: integer("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deactivatedAt: tstz("deactivated_at"),
  },
  (t) => [unique("course_module_course_name_uq").on(t.courseId, t.name), index("course_module_course_idx").on(t.courseId)],
);

/* ---------------------------------------------------------------------------
 * Pessoas: ficha única, professor e aluno
 * ------------------------------------------------------------------------- */

export const person = pgTable(
  "person",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    email: text("email"),
    /** Só dígitos. */
    cpf: text("cpf"),
    /** Só dígitos. */
    phone: text("phone"),
    birthDate: date("birth_date"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("person_tenant_email_uq").on(t.tenantId, sql`lower(${t.email})`).where(sql`${t.email} is not null`),
    uniqueIndex("person_tenant_cpf_uq").on(t.tenantId, t.cpf).where(sql`${t.cpf} is not null`),
    index("person_tenant_name_idx").on(t.tenantId, t.name),
  ],
);

/**
 * Disponibilidade semanal em horas cheias: cada valor é weekday * 100 + hora
 * (ex.: 118 = segunda às 18h). weekday 1..6, hora 7..21.
 */
const availability = () => smallint("availability").array().notNull().default(sql`'{}'::smallint[]`);

export const teacher = pgTable(
  "teacher",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    /** Aulas por semana; passar dele é só aviso. */
    weeklyLimit: integer("weekly_limit").notNull().default(24),
    hourlyRateCents: integer("hourly_rate_cents"),
    availability: availability(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deactivatedAt: tstz("deactivated_at"),
  },
  (t) => [unique("teacher_person_uq").on(t.personId), check("teacher_weekly_limit_positive", sql`${t.weeklyLimit} > 0`)],
);

/** Habilitação: professor pode dar aula no curso; `moduleIds` null = todos os módulos/turmas. */
export const teacherCourse = pgTable(
  "teacher_course",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id),
    moduleIds: uuid("module_ids").array(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teacherId, t.courseId] })],
);

export const STUDENT_STATUSES = ["ativo", "suspenso", "congelado", "inadimplente", "cancelado", "inativo"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const student = pgTable(
  "student",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    status: text("status", { enum: STUDENT_STATUSES }).notNull().default("ativo"),
    /** Situação antes de desativar ou cancelar, para reativar voltando a ela. */
    previousStatus: text("previous_status", { enum: STUDENT_STATUSES }),
    availability: availability(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("student_person_uq").on(t.personId), index("student_tenant_status_idx").on(t.tenantId, t.status)],
);

/* ---------------------------------------------------------------------------
 * Agenda: salas, turmas, horários, feriados e aulas
 * ------------------------------------------------------------------------- */

export const ROOM_KINDS = ["virtual", "presencial", "auditorio"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export const room = pgTable(
  "room",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    kind: text("kind", { enum: ROOM_KINDS }).notNull(),
    link: text("link"),
    capacity: integer("capacity"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deactivatedAt: tstz("deactivated_at"),
  },
  (t) => [unique("room_tenant_name_uq").on(t.tenantId, t.name)],
);

/** Turma: o que se repete toda semana e gera as aulas. Aula particular = turma individual de 1 vaga. */
export const classGroup = pgTable(
  "class_group",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id),
    moduleId: uuid("module_id").references(() => courseModule.id),
    name: text("name").notNull(),
    teacherId: uuid("teacher_id").references(() => teacher.id),
    roomId: uuid("room_id").references(() => room.id),
    modality: text("modality", { enum: MODALITIES }).notNull(),
    capacity: integer("capacity").notNull(),
    individual: boolean("individual").notNull().default(false),
    /** Aula particular: valor fixo pago ao professor por aula (os demais cursos usam valor hora × duração). */
    teacherRateCents: integer("teacher_rate_cents"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deactivatedAt: tstz("deactivated_at"),
  },
  (t) => [
    unique("class_group_course_name_uq").on(t.courseId, t.name),
    check("class_group_capacity_positive", sql`${t.capacity} > 0`),
    check("class_group_period", sql`${t.endsOn} >= ${t.startsOn}`),
    index("class_group_tenant_idx").on(t.tenantId),
  ],
);

export const classSchedule = pgTable(
  "class_schedule",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroup.id, { onDelete: "cascade" }),
    /** 1 = segunda … 6 = sábado. */
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
  },
  (t) => [
    unique("class_schedule_slot_uq").on(t.classGroupId, t.weekday, t.startTime),
    check("class_schedule_weekday", sql`${t.weekday} between 1 and 6`),
  ],
);

export const HOLIDAY_KINDS = ["nacional", "manual", "recesso"] as const;

export const holiday = pgTable(
  "holiday",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    date: date("date").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: HOLIDAY_KINDS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("holiday_tenant_date_uq").on(t.tenantId, t.date)],
);

export const LESSON_STATES = ["agendada", "em_andamento", "concluida", "nao_finalizada", "cancelada"] as const;

export const SUPPORT_REASONS = ["pedagogico", "tecnico", "comportamento", "substituicao_parcial", "outro"] as const;
export type SupportReason = (typeof SUPPORT_REASONS)[number];
export type LessonState = (typeof LESSON_STATES)[number];

export const lesson = pgTable(
  "lesson",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroup.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id),
    moduleId: uuid("module_id").references(() => courseModule.id),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    teacherId: uuid("teacher_id").references(() => teacher.id),
    /** Preenchido quando outro professor assumiu a aula. */
    originalTeacherId: uuid("original_teacher_id").references(() => teacher.id),
    roomId: uuid("room_id").references(() => room.id),
    state: text("state", { enum: LESSON_STATES }).notNull().default("agendada"),
    cancelReason: text("cancel_reason"),
    notes: text("notes"),
    /** Valor pago ao professor só nesta aula (aula particular), com motivo. */
    rateOverrideCents: integer("rate_override_cents"),
    rateOverrideReason: text("rate_override_reason"),
    /** Pedido de suporte do professor: a aula é descontada da folha. */
    supportReason: text("support_reason", { enum: SUPPORT_REASONS }),
    supportDetail: text("support_detail"),
    supportRequestedAt: tstz("support_requested_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("lesson_class_start_uq").on(t.classGroupId, t.startsAt),
    check("lesson_period", sql`${t.endsAt} > ${t.startsAt}`),
    index("lesson_tenant_starts_idx").on(t.tenantId, t.startsAt),
    index("lesson_teacher_starts_idx").on(t.teacherId, t.startsAt),
  ],
);

/* ---------------------------------------------------------------------------
 * Matrícula, extrato de créditos e inscrição nas aulas
 * ------------------------------------------------------------------------- */

export const enrollment = pgTable(
  "enrollment",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroup.id),
    modality: text("modality", { enum: MODALITIES }).notNull(),
    packageLessons: integer("package_lessons").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    endedAt: tstz("ended_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("enrollment_package_positive", sql`${t.packageLessons} > 0`),
    check("enrollment_period", sql`${t.endsOn} >= ${t.startsOn}`),
    index("enrollment_student_idx").on(t.studentId),
    index("enrollment_class_idx").on(t.classGroupId),
  ],
);

export const CREDIT_KINDS = [
  "contratacao",
  "renovacao",
  "promocional",
  "devolucao",
  "presenca",
  "falta",
  "cancelamento_tardio",
  "expiracao",
  "ajuste",
  "estorno",
] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

/** Extrato de créditos: saldo da matrícula = soma de `amount`. Lançamentos nunca mudam. */
export const creditEntry = pgTable(
  "credit_entry",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollment.id),
    kind: text("kind", { enum: CREDIT_KINDS }).notNull(),
    amount: integer("amount").notNull(),
    lessonId: uuid("lesson_id").references(() => lesson.id),
    reversalOfId: uuid("reversal_of_id"),
    justification: text("justification"),
    actorId: text("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [check("credit_entry_amount_not_zero", sql`${t.amount} <> 0`), index("credit_entry_enrollment_idx").on(t.enrollmentId)],
);

export const ATTENDANCE_STATUSES = ["inscrito", "cancelou", "presente", "falta"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const lessonStudent = pgTable(
  "lesson_student",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lesson.id),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollment.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id),
    status: text("status", { enum: ATTENDANCE_STATUSES }).notNull().default("inscrito"),
    /** Cancelou dentro da antecedência mínima do curso (não gasta aula). */
    cancelledInTime: boolean("cancelled_in_time"),
    updatedAt: updatedAt(),
  },
  (t) => [unique("lesson_student_uq").on(t.lessonId, t.enrollmentId), index("lesson_student_student_idx").on(t.studentId)],
);

/* ---------------------------------------------------------------------------
 * Financeiro: contrato por matrícula, parcelas e pagamentos
 * ------------------------------------------------------------------------- */

/** Emitido e gravado: mudar o valor da aula depois não altera contrato nem parcelas. */
export const contract = pgTable(
  "contract",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollment.id),
    kind: text("kind", { enum: ["matricula", "renovacao"] }).notNull().default("matricula"),
    lessons: integer("lessons").notNull(),
    lessonPriceCents: integer("lesson_price_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    installmentsCount: integer("installments_count").notNull(),
    dueDay: integer("due_day").notNull(),
    issuedOn: date("issued_on").notNull(),
    cancelledAt: tstz("cancelled_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("contract_total_non_negative", sql`${t.totalCents} >= 0`),
    check("contract_installments_positive", sql`${t.installmentsCount} between 1 and 24`),
    check("contract_due_day", sql`${t.dueDay} between 1 and 28`),
    index("contract_enrollment_idx").on(t.enrollmentId),
  ],
);

export const installment = pgTable(
  "installment",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contract.id),
    number: integer("number").notNull(),
    dueDate: date("due_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    cancelledAt: tstz("cancelled_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("installment_contract_number_uq").on(t.contractId, t.number),
    check("installment_amount_non_negative", sql`${t.amountCents} >= 0`),
    index("installment_tenant_due_idx").on(t.tenantId, t.dueDate),
  ],
);

export const PAYMENT_METHODS = ["pix", "cartao_credito", "cartao_debito", "boleto", "transferencia", "dinheiro"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Pagamento nunca é apagado: estorno é outro registro, negativo, apontando para o original. */
export const payment = pgTable(
  "payment",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    installmentId: uuid("installment_id")
      .notNull()
      .references(() => installment.id),
    amountCents: integer("amount_cents").notNull(),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    paidOn: date("paid_on").notNull(),
    reversalOfId: uuid("reversal_of_id"),
    justification: text("justification"),
    actorId: text("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [check("payment_amount_not_zero", sql`${t.amountCents} <> 0`), index("payment_installment_idx").on(t.installmentId)],
);

/* ---------------------------------------------------------------------------
 * Folha de professores
 * ------------------------------------------------------------------------- */

/**
 * Um registro por fechamento. Reabrir marca `reopenedAt` (com justificativa) e mantém as
 * linhas; fechar de novo cria outro registro. A competência vigente é o último sem reabertura.
 */
export const payrollPeriod = pgTable(
  "payroll_period",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    /** "AAAA-MM" */
    month: text("month").notNull(),
    closedAt: tstz("closed_at").notNull(),
    closedBy: text("closed_by"),
    grossCents: integer("gross_cents").notNull(),
    discountCents: integer("discount_cents").notNull(),
    netCents: integer("net_cents").notNull(),
    lessons: integer("lessons").notNull(),
    reopenedAt: tstz("reopened_at"),
    reopenedBy: text("reopened_by"),
    reopenJustification: text("reopen_justification"),
  },
  (t) => [
    index("payroll_period_tenant_month_idx").on(t.tenantId, t.month),
    uniqueIndex("payroll_period_open_uq").on(t.tenantId, t.month).where(sql`${t.reopenedAt} is null`),
  ],
);

export const payrollLine = pgTable(
  "payroll_line",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payrollPeriod.id),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    paidLessons: integer("paid_lessons").notNull(),
    discountedLessons: integer("discounted_lessons").notNull(),
    minutes: integer("minutes").notNull(),
    grossCents: integer("gross_cents").notNull(),
    discountCents: integer("discount_cents").notNull(),
    netCents: integer("net_cents").notNull(),
    /** Aulas que compõem a linha, gravadas no fechamento: [{ lessonId, valueCents, situation }]. */
    details: jsonb("details").notNull(),
    paidOn: date("paid_on"),
    paidBy: text("paid_by"),
  },
  (t) => [unique("payroll_line_period_teacher_uq").on(t.periodId, t.teacherId)],
);
