import { describe, expect, it } from "vitest";
import { parseEmailList } from "../src/auth.ts";
import { createTestApp } from "./harness.ts";

const body = (email: string) => JSON.stringify({ email, name: "Pessoa", password: "senha-bem-longa-123" });

describe("cadastro limitado por e-mail", () => {
  it("aceita e-mail liberado, sem diferenciar maiúsculas", async () => {
    const t = await createTestApp({ allowedSignupEmails: parseEmailList(" Dono@Escola.dev , outra@escola.dev") });
    const res = await t.call("/api/auth/sign-up/email", { method: "POST", body: body("dono@escola.dev") });
    expect(res.status).toBe(200);
  });

  it("recusa e-mail fora da lista", async () => {
    const t = await createTestApp({ allowedSignupEmails: ["dono@escola.dev"] });
    const res = await t.call("/api/auth/sign-up/email", { method: "POST", body: body("intruso@escola.dev") });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ message: "O cadastro não está liberado para este e-mail." });
  });

  it("sem lista, o cadastro fica aberto", async () => {
    const t = await createTestApp();
    const res = await t.call("/api/auth/sign-up/email", { method: "POST", body: body("qualquer@escola.dev") });
    expect(res.status).toBe(200);
  });
});
