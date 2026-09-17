import { describe, expect, it } from "vitest";
import { app } from "./app.ts";

describe("GET /api/health", () => {
  it("responde ok", async () => {
    const res = await app.request("/api/health", {}, { APP_ENV: "test" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "classa-api", env: "test" });
  });

  it("devolve 404 para rota desconhecida", async () => {
    const res = await app.request("/api/nao-existe", {}, { APP_ENV: "test" });
    expect(res.status).toBe(404);
  });
});
