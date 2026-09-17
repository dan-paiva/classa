import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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

/** A escola. Toda tabela de negócio aponta para um tenant. */
export const tenant = pgTable("tenant", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
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

export const AUDIT_ACTIONS = ["create", "update", "deactivate", "reactivate", "delete"] as const;
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
