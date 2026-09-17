import { beforeAll, describe, expect, it } from "vitest";
import { auditLog, eq, tenant, type Database } from "./index.ts";
import { createTestDb } from "./testing.ts";

let db: Database;

beforeAll(async () => {
  db = await createTestDb();
});

describe("schema", () => {
  it("cria uma escola com fuso padrão de São Paulo", async () => {
    const [escola] = await db.insert(tenant).values({ name: "Escola Demo", slug: "demo" }).returning();
    expect(escola?.timezone).toBe("America/Sao_Paulo");
    expect(escola?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("registra auditoria ligada à escola", async () => {
    const [escola] = await db.select().from(tenant).where(eq(tenant.slug, "demo"));
    await db.insert(auditLog).values({
      tenantId: escola!.id,
      entity: "tenant",
      entityId: escola!.id,
      action: "create",
      after: { name: escola!.name },
    });
    const linhas = await db.select().from(auditLog).where(eq(auditLog.tenantId, escola!.id));
    expect(linhas).toHaveLength(1);
  });

  it("recusa auditoria de escola inexistente", async () => {
    await expect(
      db.insert(auditLog).values({
        tenantId: "00000000-0000-7000-8000-000000000000",
        entity: "tenant",
        entityId: "x",
        action: "create",
      }),
    ).rejects.toThrow();
  });
});
