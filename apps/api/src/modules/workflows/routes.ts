import { FLOWS, LEAD_LOST_REASONS } from "@classa/domain";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { isoDate, uuid } from "../../http/query.ts";
import { requireAdmin, requireTenant } from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import { contextFrom } from "../../services/context.ts";
import {
  cardDetail,
  convertLead,
  createCard,
  createLead,
  flowCounts,
  flowOptions,
  listCards,
  listLeads,
  moveCard,
  moveLead,
  renewalQueue,
  updateCard,
  updateLead,
} from "../../services/workflows.ts";

const leadInput = z.object({
  name: z.string({ error: "Informe o nome" }),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  origin: z.string({ error: "Escolha a origem" }),
  campaign: z.string().nullish(),
  courseId: uuid.nullish(),
  temperature: z.enum(["frio", "morno", "quente"]).nullish(),
  nextAction: z.string().nullish(),
  nextActionOn: isoDate.nullish(),
  consent: z.boolean().optional(),
});

export const workflowRoutes = new Hono<AppEnv>()
  .use("*", requireTenant)

  /* ----------------------------------------------------------------- leads */
  .get("/leads", async (c) => c.json({ leads: await listLeads(contextFrom(c)) }))
  .post("/leads", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, leadInput);
    if (error) return error;
    return c.json({ lead: await createLead(contextFrom(c), data) }, 201);
  })
  .patch("/leads/:id", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, leadInput.partial());
    if (error) return error;
    return c.json({ lead: await updateLead(contextFrom(c), c.req.param("id"), data) });
  })
  .post("/leads/:id/move", requireAdmin, async (c) => {
    const { data, error } = await parseBody(
      c,
      z.discriminatedUnion("to", [
        z.object({ to: z.literal("avancar") }),
        z.object({ to: z.literal("perdido"), reason: z.enum(LEAD_LOST_REASONS, { error: "Escolha o motivo" }) }),
        z.object({ to: z.literal("reabrir") }),
      ]),
    );
    if (error) return error;
    return c.json({ lead: await moveLead(contextFrom(c), c.req.param("id"), data) });
  })
  .post("/leads/:id/convert", requireAdmin, async (c) => c.json({ lead: await convertLead(contextFrom(c), c.req.param("id")) }))

  /* ---------------------------------------------------------------- fluxos */
  .get("/flows", async (c) => c.json({ flows: Object.values(FLOWS), openCounts: await flowCounts(contextFrom(c)) }))
  .get("/flows/:flow/cards", async (c) => c.json({ cards: await listCards(contextFrom(c), c.req.param("flow")) }))
  .get("/flows/:flow/options", async (c) => c.json({ options: await flowOptions(contextFrom(c), c.req.param("flow")) }))
  .get("/renewal-queue", async (c) => c.json({ queue: await renewalQueue(contextFrom(c)) }))
  .post("/flows/:flow/cards", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ data: z.record(z.string(), z.unknown()) }));
    if (error) return error;
    return c.json({ card: await createCard(contextFrom(c), c.req.param("flow"), data.data) }, 201);
  })
  .get("/cards/:id", async (c) => c.json(await cardDetail(contextFrom(c), c.req.param("id"))))
  .patch("/cards/:id", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ data: z.record(z.string(), z.unknown()) }));
    if (error) return error;
    return c.json({ card: await updateCard(contextFrom(c), c.req.param("id"), data.data) });
  })
  .post("/cards/:id/move", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, z.object({ to: z.string(), note: z.string().optional() }));
    if (error) return error;
    return c.json({ card: await moveCard(contextFrom(c), c.req.param("id"), data.to, data.note) });
  });
