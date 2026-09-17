import { authAccount, authSession, authUser, authVerification, type Database } from "@classa/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { uuidv7 } from "uuidv7";

export type AuthConfig = {
  db: Database;
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
};

export function createAuth({ db, secret, baseURL, trustedOrigins = [] }: AuthConfig) {
  return betterAuth({
    secret,
    baseURL,
    basePath: "/api/auth",
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: authUser, session: authSession, account: authAccount, verification: authVerification },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    advanced: { database: { generateId: () => uuidv7() } },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
