import { and, asc, bonusLesson, creditEntry, desc, enrollment, eq, isNull, lesson, lessonStudent, sql } from "@classa/db";
import { bonusLessonsEarned, DEFAULT_BONUS_RULE, type BonusRule } from "@classa/domain";
import { audit } from "../http/audit.ts";
import type { Db, ServiceContext, Tx } from "./context.ts";

/**
 * Aula private de bônus (DOMINIO.md §5.9.1): a cada N presenças em aula open entry
 * o aluno ganha uma aula private. O bônus é conquistado quando a aula é concluída
 * com o aluno presente, e vira crédito na matrícula private ativa dele. Sem
 * matrícula private, fica guardado e entra quando ela for criada.
 *
 * Conceder é idempotente: o número de bônus é sempre `presenças ÷ N`, e o único
 * por aluno e ordem impede repetir. Corrigir uma presença depois não retira um
 * bônus já ganho.
 */

export const bonusRule = (ctx: ServiceContext): BonusRule => ctx.settings.bonus ?? DEFAULT_BONUS_RULE;

/** Presenças do aluno em aulas open entry já concluídas. */
async function openEntryPresences(db: Db, studentId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lessonStudent)
    .innerJoin(enrollment, eq(enrollment.id, lessonStudent.enrollmentId))
    .innerJoin(lesson, eq(lesson.id, lessonStudent.lessonId))
    .where(
      and(
        eq(lessonStudent.studentId, studentId),
        eq(lessonStudent.status, "presente"),
        eq(enrollment.regime, "open_entry"),
        eq(lesson.state, "concluida"),
      ),
    );
  return row?.n ?? 0;
}

/** Concede os bônus que as presenças já garantem e aplica os pendentes. */
export async function grantBonusTx(tx: Tx, ctx: ServiceContext, studentId: string) {
  const rule = bonusRule(ctx);
  if (!rule.enabled) return 0;
  const earned = bonusLessonsEarned(await openEntryPresences(tx, studentId), rule);
  const [last] = await tx
    .select({ milestone: bonusLesson.milestone })
    .from(bonusLesson)
    .where(eq(bonusLesson.studentId, studentId))
    .orderBy(desc(bonusLesson.milestone))
    .limit(1);
  const from = (last?.milestone ?? 0) + 1;
  if (earned < from) return 0;
  const rows = [];
  for (let milestone = from; milestone <= earned; milestone++) {
    rows.push({ tenantId: ctx.tenantId, studentId, milestone, every: rule.every });
  }
  const created = await tx.insert(bonusLesson).values(rows).onConflictDoNothing().returning();
  for (const b of created) {
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "bonus_lesson", entityId: b.id, action: "create", after: b });
  }
  await applyPendingBonusTx(tx, ctx, studentId);
  return created.length;
}

/** Leva os bônus pendentes para a matrícula private ativa mais recente do aluno. */
export async function applyPendingBonusTx(tx: Tx, ctx: ServiceContext, studentId: string) {
  const pending = await tx
    .select()
    .from(bonusLesson)
    .where(and(eq(bonusLesson.studentId, studentId), isNull(bonusLesson.enrollmentId)))
    .orderBy(asc(bonusLesson.milestone));
  if (!pending.length) return 0;
  const [target] = await tx
    .select({ id: enrollment.id })
    .from(enrollment)
    .where(
      and(
        eq(enrollment.studentId, studentId),
        eq(enrollment.regime, "particular"),
        isNull(enrollment.endedAt),
        eq(enrollment.levelPending, false),
      ),
    )
    .orderBy(desc(enrollment.startsOn))
    .limit(1);
  if (!target) return 0;
  for (const b of pending) {
    const [credit] = await tx
      .insert(creditEntry)
      .values({
        tenantId: ctx.tenantId,
        enrollmentId: target.id,
        kind: "bonus",
        amount: 1,
        justification: `Aula private bônus: ${b.milestone * b.every} presenças no open entry`,
        actorId: ctx.actorId,
      })
      .returning();
    const [row] = await tx
      .update(bonusLesson)
      .set({ enrollmentId: target.id, creditEntryId: credit!.id, appliedAt: ctx.now })
      .where(eq(bonusLesson.id, b.id))
      .returning();
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, entity: "bonus_lesson", entityId: b.id, action: "update", before: b, after: row });
  }
  return pending.length;
}

/** O que o aluno já ganhou e quanto falta para o próximo bônus. */
export async function bonusSummary(ctx: ServiceContext, studentId: string) {
  const rule = bonusRule(ctx);
  const presences = await openEntryPresences(ctx.db, studentId);
  const rows = await ctx.db.select().from(bonusLesson).where(eq(bonusLesson.studentId, studentId)).orderBy(asc(bonusLesson.milestone));
  const applied = rows.filter((r) => r.enrollmentId).length;
  return {
    rule,
    presences,
    earned: rows.length,
    applied,
    pending: rows.length - applied,
    /** Presenças que faltam para o próximo bônus; `null` com a regra desligada. */
    nextIn: rule.enabled && rule.every > 0 ? rule.every - (presences % rule.every) : null,
  };
}
