/** Código SQLSTATE do Postgres. O Drizzle embrulha o erro do driver em `cause`. */
export function pgErrorCode(err: unknown): string | null {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
}

/** Postgres 23505. */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}

/** Nome da constraint violada, quando o driver informa. */
export function pgConstraint(err: unknown): string | null {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const name = (e as { constraint?: unknown; constraint_name?: unknown }).constraint ?? (e as { constraint_name?: unknown }).constraint_name;
    if (typeof name === "string") return name;
  }
  return null;
}
