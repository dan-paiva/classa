import { PROFILE_TYPE_VALUES } from "@classa/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { uuid } from "../../http/query.ts";
import {requireAdmin} from "../../http/require-tenant.ts";
import { requireUser } from "../../http/require-user.ts";
import { parseBody } from "../../http/validation.ts";
import { contextFrom } from "../../services/context.ts";
import {
  acceptInvitation,
  createInvitation,
  describeInvitation,
  listMembers,
  revokeInvitation,
  setMemberBlocked,
  updateMemberAccess,
} from "../../services/users.ts";

const access = z.object({
  profileType: z.enum(PROFILE_TYPE_VALUES, { error: "Escolha o tipo de perfil" }),
  level: z.number().int().default(4),
  areas: z.record(z.string(), z.enum(["total", "restrito"])).default({}),
});

/** Equipe e convites da escola: só o tipo Admin. */
export const userRoutes = new Hono<AppEnv>()
  .get("/users", requireAdmin, async (c) => c.json(await listMembers(contextFrom(c))))
  .post("/invitations", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, access.extend({ email: z.string().nullish(), personId: uuid.nullish() }));
    if (error) return error;
    const origin = c.req.header("origin") ?? new URL(c.req.url).origin;
    return c.json(await createInvitation(contextFrom(c), data, origin), 201);
  })
  .delete("/invitations/:id", requireAdmin, async (c) => c.json({ invitation: await revokeInvitation(contextFrom(c), c.req.param("id")) }))
  .patch("/users/:id", requireAdmin, async (c) => {
    const { data, error } = await parseBody(c, access.extend({ personId: uuid.nullish() }));
    if (error) return error;
    return c.json({ member: await updateMemberAccess(contextFrom(c), c.req.param("id"), data) });
  })
  .post("/users/:id/:action{block|unblock}", requireAdmin, async (c) =>
    c.json({ member: await setMemberBlocked(contextFrom(c), c.req.param("id"), c.req.param("action") === "block") }),
  );

/** Aceite de convite: fora da escola, porque quem aceita ainda não é membro. */
export const invitationRoutes = new Hono<AppEnv>()
  .get("/invitations/:token", async (c) => c.json(await describeInvitation(c.var.db, c.req.param("token"))))
  .post("/invitations/:token/accept", requireUser, async (c) => c.json(await acceptInvitation(c.var.db, c.req.param("token"), c.var.user!)));
