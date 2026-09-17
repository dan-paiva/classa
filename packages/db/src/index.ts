import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export * from "./schema.ts";
export { schema };

/** Qualquer banco Drizzle Postgres com o schema do Classa (postgres-js em produção, PGlite nos testes). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string) {
  const client = postgres(url, { prepare: false, max: 5 });
  return { db: drizzle(client, { schema }) as unknown as Database, close: () => client.end() };
}

// operadores reexportados para que todo o monorepo use a mesma instância do drizzle-orm
export { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, not, or, sql } from "drizzle-orm";
