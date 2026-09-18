import { PAYMENT_METHODS } from "@classa/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { isoDate, uuid } from "../../http/query.ts";
import {authorize} from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import { contextFrom } from "../../services/context.ts";
import { listOpenSlots, reserveLesson } from "../../services/open-entry.ts";
import {
  addCreditEntry,
  createEnrollment,
  endEnrollment,
  ledger,
  listEnrollments,
  reactivateEnrollment,
  transferEnrollment,
} from "../../services/enrollments.ts";
import { financeSummary, listInstallments, listPayments, refreshDelinquency, registerPayment, reversePayment } from "../../services/finance.ts";

const STATUS = ["a_vencer", "vencida", "paga", "cancelada"] as const;

export const financeRoutes = new Hono<AppEnv>()

  /* ----------------------------------------------------------------- matrículas */
  .get("/enrollments", authorize("alunos", "ver"), async (c) =>
    c.json({
      enrollments: await listEnrollments(contextFrom(c), {
        studentId: c.req.query("studentId") || undefined,
        classGroupId: c.req.query("classGroupId") || undefined,
        activeOnly: c.req.query("active") === "1",
      }),
    }),
  )

  .post("/enrollments", authorize("alunos", "editar"), async (c) => {
    const { data, error } = await parseBody(
      c,
      z.object({
        studentId: uuid,
        // open-entry não tem turma: vai curso + módulo (o nível do aluno)
        regime: z.enum(["regular", "open_entry", "particular"]).optional(),
        classGroupId: uuid.optional(),
        courseId: uuid.optional(),
        moduleId: uuid.optional(),
        packageLessons: z.number().int().optional(),
        startsOn: isoDate.optional(),
        endsOn: isoDate.optional(),
        modality: z.enum(["online", "presencial"]).optional(),
        contract: z.union([z.literal(false), z.object({ discountCents: z.number().int().min(0).optional(), installments: z.number().int().optional(), dueDay: z.number().int().optional() })]).optional(),
      }),
    );
    if (error) return error;
    return c.json({ enrollment: await createEnrollment(contextFrom(c), data) }, 201);
  })

  .post("/enrollments/:id/end", authorize("alunos", "inativar"), async (c) => c.json({ enrollment: await endEnrollment(contextFrom(c), c.req.param("id")) }))
  .post("/enrollments/:id/reactivate", authorize("alunos", "inativar"), async (c) => c.json({ enrollment: await reactivateEnrollment(contextFrom(c), c.req.param("id")) }))

  /* ----------------------------------------------------- open-entry (§5.9) */

  .get("/enrollments/:id/vagas", authorize("agenda", "ver"), async (c) =>
    c.json({ slots: await listOpenSlots(contextFrom(c), c.req.param("id"), { from: c.req.query("from"), to: c.req.query("to") }) }),
  )

  .post("/enrollments/:id/vagas/:lessonId", authorize("agenda", "operar"), async (c) =>
    c.json({ reserva: await reserveLesson(contextFrom(c), c.req.param("id"), c.req.param("lessonId")) }, 201),
  )

  .post("/enrollments/:id/transfer", authorize("alunos", "editar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ classGroupId: uuid }));
    if (error) return error;
    return c.json({ enrollment: await transferEnrollment(contextFrom(c), c.req.param("id"), data.classGroupId) });
  })

  .get("/enrollments/:id/credits", authorize("alunos", "ver"), async (c) => c.json({ entries: await ledger(contextFrom(c), c.req.param("id")) }))

  .post("/enrollments/:id/credits", authorize("financeiro", "editar"), async (c) => {
    const { data, error } = await parseBody(
      c,
      z.object({ kind: z.enum(["ajuste", "promocional", "renovacao"]), amount: z.number({ error: "Informe a quantidade" }).int(), justification: z.string().optional() }),
    );
    if (error) return error;
    return c.json({ entry: await addCreditEntry(contextFrom(c), c.req.param("id"), data) }, 201);
  })

  /* ------------------------------------------------------------------ financeiro */
  .get("/finance/summary", authorize("financeiro", "ver"), async (c) => {
    const ctx = contextFrom(c);
    await refreshDelinquency(ctx);
    const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
    return c.json({ summary: await financeSummary(ctx, month) });
  })

  .get("/installments", authorize("financeiro", "ver"), async (c) => {
    const status = c.req.query("status");
    return c.json({
      installments: await listInstallments(contextFrom(c), {
        status: (STATUS as readonly string[]).includes(status ?? "") ? (status as (typeof STATUS)[number]) : undefined,
        studentId: c.req.query("studentId") || undefined,
        from: c.req.query("from") || undefined,
        to: c.req.query("to") || undefined,
      }),
    });
  })

  .get("/installments/:id/payments", authorize("financeiro", "ver"), async (c) => c.json({ payments: await listPayments(contextFrom(c), c.req.param("id")) }))

  .post("/installments/:id/payments", authorize("financeiro", "operar"), async (c) => {
    const { data, error } = await parseBody(
      c,
      z.object({ method: z.enum(PAYMENT_METHODS, { error: "Escolha a forma de pagamento" }), amountCents: z.number().int().positive().optional(), paidOn: isoDate.optional() }),
    );
    if (error) return error;
    return c.json({ payment: await registerPayment(contextFrom(c), c.req.param("id"), data) }, 201);
  })

  .post("/payments/:id/reverse", authorize("financeiro", "inativar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ justification: z.string({ error: "Informe a justificativa" }) }));
    if (error) return error;
    return c.json({ payment: await reversePayment(contextFrom(c), c.req.param("id"), data.justification) }, 201);
  });
