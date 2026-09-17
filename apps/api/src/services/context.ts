import type { Database, TenantSettings } from "@classa/db";
import type { Context } from "hono";
import type { AppEnv } from "../app.ts";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Db = Database | Tx;

/** Tudo que um serviço precisa saber sobre quem age, onde e quando. */
export type ServiceContext = {
  db: Database;
  tenantId: string;
  actorId: string | null;
  timezone: string;
  settings: TenantSettings;
  /** Relógio injetável: o seed e os testes simulam o passado. */
  now: Date;
};

export function contextFrom(c: Context<AppEnv>): ServiceContext {
  return {
    db: c.var.db,
    tenantId: c.var.tenant.id,
    actorId: c.var.user?.id ?? null,
    timezone: c.var.tenant.timezone,
    settings: c.var.tenant.settings,
    now: new Date(),
  };
}
