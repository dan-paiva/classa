import type { Context } from "hono";
import { z } from "zod";

/** Lê o JSON e valida; devolve os dados ou a resposta 400 pronta, com mensagens por campo. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S) {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data as z.output<S>, error: null };
  return {
    data: null,
    error: c.json({ error: "validation", issues: z.flattenError(parsed.error).fieldErrors }, 400),
  };
}
