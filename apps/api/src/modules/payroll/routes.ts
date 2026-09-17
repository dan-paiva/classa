import { SUPPORT_REASONS } from "@classa/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { isoDate } from "../../http/query.ts";
import { requireAdmin, requireTenant } from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import { contextFrom } from "../../services/context.ts";
import { markUnfinishedLessons } from "../../services/lessons.ts";
import {
  closeMonth,
  computePayroll,
  listPeriods,
  markLinePaid,
  overrideLessonRate,
  reopenMonth,
  requestSupport,
  setClassGroupTeacherRate,
} from "../../services/payroll.ts";

export const payrollRoutes = new Hono<AppEnv>()
  .use("*", requireTenant)

  .get("/payroll", async (c) => {
    const ctx = contextFrom(c);
    await markUnfinishedLessons(ctx);
    const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
    return c.json({ payroll: await computePayroll(ctx, month), periods: await listPeriods(ctx) });
  })

  .post("/payroll/:month/close", requireAdmin, async (c) => c.json({ period: await closeMonth(contextFrom(c), c.req.param("month")) }))

  .post("/payroll/:month/reopen", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ justification: z.string({ error: "Informe a justificativa" }) }));
    if (error) return error;
    return c.json({ period: await reopenMonth(contextFrom(c), c.req.param("month"), data.justification) });
  })

  .post("/payroll/lines/:id/paid", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ paidOn: isoDate }));
    if (error) return error;
    return c.json({ line: await markLinePaid(contextFrom(c), c.req.param("id"), data.paidOn) });
  })

  .post("/lessons/:id/support", requireAdmin, async (c) => {
    const { data, error } = await parseBody(
      c,
      z.object({ reason: z.enum(SUPPORT_REASONS, { error: "Escolha o motivo" }).nullable(), detail: z.string().optional() }),
    );
    if (error) return error;
    return c.json({ lesson: await requestSupport(contextFrom(c), c.req.param("id"), data.reason ? { reason: data.reason, detail: data.detail } : null) });
  })

  .post("/lessons/:id/rate", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ cents: z.number().int().min(0).nullable(), reason: z.string().default("") }));
    if (error) return error;
    return c.json({ lesson: await overrideLessonRate(contextFrom(c), c.req.param("id"), data.cents == null ? null : { cents: data.cents, reason: data.reason }) });
  })

  .post("/class-groups/:id/teacher-rate", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ cents: z.number().int().min(0).nullable() }));
    if (error) return error;
    return c.json({ classGroup: await setClassGroupTeacherRate(contextFrom(c), c.req.param("id"), data.cents) });
  });
