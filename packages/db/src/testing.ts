import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "./index.ts";
import * as schema from "./schema.ts";

/** Postgres em memória (PGlite) com as migrations reais aplicadas. Só para testes. */
export async function createTestDb(): Promise<Database> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
  return db as unknown as Database;
}
