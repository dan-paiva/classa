import { authUser, eq, membership, sql, tenant } from "@classa/db";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./harness.ts";

/** "Ver como" das escolas de demonstração: o admin empresta o perfil de outro vínculo da escola. */

let t: Awaited<ReturnType<typeof createTestApp>>;
let adminCookie = "";
let coordCookie = "";
let adminMembership = "";
let coordMembership = "";
const SLUG = "vitrine";

const as = (cookie: string, path: string, viewAs?: string, method = "GET", body?: unknown) =>
  t.call(`/api/t/${SLUG}${path}`, {
    method,
    cookie,
    headers: viewAs ? { "x-classa-view-as": viewAs } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  t = await createTestApp();
  ({ cookie: adminCookie } = await t.adminOf(SLUG));
  coordCookie = await t.signUp("coord@vitrine.classa.dev", "Coordenação");
  const [school] = await t.db.select().from(tenant).where(eq(tenant.slug, SLUG));
  const [coordUser] = await t.db.select().from(authUser).where(eq(authUser.email, "coord@vitrine.classa.dev"));
  const [m] = await t.db
    .insert(membership)
    .values({ tenantId: school!.id, userId: coordUser!.id, role: "admin", profileType: "colaborador", level: 2, areas: { ped: "total" } })
    .returning();
  coordMembership = m!.id;
  const [a] = await t.db.select().from(membership).where(sql`${membership.tenantId} = ${school!.id} and ${membership.profileType} = 'admin'`);
  adminMembership = a!.id;
});

describe("ver como", () => {
  it("fora de escola de demonstração o cabeçalho é ignorado", async () => {
    expect(await (await as(adminCookie, "/demo/profiles")).json()).toMatchObject({ demo: false, profiles: [] });
    // continua admin: pode mudar configuração
    expect((await as(adminCookie, "/settings/bonus", coordMembership, "PATCH", { enabled: true, every: 5 })).status).toBe(200);
  });

  it("na escola de demonstração o admin lista os perfis e passa a agir como o escolhido", async () => {
    await t.db.update(tenant).set({ settings: sql`${tenant.settings} || '{"demo": true}'::jsonb` }).where(eq(tenant.slug, SLUG));
    const res = (await (await as(adminCookie, "/demo/profiles")).json()) as { demo: boolean; profiles: { id: string; isMe: boolean; profileType: string }[] };
    expect(res.demo).toBe(true);
    expect(res.profiles.map((p) => [p.profileType, p.isMe])).toEqual(
      expect.arrayContaining([
        ["admin", true],
        ["colaborador", false],
      ]),
    );

    // como coordenação, perde o que é só do admin…
    expect((await as(adminCookie, "/settings/bonus", coordMembership, "PATCH", { enabled: true, every: 5 })).status).toBe(403);
    // …mas continua podendo trocar de perfil, porque é admin de verdade
    expect(await (await as(adminCookie, "/demo/profiles", coordMembership)).json()).toMatchObject({ demo: true, viewingAs: coordMembership });
  });

  it("quem não é admin não empresta perfil nenhum", async () => {
    expect((await as(coordCookie, "/settings/bonus", adminMembership, "PATCH", { enabled: true, every: 5 })).status).toBe(403);
    expect(await (await as(coordCookie, "/demo/profiles", adminMembership)).json()).toMatchObject({ demo: false, profiles: [] });
  });

  it("vínculo de outra escola não é emprestado", async () => {
    const outra = await t.adminOf("outra");
    const [o] = await t.db.select().from(membership).innerJoin(tenant, eq(tenant.id, membership.tenantId)).where(eq(tenant.slug, "outra"));
    expect((await as(adminCookie, "/settings/bonus", o!.membership.id, "PATCH", { enabled: true, every: 5 })).status).toBe(200);
    void outra;
  });
});
