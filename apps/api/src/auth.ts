import { authAccount, authSession, authUser, authVerification, type Database } from "@classa/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { uuidv7 } from "uuidv7";
import { hasOpenInvitation } from "./services/users.ts";

export type AuthConfig = {
  db: Database;
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
  /**
   * E-mails que podem criar conta. Vazio ou ausente = cadastro aberto (desenvolvimento local).
   * Em produção vem de SIGNUP_ALLOWED_EMAILS.
   */
  allowedSignupEmails?: string[];
};

export function parseEmailList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function createAuth({ db, secret, baseURL, trustedOrigins = [], allowedSignupEmails = [] }: AuthConfig) {
  const allowed = new Set(allowedSignupEmails.map((e) => e.toLowerCase()));
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
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // cadastro liberado pela lista de e-mails (primeira conta da escola) ou por convite aberto
            if (allowed.size > 0 && !allowed.has(user.email.toLowerCase()) && !(await hasOpenInvitation(db, user.email))) {
              throw new APIError("FORBIDDEN", { message: "O cadastro não está liberado para este e-mail." });
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
