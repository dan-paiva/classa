import { createDb } from "@classa/db";
import { createApp } from "./app.ts";
import { createAuth, parseEmailList } from "./auth.ts";

type Bindings = {
  APP_ENV: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  /** Origens extras aceitas no login, separadas por vírgula (ex.: o Vite em :5173). */
  TRUSTED_ORIGINS?: string;
  /** E-mails que podem criar conta, separados por vírgula. Vazio = cadastro aberto. */
  SIGNUP_ALLOWED_EMAILS?: string;
  DATABASE_URL?: string;
  HYPERDRIVE?: Hyperdrive;
};

const app = createApp((env) => {
  const b = env as Bindings;
  const url = b.HYPERDRIVE?.connectionString ?? b.DATABASE_URL;
  if (!url) throw new Error("Configure HYPERDRIVE ou DATABASE_URL");
  const { db, close } = createDb(url);
  const auth = createAuth({
    db,
    secret: b.BETTER_AUTH_SECRET,
    baseURL: b.BETTER_AUTH_URL,
    trustedOrigins: b.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean),
    allowedSignupEmails: parseEmailList(b.SIGNUP_ALLOWED_EMAILS),
  });
  return { db, auth, dispose: close };
});

export default app;
