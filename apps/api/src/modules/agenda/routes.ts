import { AGENDA_EVENT_KINDS } from "@classa/db";
import { parseSchoolInstant } from "@classa/domain";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { DomainError, invalid } from "../../http/errors.ts";
import { uuid } from "../../http/query.ts";
import { hasPermission } from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import {
  AGENDA_ITEM_TYPES,
  agendaItems,
  agendaPeople,
  cancelEvent,
  createEvent,
  eventDetail,
  getEventRow,
  markNoShow,
  recordLevelingResult,
  updateEvent,
  type AgendaScope,
} from "../../services/agenda.ts";
import { contextFrom } from "../../services/context.ts";
import { markUnfinishedLessons } from "../../services/lessons.ts";

// sem fuso, é hora da escola; convertido no handler, que conhece o fuso
const instant = z.string({ error: "Informe data e hora" }).refine((s) => !!parseSchoolInstant(s, "UTC"), "Data e hora inválidas");

const eventInput = z.object({
  kind: z.enum(AGENDA_EVENT_KINDS, { error: "Escolha o tipo" }),
  title: z.string({ error: "Informe o título" }),
  startsAt: instant,
  endsAt: instant,
  location: z.string().nullish(),
  notes: z.string().nullish(),
  participantIds: z.array(uuid).optional(),
  evaluatedPersonId: uuid.nullish(),
  evaluatorPersonId: uuid.nullish(),
  courseId: uuid.nullish(),
  force: z.boolean().optional(),
});

const withInstants = <T extends { startsAt: string; endsAt: string }>(tz: string, d: T) => ({
  ...d,
  startsAt: parseSchoolInstant(d.startsAt, tz)!,
  endsAt: parseSchoolInstant(d.endsAt, tz)!,
});

const forbidden = () => new DomainError(403, "forbidden", "Seu perfil não permite esta ação.");

function parseRange(from?: string, to?: string) {
  const f = from ? new Date(from) : new Date(Date.now() - 86400_000);
  const t = to ? new Date(to) : new Date(f.getTime() + 7 * 86400_000);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw invalid("from", "Período inválido");
  if (t.getTime() - f.getTime() > 62 * 86400_000) throw invalid("to", "Período de no máximo 62 dias");
  return { from: f, to: t };
}

/** Quem está olhando decide o que a agenda mostra (DOMINIO.md §5.10). */
function scopeOf(c: { var: AppEnv["Variables"] }): AgendaScope {
  const t = c.var.tenant;
  if (t.profileType === "aluno") {
    if (!t.studentId || !t.personId) throw new DomainError(404, "not_found", "Seu usuário não está ligado a um aluno desta escola.");
    return { kind: "aluno", studentId: t.studentId, personId: t.personId };
  }
  if (t.profileType === "prestador") {
    if (!t.teacherId) throw new DomainError(404, "not_found", "Seu usuário não está ligado a um professor desta escola.");
    return { kind: "professor", teacherId: t.teacherId, personId: t.personId };
  }
  if (!hasPermission(c, "agenda", "ver")) throw forbidden();
  return { kind: "equipe" };
}

/** Autor do evento pode editar e excluir o que criou, mesmo sem o nível (§5.8). */
async function authorOr(c: { var: AppEnv["Variables"] }, id: string, action: "editar" | "inativar") {
  const e = await getEventRow(contextFrom(c as Context<AppEnv>), id);
  if (hasPermission(c, "eventos", action)) return e;
  if (c.var.user && e.createdBy === c.var.user.id) return e;
  throw forbidden();
}

export const agendaRoutes = new Hono<AppEnv>()
  .get("/agenda", async (c) => {
    const scope = scopeOf(c);
    const ctx = contextFrom(c);
    await markUnfinishedLessons(ctx);
    const q = (k: string) => c.req.query(k) || undefined;
    const type = q("type");
    if (type && !(AGENDA_ITEM_TYPES as readonly string[]).includes(type)) throw invalid("type", "Tipo inválido");
    const personId = q("personId") === "me" ? c.var.tenant.personId ?? undefined : q("personId");
    if (q("personId") === "me" && !personId) return c.json({ items: [] });
    const items = await agendaItems(
      ctx,
      {
        ...parseRange(q("from"), q("to")),
        type: type as (typeof AGENDA_ITEM_TYPES)[number] | undefined,
        teacherId: q("teacherId"),
        roomId: q("roomId"),
        classGroupId: q("classGroupId"),
        courseId: q("courseId"),
        moduleId: q("moduleId"),
        personId,
        openSlots: q("openSlots") === "1",
      },
      scope,
    );
    return c.json({ items });
  })

  .get("/agenda/people", async (c) => {
    if (!hasPermission(c, "eventos", "ver")) throw forbidden();
    return c.json({ people: await agendaPeople(contextFrom(c)) });
  })

  .post("/events", async (c) => {
    if (!hasPermission(c, "eventos", "operar")) throw forbidden();
    const { data, error } = await parseBody(c, eventInput);
    if (error) return error;
    const ctx = contextFrom(c);
    return c.json({ event: await createEvent(ctx, withInstants(ctx.timezone, data)) }, 201);
  })

  .get("/events/:id", async (c) => {
    const ctx = contextFrom(c);
    const detail = await eventDetail(ctx, c.req.param("id"));
    const me = c.var.tenant.personId;
    const isParticipant = !!me && detail.participants.some((p) => p.id === me);
    if (!isParticipant && !(c.var.tenant.profileType !== "aluno" && c.var.tenant.profileType !== "prestador" && hasPermission(c, "agenda", "ver"))) {
      throw new DomainError(404, "not_found", "Evento não encontrado.");
    }
    const canEdit = hasPermission(c, "eventos", "editar") || detail.event.createdBy === c.var.user?.id;
    const canCancel = hasPermission(c, "eventos", "inativar") || detail.event.createdBy === c.var.user?.id;
    const canRecord = detail.event.kind === "nivelamento" && (hasPermission(c, "eventos", "operar") || (!!me && me === detail.event.evaluatorPersonId));
    return c.json({ ...detail, can: { edit: canEdit, cancel: canCancel, record: canRecord } });
  })

  .patch("/events/:id", async (c) => {
    await authorOr(c, c.req.param("id"), "editar");
    const { data, error } = await parseBody(c, eventInput);
    if (error) return error;
    const ctx = contextFrom(c);
    return c.json({ event: await updateEvent(ctx, c.req.param("id"), withInstants(ctx.timezone, data)) });
  })

  .post("/events/:id/cancel", async (c) => {
    await authorOr(c, c.req.param("id"), "inativar");
    const { data, error } = await parseBody(c, z.object({ reason: z.string({ error: "Informe o motivo" }) }));
    if (error) return error;
    return c.json({ event: await cancelEvent(contextFrom(c), c.req.param("id"), data.reason) });
  })

  // resultado e falta: quem opera eventos, ou o próprio avaliador (que pode ser professor)
  .post("/events/:id/result", async (c) => {
    const ctx = contextFrom(c);
    const e = await getEventRow(ctx, c.req.param("id"));
    const me = c.var.tenant.personId;
    if (!hasPermission(c, "eventos", "operar") && !(me && me === e.evaluatorPersonId)) throw forbidden();
    const { data, error } = await parseBody(c, z.object({ suggestedModuleId: uuid, resultNotes: z.string().nullish() }));
    if (error) return error;
    return c.json({ event: await recordLevelingResult(ctx, e.id, data) });
  })

  .post("/events/:id/no-show", async (c) => {
    const ctx = contextFrom(c);
    const e = await getEventRow(ctx, c.req.param("id"));
    const me = c.var.tenant.personId;
    if (!hasPermission(c, "eventos", "operar") && !(me && me === e.evaluatorPersonId)) throw forbidden();
    return c.json({ event: await markNoShow(ctx, e.id) });
  });
