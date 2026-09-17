import { jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** A escola. Toda tabela de negócio aponta para um tenant. */
export const tenant = pgTable("tenant", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  createdAt: createdAt(),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
});

/** Histórico append-only de alterações. Nunca recebe UPDATE nem DELETE. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    actorId: uuid("actor_id"),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action", { enum: ["create", "update", "deactivate", "delete"] }).notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    justification: text("justification"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt)],
);
