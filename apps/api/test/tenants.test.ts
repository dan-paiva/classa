import { auditLog, eq } from "@classa/db";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./harness.ts";

let t: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  t = await createTestApp();
});

describe("saúde", () => {
  it("GET /api/health responde sem login", async () => {
    const res = await t.call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});

describe("login e escola", () => {
  it("recusa /api/me sem sessão", async () => {
    const res = await t.call("/api/me");
    expect(res.status).toBe(401);
  });

  it("cria conta, cria escola e vira admin dela", async () => {
    const cookie = await t.signUp("admin@demo.classa.dev", "Admin Demo");

    const antes = await t.call("/api/me", { cookie });
    expect(antes.status).toBe(200);
    expect(await antes.json()).toMatchObject({ user: { email: "admin@demo.classa.dev" }, memberships: [] });

    const criada = await t.call("/api/tenants", {
      method: "POST",
      cookie,
      body: JSON.stringify({ name: "Escola Demo", slug: "escola-demo" }),
    });
    expect(criada.status).toBe(201);
    const { tenant } = (await criada.json()) as { tenant: { id: string } };

    const depois = await t.call("/api/me", { cookie });
    expect(await depois.json()).toMatchObject({
      memberships: [{ tenantId: tenant.id, name: "Escola Demo", slug: "escola-demo", role: "admin" }],
    });

    const auditoria = await t.db.select().from(auditLog).where(eq(auditLog.tenantId, tenant.id));
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ entity: "tenant", action: "create" });
  });

  it("recusa endereço de escola repetido", async () => {
    const cookie = await t.signUp("outra@demo.classa.dev");
    const res = await t.call("/api/tenants", {
      method: "POST",
      cookie,
      body: JSON.stringify({ name: "Outra Escola", slug: "escola-demo" }),
    });
    expect(res.status).toBe(409);
  });

  it("valida nome e endereço", async () => {
    const cookie = await t.signUp("validacao@demo.classa.dev");
    const res = await t.call("/api/tenants", {
      method: "POST",
      cookie,
      body: JSON.stringify({ name: "X", slug: "Com Espaço" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: Record<string, string[]> };
    expect(Object.keys(body.issues).sort()).toEqual(["name", "slug"]);
  });

  it("não cria escola sem sessão", async () => {
    const res = await t.call("/api/tenants", { method: "POST", body: JSON.stringify({ name: "Escola", slug: "escola" }) });
    expect(res.status).toBe(401);
  });
});
