import { eq, tenant, type TenantSettings } from "@classa/db";
import { DEFAULT_BONUS_RULE, resolveVocabulary } from "@classa/domain";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { audit } from "../../http/audit.ts";
import { requireAdmin } from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";

/**
 * Configurações da escola que mudam o que todo mundo vê: o vocabulário (DOMINIO.md §4.6)
 * e a regra da aula bônus (§5.9.1). Ler é para qualquer membro; mudar, só admin.
 */

const word = z.string().trim().max(40, "No máximo 40 caracteres");
const term = z.object({ singular: word, plural: word, feminine: z.boolean() }).partial();
const vocabularyInput = z.object({
  course: term,
  level: term,
  classGroup: term,
  kinds: z.object({ regular: word, open_entry: word, particular: word }).partial(),
}).partial();

const bonusInput = z.object({
  enabled: z.boolean(),
  every: z.number({ error: "Informe um número" }).int("Use um número inteiro").min(1, "Pelo menos 1 aula").max(100, "No máximo 100 aulas"),
});

async function save(c: Context<AppEnv>, key: "vocabulary" | "bonus", value: unknown) {
  const t = c.var.tenant;
  const before = t.settings;
  const settings = { ...before, [key]: value } as TenantSettings;
  await c.var.db.update(tenant).set({ settings }).where(eq(tenant.id, t.id));
  await audit(c.var.db, { tenantId: t.id, actorId: c.var.user?.id ?? null, entity: "tenant", entityId: t.id, action: "update", before: { [key]: before[key] ?? null }, after: { [key]: value } });
  return settings;
}

export const settingsRoutes = new Hono<AppEnv>()
  .get("/settings/school", (c) => {
    const s = c.var.tenant.settings;
    return c.json({ vocabulary: resolveVocabulary(s.vocabulary), custom: s.vocabulary ?? {}, bonus: s.bonus ?? DEFAULT_BONUS_RULE });
  })
  .patch("/settings/vocabulary", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, vocabularyInput);
    if (error) return error;
    const settings = await save(c, "vocabulary", data);
    return c.json({ vocabulary: resolveVocabulary(settings.vocabulary), custom: settings.vocabulary ?? {} });
  })
  .patch("/settings/bonus", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, bonusInput);
    if (error) return error;
    const settings = await save(c, "bonus", data);
    return c.json({ bonus: settings.bonus });
  });
