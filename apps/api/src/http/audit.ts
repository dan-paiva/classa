import { auditLog, type AuditAction, type Database } from "@classa/db";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function audit(
  tx: Tx | Database,
  entry: {
    tenantId: string;
    actorId: string;
    entity: string;
    entityId: string;
    action: AuditAction;
    before?: unknown;
    after?: unknown;
  },
) {
  await tx.insert(auditLog).values({ ...entry, before: entry.before ?? null, after: entry.after ?? null });
}
