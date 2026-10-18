import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { invalid } from "../../http/errors.ts";
import { uuid } from "../../http/query.ts";
import { authorize } from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import { contextFrom } from "../../services/context.ts";
import { createVideoAccount, listVideoAccounts, setRoomAccount, updateVideoAccount, videoOccupancy } from "../../services/video.ts";

const account = z.object({
  name: z.string({ error: "Informe o nome" }),
  login: z.string().nullish(),
  maxConcurrent: z.number().int().optional(),
  bufferMinutes: z.number().int().optional(),
  notes: z.string().nullish(),
});

function idParam(raw: string, what: string) {
  const id = uuid.safeParse(raw);
  if (!id.success) throw invalid("id", `${what} não encontrada`);
  return id.data;
}

/** As contas de videoconferência e a ocupação delas (DOMINIO.md §4.3.1). */
export const videoRoutes = new Hono<AppEnv>()
  .get("/video-accounts", authorize("videoconferencia", "ver"), async (c) => c.json(await listVideoAccounts(contextFrom(c))))

  .post("/video-accounts", authorize("videoconferencia", "editar"), async (c) => {
    const { data, error } = await parseBody(c, account);
    if (error) return error;
    return c.json({ account: await createVideoAccount(contextFrom(c), data) }, 201);
  })

  .patch("/video-accounts/:id", authorize("videoconferencia", "editar"), async (c) => {
    const { data, error } = await parseBody(c, account.extend({ active: z.boolean().optional() }));
    if (error) return error;
    return c.json({ account: await updateVideoAccount(contextFrom(c), idParam(c.req.param("id"), "Conta"), data) });
  })

  .patch("/rooms/:id/video-account", authorize("videoconferencia", "editar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ accountId: z.string().uuid().nullable() }));
    if (error) return error;
    return c.json({ room: await setRoomAccount(contextFrom(c), idParam(c.req.param("id"), "Sala"), data.accountId) });
  })

  .get("/video-occupancy", authorize("videoconferencia", "ver"), async (c) => {
    const from = new Date(c.req.query("from") ?? Date.now());
    const to = new Date(c.req.query("to") ?? from.getTime() + 7 * 86400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw invalid("from", "Período inválido");
    if (to.getTime() - from.getTime() > 31 * 86400_000) throw invalid("to", "Período de no máximo 31 dias");
    return c.json(await videoOccupancy(contextFrom(c), { from, to }));
  });
