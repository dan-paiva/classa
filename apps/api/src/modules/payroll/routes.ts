import { SUPPORT_REASONS } from "@classa/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { isoDate } from "../../http/query.ts";
import {authorize, hasPermission, isOwnLessonOnly} from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import { contextFrom } from "../../services/context.ts";
import { assertOwnLesson } from "../../services/lessons.ts";
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

  .get("/payroll", authorize("folha", "ver"), async (c) => {
    const ctx = contextFrom(c);
    await markUnfinishedLessons(ctx);
    const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
    return c.json({ payroll: await computePayroll(ctx, month), periods: await listPeriods(ctx) });
  })

  .post("/payroll/:month/close", authorize("folha", "editar"), async (c) => c.json({ period: await closeMonth(contextFrom(c), c.req.param("month")) }))

  .post("/payroll/:month/reopen", authorize("folha", "administrar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ justification: z.string({ error: "Informe a justificativa" }) }));
    if (error) return error;
    return c.json({ period: await reopenMonth(contextFrom(c), c.req.param("month"), data.justification) });
  })

  .post("/payroll/lines/:id/paid", authorize("folha", "operar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ paidOn: isoDate }));
    if (error) return error;
    return c.json({ line: await markLinePaid(contextFrom(c), c.req.param("id"), data.paidOn) });
  })

  .post("/lessons/:id/support", authorize("agenda", "operar"), async (c) => {
    const { data, error } = await parseBody(
      c,
      z.object({ reason: z.enum(SUPPORT_REASONS, { error: "Escolha o motivo" }).nullable(), detail: z.string().optional() }),
    );
    if (error) return error;
    const ctx = contextFrom(c);
    if (isOwnLessonOnly(c)) await assertOwnLesson(ctx, c.var.tenant.teacherId, c.req.param("id"));
    if (!data.reason && !hasPermission(c, "folha", "editar")) return c.json({ error: "forbidden", message: "Só a coordenação retira um pedido de suporte." }, 403);
    return c.json({ lesson: await requestSupport(ctx, c.req.param("id"), data.reason ? { reason: data.reason, detail: data.detail } : null) });
  })

  .post("/lessons/:id/rate", authorize("folha", "editar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ cents: z.number().int().min(0).nullable(), reason: z.string().default("") }));
    if (error) return error;
    return c.json({ lesson: await overrideLessonRate(contextFrom(c), c.req.param("id"), data.cents == null ? null : { cents: data.cents, reason: data.reason }) });
  })

  .post("/class-groups/:id/teacher-rate", authorize("folha", "editar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ cents: z.number().int().min(0).nullable() }));
    if (error) return error;
    return c.json({ classGroup: await setClassGroupTeacherRate(contextFrom(c), c.req.param("id"), data.cents) });
  });
