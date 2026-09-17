import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    // migrations usam a conexão direta (sem pooler) quando ela existe
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "postgres://classa:classa@localhost:5432/classa",
  },
});
