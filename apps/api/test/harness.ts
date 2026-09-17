import { createTestDb } from "@classa/db/testing";
import { createApp } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";

export const BASE_URL = "http://localhost:8787";

/** App completo sobre um Postgres em memória, com as migrations reais aplicadas. */
export async function createTestApp() {
  const database = await createTestDb();
  // segredo aleatório por execução: nada fixo no repositório
  const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const auth = createAuth({ db: database, secret, baseURL: BASE_URL });
  const app = createApp(() => ({ db: database, auth }));

  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", BASE_URL);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (init.cookie) headers.set("cookie", init.cookie);
    return app.request(`${BASE_URL}${path}`, { ...init, headers });
  };

  /** Cria conta e devolve o cookie de sessão. */
  const signUp = async (email: string, name = "Pessoa Teste") => {
    const res = await call("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, name, password: "senha-bem-longa-123" }),
    });
    if (res.status !== 200) throw new Error(`sign-up falhou: ${res.status} ${await res.text()}`);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return cookie;
  };

  return { app, db: database, call, signUp };
}
