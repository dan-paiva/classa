import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // cada arquivo sobe um Postgres em memória (PGlite) e aplica todas as migrations
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
