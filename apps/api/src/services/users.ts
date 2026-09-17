import {
  and,
  asc,
  authUser,
  desc,
  eq,
  gt,
  invitation,
  isNull,
  membership,
  person,
  sql,
  student,
  teacher,
  tenant,
  type AreaAccessMap,
  type Database,
} from "@classa/db";
import { AREAS, PROFILE_TYPES, type ProfileType } from "@classa/domain";
import { audit } from "../http/audit.ts";
import { conflict, DomainError, invalid, notFound, unprocessable } from "../http/errors.ts";
import type { ServiceContext } from "./context.ts";

export type AccessInput = { profileType: ProfileType; level: number; areas: AreaAccessMap };

const INVITE_HOURS = 48;

function normalizeAccess(input: AccessInput): AccessInput {
  if (!PROFILE_TYPES.includes(input.profileType)) throw invalid("profileType", "Tipo de perfil inválido");
  if (input.profileType === "admin") return { profileType: "admin", level: 1, areas: {} };
  if (input.profileType === "aluno") return { profileType: "aluno", level: 5, areas: {} };
  if (input.profileType === "prestador") return { profileType: "prestador", level: 4, areas: {} };
  if (!Number.isInteger(input.level) || input.level < 1 || input.level > 5) throw invalid("level", "Nível de 1 a 5");
  const areas: AreaAccessMap = {};
  for (const [k, v] of Object.entries(input.areas ?? {})) {
    if (!(AREAS as readonly string[]).includes(k)) throw invalid("areas", "Área inválida");
    if (v !== "total" && v !== "restrito") continue;
    areas[k as keyof AreaAccessMap] = v;
  }
  if (Object.keys(areas).length === 0) throw invalid("areas", "Escolha ao menos uma área");
  return { profileType: "colaborador", level: input.level, areas };
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* --------------------------------------------------------------- equipe */

export async function listMembers(ctx: ServiceContext) {
  const members = await ctx.db
    .select({
      id: membership.id,
      userId: membership.userId,
      name: authUser.name,
      email: authUser.email,
      profileType: membership.profileType,
      level: membership.level,
      areas: membership.areas,
      personId: membership.personId,
      personName: person.name,
      status: membership.status,
      createdAt: membership.createdAt,
      lastSeenAt: sql<string | null>`(select max(s.updated_at) from auth_session s where s.user_id = ${membership.userId})`,
    })
    .from(membership)
    .innerJoin(authUser, eq(authUser.id, membership.userId))
    .leftJoin(person, eq(person.id, membership.personId))
    .where(and(eq(membership.tenantId, ctx.tenantId), isNull(membership.deactivatedAt)))
    .orderBy(asc(authUser.name));
  const invites = await ctx.db
    .select({
      id: invitation.id,
      email: invitation.email,
      profileType: invitation.profileType,
      level: invitation.level,
      areas: invitation.areas,
      personId: invitation.personId,
      personName: person.name,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .leftJoin(person, eq(person.id, invitation.personId))
    .where(and(eq(invitation.tenantId, ctx.tenantId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
    .orderBy(desc(invitation.createdAt));
  return { members, invites: invites.map((i) => ({ ...i, expired: i.expiresAt <= ctx.now })) };
}

async function activeAdmins(ctx: ServiceContext) {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(membership)
    .where(and(eq(membership.tenantId, ctx.tenantId), eq(membership.profileType, "admin"), eq(membership.status, "ativo"), isNull(membership.deactivatedAt)));
  return row?.n ?? 0;
}

async function getMember(ctx: ServiceContext, id: string) {
  const [m] = await ctx.db.select().from(membership).where(and(eq(membership.id, id), eq(membership.tenantId, ctx.tenantId)));
  if (!m) throw notFound("Usuário");
  return m;
}

/** Governança: ninguém altera o próprio acesso; o último administrador não é rebaixado nem bloqueado. */
async function guard(ctx: ServiceContext, m: typeof membership.$inferSelect, next: { profileType?: ProfileType; status?: string }) {
  if (m.userId === ctx.actorId) throw unprocessable("Ninguém altera o próprio acesso. Peça a outro administrador.");
  const losesAdmin = m.profileType === "admin" && m.status === "ativo" && ((next.profileType && next.profileType !== "admin") || next.status === "bloqueado");
  if (losesAdmin && (await activeAdmins(ctx)) <= 1) throw unprocessable("A escola precisa de pelo menos um administrador ativo.");
}

export async function updateMemberAccess(ctx: ServiceContext, id: string, input: AccessInput & { personId?: string | null }) {
  const m = await getMember(ctx, id);
  const access = normalizeAccess(input);
  await guard(ctx, m, { profileType: access.profileType });
  const [row] = await ctx.db
    .update(membership)
    .set({ ...access, ...(input.personId !== undefined ? { personId: input.personId } : {}) })
    .where(eq(membership.id, id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "membership", entityId: id, action: "update", before: m, after: row });
  return row!;
}

export async function setMemberBlocked(ctx: ServiceContext, id: string, blocked: boolean) {
  const m = await getMember(ctx, id);
  await guard(ctx, m, { status: blocked ? "bloqueado" : "ativo" });
  const [row] = await ctx.db
    .update(membership)
    .set({ status: blocked ? "bloqueado" : "ativo" })
    .where(eq(membership.id, id))
    .returning();
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "membership", entityId: id, action: blocked ? "deactivate" : "reactivate", before: m, after: row });
  return row!;
}

/* ------------------------------------------------------------- convites */

/**
 * Convida uma pessoa. Devolve o link com o token (só nesta resposta; o banco guarda o hash).
 * Professor e aluno são ligados à pessoa cadastrada para o escopo "próprio".
 */
export async function createInvitation(ctx: ServiceContext, input: AccessInput & { email?: string | null; personId?: string | null }, baseUrl: string) {
  const access = normalizeAccess(input);
  let email = input.email?.trim().toLowerCase() || null;
  let personId = input.personId ?? null;
  if (personId) {
    const [p] = await ctx.db.select().from(person).where(and(eq(person.id, personId), eq(person.tenantId, ctx.tenantId)));
    if (!p) throw invalid("personId", "Pessoa não encontrada");
    email = email ?? p.email;
    if (access.profileType === "prestador") {
      const [t] = await ctx.db.select({ id: teacher.id }).from(teacher).where(eq(teacher.personId, p.id));
      if (!t) throw invalid("personId", "Esta pessoa não é professor.");
    }
    if (access.profileType === "aluno") {
      const [s] = await ctx.db.select({ id: student.id }).from(student).where(eq(student.personId, p.id));
      if (!s) throw invalid("personId", "Esta pessoa não é aluno.");
    }
  } else if (access.profileType === "prestador" || access.profileType === "aluno") {
    throw invalid("personId", "Escolha o professor ou aluno cadastrado que vai receber o acesso.");
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid("email", "Informe um e-mail válido");

  const [already] = await ctx.db
    .select({ id: membership.id })
    .from(membership)
    .innerJoin(authUser, eq(authUser.id, membership.userId))
    .where(and(eq(membership.tenantId, ctx.tenantId), sql`lower(${authUser.email}) = ${email}`, isNull(membership.deactivatedAt)));
  if (already) throw conflict("email", "Este e-mail já tem acesso à escola. Edite o perfil em vez de convidar de novo.");

  const token = randomToken();
  const [row] = await ctx.db.transaction(async (tx) => {
    // um convite aberto por e-mail: o anterior é revogado
    await tx
      .update(invitation)
      .set({ revokedAt: ctx.now })
      .where(and(eq(invitation.tenantId, ctx.tenantId), eq(invitation.email, email!), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)));
    const inserted = await tx
      .insert(invitation)
      .values({
        tenantId: ctx.tenantId,
        email: email!,
        personId,
        ...access,
        tokenHash: await sha256(token),
        expiresAt: new Date(ctx.now.getTime() + INVITE_HOURS * 3600_000),
        createdBy: ctx.actorId,
      })
      .returning();
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "invitation", entityId: inserted[0]!.id, action: "create", after: { ...inserted[0], tokenHash: undefined } });
    return inserted;
  });
  return { invitation: { ...row!, tokenHash: undefined }, link: `${baseUrl.replace(/\/$/, "")}/convite/${token}` };
}

export async function revokeInvitation(ctx: ServiceContext, id: string) {
  const [row] = await ctx.db
    .update(invitation)
    .set({ revokedAt: ctx.now })
    .where(and(eq(invitation.id, id), eq(invitation.tenantId, ctx.tenantId), isNull(invitation.acceptedAt)))
    .returning();
  if (!row) throw notFound("Convite");
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "invitation", entityId: id, action: "cancel", after: { email: row.email } });
  return row;
}

async function findOpenInvitation(db: Database, token: string, now: Date) {
  const [row] = await db
    .select({ invitation, tenantName: tenant.name, tenantSlug: tenant.slug })
    .from(invitation)
    .innerJoin(tenant, eq(tenant.id, invitation.tenantId))
    .where(eq(invitation.tokenHash, await sha256(token)));
  if (!row) throw new DomainError(404, "not_found", "Convite não encontrado.");
  if (row.invitation.revokedAt) throw new DomainError(410, "revoked", "Este convite foi cancelado. Peça um novo à escola.");
  if (row.invitation.acceptedAt) throw new DomainError(410, "accepted", "Este convite já foi usado. Entre com seu e-mail e senha.");
  if (row.invitation.expiresAt <= now) throw new DomainError(410, "expired", "Este convite expirou. Peça um novo à escola.");
  return row;
}

/** Dados públicos do convite, para a tela de aceite. */
export async function describeInvitation(db: Database, token: string, now = new Date()) {
  const { invitation: inv, tenantName } = await findOpenInvitation(db, token, now);
  const [account] = await db.select({ id: authUser.id }).from(authUser).where(sql`lower(${authUser.email}) = ${inv.email}`);
  return { schoolName: tenantName, email: inv.email, profileType: inv.profileType, hasAccount: !!account, expiresAt: inv.expiresAt };
}

/** Aceite: o usuário logado precisa ter o mesmo e-mail do convite. */
export async function acceptInvitation(db: Database, token: string, user: { id: string; email: string }, now = new Date()) {
  const { invitation: inv, tenantSlug } = await findOpenInvitation(db, token, now);
  if (user.email.toLowerCase() !== inv.email) throw new DomainError(403, "forbidden", `Este convite é para ${inv.email}. Entre com esse e-mail.`);
  return db.transaction(async (tx) => {
    const values = { profileType: inv.profileType, level: inv.level, areas: inv.areas, personId: inv.personId, status: "ativo" as const, deactivatedAt: null };
    const [m] = await tx
      .insert(membership)
      .values({ tenantId: inv.tenantId, userId: user.id, role: "admin", ...values })
      .onConflictDoUpdate({ target: [membership.tenantId, membership.userId], set: values })
      .returning();
    await tx.update(invitation).set({ acceptedAt: now, acceptedUserId: user.id }).where(eq(invitation.id, inv.id));
    await audit(tx, { tenantId: inv.tenantId, actorId: user.id, entity: "invitation", entityId: inv.id, action: "transition", after: { aceito: true, membershipId: m!.id } });
    return { slug: tenantSlug, membership: m! };
  });
}

/** Há convite aberto para este e-mail? (libera o cadastro mesmo com a lista de e-mails ativa) */
export async function hasOpenInvitation(db: Database, email: string, now = new Date()) {
  const [row] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(and(eq(invitation.email, email.toLowerCase()), isNull(invitation.acceptedAt), isNull(invitation.revokedAt), gt(invitation.expiresAt, now)))
    .limit(1);
  return !!row;
}
