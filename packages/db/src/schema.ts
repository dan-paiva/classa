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

export const PROFILE_TYPE_VALUES = ["admin", "colaborador", "prestador", "aluno"] as const;
export type AreaAccessMap = Partial<Record<"adm" | "com" | "ped" | "aca" | "cx" | "fin" | "mkt", "total" | "restrito">>;

/**
 * Quem acessa qual escola e com qual perfil (DOMINIO.md §8): tipo de perfil, nível e áreas.
 * `role` é legado (todos os vínculos antigos eram admin).
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
    profileType: text("profile_type", { enum: PROFILE_TYPE_VALUES }).notNull().default("admin"),
    level: integer("level").notNull().default(1),
    areas: jsonb("areas").$type<AreaAccessMap>().notNull().default({}),
    /** Pessoa da escola ligada ao usuário (professor, aluno, colaborador). */
    personId: uuid("person_id"),
    status: text("status", { enum: ["ativo", "bloqueado"] }).notNull().default("ativo"),
    createdAt: createdAt(),
    deactivatedAt: tstz("deactivated_at"),
  },
  (t) => [
    unique("membership_tenant_user_uq").on(t.tenantId, t.userId),
    // a mesma pessoa pode ter vínculo de trabalho e de aluno, mas só um de cada (DOMINIO.md §3.4)
    uniqueIndex("membership_person_profile_uq")
      .on(t.tenantId, t.personId, t.profileType)
      .where(sql`${t.personId} is not null`),
    index("membership_user_idx").on(t.userId),
    index("membership_person_idx").on(t.tenantId, t.personId),
    check("membership_level_range", sql`${t.level} between 1 and 5`),
  ],
);

/** Convite: a conta nasce dele. O token vai só no link; aqui fica o hash. Vale 48 horas. */
export const invitation = pgTable(
  "invitation",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    email: text("email").notNull(),
    personId: uuid("person_id"),
    profileType: text("profile_type", { enum: PROFILE_TYPE_VALUES }).notNull(),
    level: integer("level").notNull(),
    areas: jsonb("areas").$type<AreaAccessMap>().notNull().default({}),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: tstz("expires_at").notNull(),
    acceptedAt: tstz("accepted_at"),
    acceptedUserId: text("accepted_user_id"),
    revokedAt: tstz("revoked_at"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("invitation_tenant_email_idx").on(t.tenantId, t.email)],
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
    /** Quem reserva a vaga open-entry: o próprio aluno (true) ou só a secretaria (DOMINIO.md §4.1). */
    autoAgenda: boolean("auto_agenda").notNull().default(true),
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
    /** Só dígitos. Chave de reconciliação da pessoa (DOMINIO.md §3.1.2). */
    cpf: text("cpf"),
    /** Só dígitos. */
    phone: text("phone"),
    birthDate: date("birth_date"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("person_tenant_cpf_uq").on(t.tenantId, t.cpf).where(sql`${t.cpf} is not null`),
    index("person_tenant_name_idx").on(t.tenantId, t.name),
  ],
);

export const PERSON_EMAIL_KINDS = ["pessoal", "corporativo"] as const;
export type PersonEmailKind = (typeof PERSON_EMAIL_KINDS)[number];

/**
 * E-mails da pessoa (DOMINIO.md §3.1.1). São vários porque o mesmo ser humano
 * pode ser colaborador pelo e-mail corporativo e aluno pelo pessoal, sem virar
 * duas pessoas. O principal é o usado em cobrança e avisos.
 */
export const personEmail = pgTable(
  "person_email",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    kind: text("kind", { enum: PERSON_EMAIL_KINDS }).notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("person_email_tenant_email_uq").on(t.tenantId, sql`lower(${t.email})`),
    unique("person_email_person_kind_uq").on(t.personId, t.kind),
    uniqueIndex("person_email_primary_uq").on(t.personId).where(sql`${t.isPrimary}`),
    index("person_email_person_idx").on(t.personId),
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
    /** Empresa que oferece o curso (B2B ou B2B2C). Sem empresa = B2C. */
    companyId: uuid("company_id"),
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

/**
 * Regime: como o aluno se liga à turma (DOMINIO.md §5.9). Não confundir com
 * modalidade, que é online ou presencial.
 * - `regular`: o aluno pertence à turma e entra em todas as aulas dela;
 * - `open_entry`: ninguém pertence; as vagas ficam abertas e o aluno reserva aula a aula;
 * - `particular`: turma de uma vaga, criada na alocação da matrícula.
 */
export const CLASS_REGIMES = ["regular", "open_entry", "particular"] as const;
export type ClassRegime = (typeof CLASS_REGIMES)[number];

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
    regime: text("regime", { enum: CLASS_REGIMES }).notNull().default("regular"),
    capacity: integer("capacity").notNull(),
    /** Derivada do regime: a folha paga aula particular por valor fixo. Nunca se grava direto. */
    individual: boolean("individual")
      .notNull()
      .generatedAlwaysAs(sql`regime = 'particular'`),
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
    check("class_group_particular_capacity", sql`${t.regime} <> 'particular' or ${t.capacity} = 1`),
    index("class_group_open_entry_idx").on(t.tenantId, t.moduleId).where(sql`${t.regime} = 'open_entry'`),
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
    regime: text("regime", { enum: CLASS_REGIMES }).notNull().default("regular"),
    /** Vazia no open-entry: o aluno não pertence a turma nenhuma (DOMINIO.md §5.9). */
    classGroupId: uuid("class_group_id").references(() => classGroup.id),
    /** No open-entry é o nível do aluno, e é ele que limita o que dá para reservar. */
    moduleId: uuid("module_id").references(() => courseModule.id),
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
    // open-entry não tem turma; os outros regimes têm. O nível é obrigatório no open-entry.
    check(
      "enrollment_regime_shape",
      sql`(${t.regime} = 'open_entry' and ${t.classGroupId} is null and ${t.moduleId} is not null) or (${t.regime} <> 'open_entry' and ${t.classGroupId} is not null)`,
    ),
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

/* ---------------------------------------------------------------------------
 * Empresas: contas B2B (empresa paga) e B2B2C (benefício dividido)
 * ------------------------------------------------------------------------- */

export const COMPANY_MODELS = ["b2b", "b2b2c"] as const;
export type CompanyModel = (typeof COMPANY_MODELS)[number];

export const company = pgTable(
  "company",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    /** Só dígitos. */
    cnpj: text("cnpj"),
    segment: text("segment"),
    model: text("model", { enum: COMPANY_MODELS }).notNull(),
    /** Gerente da conta (usuário). */
    managerUserId: text("manager_user_id"),
    hrName: text("hr_name"),
    hrEmail: text("hr_email"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    /** Colaboradores que estudam ao mesmo tempo. */
    licenses: integer("licenses").notNull(),
    contractedLessons: integer("contracted_lessons").notNull().default(0),
    licensePriceCents: integer("license_price_cents").notNull(),
    /** B2B2C: parte que a empresa paga (B2B = 100). */
    subsidyPercent: integer("subsidy_percent").notNull().default(100),
    /** B2B2C: desconto sobre a parte do colaborador (B2B = 0). */
    discountPercent: integer("discount_percent").notNull().default(0),
    autoRenew: boolean("auto_renew").notNull().default(true),
    /** Cursos que os colaboradores podem fazer; null = todos. */
    allowedCourseIds: uuid("allowed_course_ids").array(),
    lastReportSentAt: tstz("last_report_sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deactivatedAt: tstz("deactivated_at"),
  },
  (t) => [
    unique("company_tenant_name_uq").on(t.tenantId, t.name),
    uniqueIndex("company_tenant_cnpj_uq").on(t.tenantId, t.cnpj).where(sql`${t.cnpj} is not null`),
    check("company_period", sql`${t.endsOn} > ${t.startsOn}`),
    check("company_licenses_positive", sql`${t.licenses} >= 1`),
    check("company_subsidy_range", sql`${t.subsidyPercent} between 0 and 100`),
    check("company_discount_range", sql`${t.discountPercent} between 0 and 100`),
  ],
);

/** Cobrança mensal da parte da empresa. Uma por empresa e mês. */
export const companyCharge = pgTable(
  "company_charge",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    /** "AAAA-MM" */
    month: text("month").notNull(),
    /** Base de cálculo: licenças (B2B) ou colaboradores ativos (B2B2C). */
    billedLicenses: integer("billed_licenses").notNull(),
    amountCents: integer("amount_cents").notNull(),
    dueDate: date("due_date").notNull(),
    paidOn: date("paid_on"),
    method: text("method", { enum: PAYMENT_METHODS }),
    cancelledAt: tstz("cancelled_at"),
    createdAt: createdAt(),
  },
  (t) => [unique("company_charge_month_uq").on(t.companyId, t.month)],
);

/* ---------------------------------------------------------------------------
 * Eventos, reuniões e nivelamentos (DOMINIO.md §5.8). Ficam fora de `lesson`
 * porque não têm folha, crédito nem presença; a agenda geral lê as duas.
 * ------------------------------------------------------------------------- */

export const AGENDA_EVENT_KINDS = ["reuniao", "evento", "nivelamento"] as const;
export type AgendaEventKind = (typeof AGENDA_EVENT_KINDS)[number];
export const AGENDA_EVENT_STATES = ["agendado", "realizado", "nao_compareceu", "cancelado"] as const;
export type AgendaEventState = (typeof AGENDA_EVENT_STATES)[number];

export const agendaEvent = pgTable(
  "agenda_event",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    kind: text("kind", { enum: AGENDA_EVENT_KINDS }).notNull(),
    title: text("title").notNull(),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    /** Endereço, sala ou link da chamada. */
    location: text("location"),
    notes: text("notes"),
    state: text("state", { enum: AGENDA_EVENT_STATES }).notNull().default("agendado"),
    cancelReason: text("cancel_reason"),
    /** Nivelamento: quem é avaliado. Pode ser lead, por isso aponta para a pessoa. */
    evaluatedPersonId: uuid("evaluated_person_id").references(() => person.id),
    evaluatorPersonId: uuid("evaluator_person_id").references(() => person.id),
    courseId: uuid("course_id").references(() => course.id),
    /** Resultado do nivelamento: alimenta a decisão, não matricula ninguém. */
    suggestedModuleId: uuid("suggested_module_id").references(() => courseModule.id),
    resultNotes: text("result_notes"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("agenda_event_period", sql`${t.endsAt} > ${t.startsAt}`),
    check("agenda_event_leveling", sql`${t.kind} <> 'nivelamento' or ${t.evaluatedPersonId} is not null`),
    index("agenda_event_tenant_starts_idx").on(t.tenantId, t.startsAt),
  ],
);

/** Participantes por pessoa: colaborador, professor, aluno e lead entram do mesmo jeito. */
export const agendaEventParticipant = pgTable(
  "agenda_event_participant",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => agendaEvent.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.personId] }), index("agenda_event_participant_person_idx").on(t.personId)],
);

/* ---------------------------------------------------------------------------
 * Comercial e operação: leads e fluxos em kanban
 * ------------------------------------------------------------------------- */

export const LEAD_STAGE_VALUES = ["captado", "contato", "nivelamento", "proposta", "matriculado", "perdido"] as const;

export const lead = pgTable(
  "lead",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    /** A pessoa nasce na captação: é o id que acompanha até depois de virar aluno (DOMINIO.md §6.5). */
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    origin: text("origin").notNull(),
    campaign: text("campaign"),
    courseId: uuid("course_id").references(() => course.id),
    consultantUserId: text("consultant_user_id"),
    stage: text("stage", { enum: LEAD_STAGE_VALUES }).notNull().default("captado"),
    previousStage: text("previous_stage", { enum: LEAD_STAGE_VALUES }),
    lostReason: text("lost_reason"),
    temperature: text("temperature", { enum: ["frio", "morno", "quente"] }),
    nextAction: text("next_action"),
    nextActionOn: date("next_action_on"),
    consent: boolean("consent").notNull().default(false),
    studentId: uuid("student_id").references(() => student.id),
    stageChangedAt: tstz("stage_changed_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("lead_tenant_stage_idx").on(t.tenantId, t.stage), index("lead_person_idx").on(t.personId)],
);

export const workflowCard = pgTable(
  "workflow_card",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    flow: text("flow").notNull(),
    stage: text("stage").notNull(),
    title: text("title").notNull(),
    /** Valores dos campos do fluxo e marcas dos efeitos já executados. */
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    stageChangedAt: tstz("stage_changed_at").notNull().defaultNow(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("workflow_card_tenant_flow_idx").on(t.tenantId, t.flow, t.stage)],
);

export const workflowTransition = pgTable(
  "workflow_transition",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    cardId: uuid("card_id")
      .notNull()
      .references(() => workflowCard.id),
    fromStage: text("from_stage"),
    toStage: text("to_stage").notNull(),
    note: text("note"),
    actorId: text("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [index("workflow_transition_card_idx").on(t.cardId)],
);
