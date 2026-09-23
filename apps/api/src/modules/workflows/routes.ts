import { FLOWS, flowAreas, LEAD_LOST_REASONS, nextStage, stageArea, type Area, type FlowDefinition, type FlowKey } from "@classa/domain";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { DomainError } from "../../http/errors.ts";
import { isoDate, uuid } from "../../http/query.ts";
import {authorize, hasPermission} from "../../http/require-tenant.ts";
import type { Context } from "hono";
import { parseBody } from "../../http/validation.ts";
import { contextFrom } from "../../services/context.ts";
import {
  cardDetail,
  convertLead,
  createCard,
  createLead,
  entryNoShow,
  flowCounts,
  flowOptions,
  listCards,
  listLeads,
  moveCard,
  moveLead,
  renewalQueue,
  updateCard,
  updateLead,
  visitedStages,
} from "../../services/workflows.ts";

const leadInput = z.object({
  name: z.string({ error: "Informe o nome" }),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  cpf: z.string().nullish(),
  origin: z.string({ error: "Escolha a origem" }),
  campaign: z.string().nullish(),
  courseId: uuid.nullish(),
  temperature: z.enum(["frio", "morno", "quente"]).nullish(),
  nextAction: z.string().nullish(),
  nextActionOn: isoDate.nullish(),
  consent: z.boolean().optional(),
});

/**
 * Fluxo em kanban: a permissão vem da área da **etapa** (DOMINIO.md §7.5).
 * - vê o card quem é da área da etapa atual, de uma etapa por onde ele já
 *   passou (para responder ao aluno) ou da próxima etapa (é quem vai puxá-lo);
 * - opera (edita os campos) quem é da área da etapa atual ou da próxima;
 * - move para qualquer etapa quem é da área da etapa atual; a área da próxima
 *   só puxa para a etapa dela; e a área de uma etapa alternativa (ex.: Perdido,
 *   do comercial) manda o card para ela a qualquer momento.
 * Fluxo de área única cai no caso de sempre: tudo pela área do fluxo.
 */
type Env = { var: AppEnv["Variables"] };
const areaCan = (c: Env, area: Area, action: "ver" | "operar") => hasPermission(c, `fluxo:${area}`, action);

function flowDef(flow: string): FlowDefinition {
  const def = FLOWS[flow as FlowKey];
  if (!def) throw new DomainError(404, "not_found", "Fluxo inexistente.");
  return def;
}
const canSeeFlow = (c: Env, def: FlowDefinition) => flowAreas(def).some((a) => areaCan(c, a, "ver"));

type CardLike = { flow: string; stage: string; visited?: string[] };
function cardAccess(c: Env, card: CardLike) {
  const def = flowDef(card.flow);
  const current = stageArea(def, card.stage);
  const next = nextStage(def, card.stage);
  const nextArea = next ? stageArea(def, next.key) : null;
  const seen = [current, ...(nextArea ? [nextArea] : []), ...(card.visited ?? []).map((s) => stageArea(def, s))];
  const owner = areaCan(c, current, "operar");
  const puller = !!nextArea && areaCan(c, nextArea, "operar");
  const moveTo = (to: string) => {
    if (owner) return true;
    if (puller && to === next!.key) return true;
    const target = def.stages.find((s) => s.key === to);
    return !!target?.alternative && areaCan(c, stageArea(def, to), "operar");
  };
  return { def, see: seen.some((a) => areaCan(c, a, "ver")), operate: owner || puller, moveTo };
}
const denied = (c: Context<AppEnv>) => c.json({ error: "forbidden", message: "Seu perfil não acessa este fluxo." }, 403);

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
    const visible = Object.values(FLOWS).filter((f) => canSeeFlow(c, f));
    return c.json({ flows: visible, openCounts: Object.fromEntries(visible.map((f) => [f.key, counts[f.key] ?? 0])) });
  })
  .get("/flows/:flow/cards", async (c) => {
    if (!canSeeFlow(c, flowDef(c.req.param("flow")))) return denied(c);
    const cards = await listCards(contextFrom(c), c.req.param("flow"));
    return c.json({
      cards: cards.flatMap((card) => {
        const a = cardAccess(c, card);
        return a.see ? [{ ...card, canOperate: a.operate }] : [];
      }),
    });
  })
  .get("/flows/:flow/options", async (c) =>
    canSeeFlow(c, flowDef(c.req.param("flow"))) ? c.json({ options: await flowOptions(contextFrom(c), c.req.param("flow")) }) : denied(c),
  )
  .get("/renewal-queue", async (c) => (canSeeFlow(c, FLOWS.renovacao) ? c.json({ queue: await renewalQueue(contextFrom(c)) }) : denied(c)))
  .post("/flows/:flow/cards", async (c) => {
    const def = flowDef(c.req.param("flow"));
    if (!areaCan(c, stageArea(def, def.stages[0]!.key), "operar")) return denied(c);
    const { data, error } = await parseBody(c, z.object({ data: z.record(z.string(), z.unknown()) }));
    if (error) return error;
    return c.json({ card: await createCard(contextFrom(c), def.key, data.data) }, 201);
  })
  .get("/cards/:id", async (c) => {
    const ctx = contextFrom(c);
    const detail = await cardDetail(ctx, c.req.param("id"));
    const a = cardAccess(c, { ...detail.card, visited: detail.transitions.map((t) => t.toStage) });
    return a.see ? c.json({ ...detail, canOperate: a.operate }) : denied(c);
  })
  .patch("/cards/:id", async (c) => {
    const ctx = contextFrom(c);
    const { card } = await cardDetail(ctx, c.req.param("id"));
    if (!cardAccess(c, card).operate) return denied(c);
    const { data, error } = await parseBody(c, z.object({ data: z.record(z.string(), z.unknown()) }));
    if (error) return error;
    return c.json({ card: await updateCard(ctx, c.req.param("id"), data.data) });
  })
  .post("/cards/:id/move", async (c) => {
    const ctx = contextFrom(c);
    const { card } = await cardDetail(ctx, c.req.param("id"));
    const { data, error } = await parseBody(c, z.object({ to: z.string(), note: z.string().optional() }));
    if (error) return error;
    if (!cardAccess(c, { ...card, visited: await visitedStages(ctx, card.id) }).moveTo(data.to)) return denied(c);
    return c.json({ card: await moveCard(ctx, c.req.param("id"), data.to, data.note) });
  })
  // falta no nivelamento é registrada por quem é da área do nivelamento
  .post("/cards/:id/no-show", async (c) => {
    const ctx = contextFrom(c);
    const { card } = await cardDetail(ctx, c.req.param("id"));
    if (card.flow !== "entrada" || !areaCan(c, stageArea(FLOWS.entrada, "marcado"), "operar")) return denied(c);
    return c.json({ card: await entryNoShow(ctx, card.id) });
  });
