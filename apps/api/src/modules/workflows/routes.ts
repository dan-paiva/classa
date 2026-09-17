import { FLOWS, LEAD_LOST_REASONS } from "@classa/domain";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { isoDate, uuid } from "../../http/query.ts";
import {authorize, hasPermission} from "../../http/require-tenant.ts";
import { FLOW_AREA, type Resource } from "@classa/domain";
import type { Context } from "hono";
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

/** Fluxo em kanban: a permissão vem da área do fluxo. */
function flowResource(flow: string): Resource {
  return `fluxo:${FLOW_AREA[flow] ?? "adm"}` as Resource;
}
function denyFlow(c: Context<AppEnv>, flow: string, action: "ver" | "operar") {
  return hasPermission(c, flowResource(flow), action) ? null : c.json({ error: "forbidden", message: "Seu perfil não acessa este fluxo." }, 403);
}

export const workflowRoutes = new Hono<AppEnv>()

  /* ----------------------------------------------------------------- leads */
  .get("/leads", authorize("leads", "ver"), async (c) => c.json({ leads: await listLeads(contextFrom(c)) }))
  .post("/leads", authorize("leads", "operar"), async (c) => {
    const { data, error } = await parseBody(c, leadInput);
    if (error) return error;
    return c.json({ lead: await createLead(contextFrom(c), data) }, 201);
  })
  .patch("/leads/:id", authorize("leads", "operar"), async (c) => {
    const { data, error } = await parseBody(c, leadInput.partial());
    if (error) return error;
    return c.json({ lead: await updateLead(contextFrom(c), c.req.param("id"), data) });
  })
  .post("/leads/:id/move", authorize("leads", "operar"), async (c) => {
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
  .post("/leads/:id/convert", authorize("leads", "operar"), async (c) => c.json({ lead: await convertLead(contextFrom(c), c.req.param("id")) }))

  /* ---------------------------------------------------------------- fluxos */
  .get("/flows", async (c) => {
    const counts = await flowCounts(contextFrom(c));
    const visible = Object.values(FLOWS).filter((f) => hasPermission(c, flowResource(f.key), "ver"));
    return c.json({ flows: visible, openCounts: Object.fromEntries(visible.map((f) => [f.key, counts[f.key] ?? 0])) });
  })
  .get("/flows/:flow/cards", async (c) => denyFlow(c, c.req.param("flow"), "ver") ?? c.json({ cards: await listCards(contextFrom(c), c.req.param("flow")) }))
  .get("/flows/:flow/options", async (c) => denyFlow(c, c.req.param("flow"), "ver") ?? c.json({ options: await flowOptions(contextFrom(c), c.req.param("flow")) }))
  .get("/renewal-queue", async (c) => denyFlow(c, "renovacao", "ver") ?? c.json({ queue: await renewalQueue(contextFrom(c)) }))
  .post("/flows/:flow/cards", async (c) => {
    const denied = denyFlow(c, c.req.param("flow"), "operar");
    if (denied) return denied;
    const { data, error } = await parseBody(c, z.object({ data: z.record(z.string(), z.unknown()) }));
    if (error) return error;
    return c.json({ card: await createCard(contextFrom(c), c.req.param("flow"), data.data) }, 201);
  })
  .get("/cards/:id", async (c) => {
    const detail = await cardDetail(contextFrom(c), c.req.param("id"));
    return denyFlow(c, detail.card.flow, "ver") ?? c.json(detail);
  })
  .patch("/cards/:id", async (c) => {
    const { card } = await cardDetail(contextFrom(c), c.req.param("id"));
    const denied = denyFlow(c, card.flow, "operar");
    if (denied) return denied;
    const { data, error } = await parseBody(c, z.object({ data: z.record(z.string(), z.unknown()) }));
    if (error) return error;
    return c.json({ card: await updateCard(contextFrom(c), c.req.param("id"), data.data) });
  })
  .post("/cards/:id/move", async (c) => {
    const { card } = await cardDetail(contextFrom(c), c.req.param("id"));
    const denied = denyFlow(c, card.flow, "operar");
    if (denied) return denied;
    const { data, error } = await parseBody(c, z.object({ to: z.string(), note: z.string().optional() }));
    if (error) return error;
    return c.json({ card: await moveCard(contextFrom(c), c.req.param("id"), data.to, data.note) });
  });
