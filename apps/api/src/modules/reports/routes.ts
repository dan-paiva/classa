import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalid } from "../../http/errors.ts";
import { authorize, hasPermission } from "../../http/require-tenant.ts";
import { contextFrom } from "../../services/context.ts";
import { alerts, attendanceReport, enrollmentReport, financeReport, teacherReport } from "../../services/reports.ts";

const isDay = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Período pedido na query, limitado a um ano para não varrer a base inteira. */
function range(c: { req: { query: (k: string) => string | undefined } }) {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!isDay(from) || !isDay(to)) throw invalid("periodo", "Informe o período no formato AAAA-MM-DD.");
  if (to < from) throw invalid("to", "A data final é anterior à inicial.");
  if (Date.parse(to) - Date.parse(from) > 366 * 86400_000) throw invalid("periodo", "O período não pode passar de um ano.");
  return { from, to };
}

const months = (c: { req: { query: (k: string) => string | undefined } }) => Math.min(24, Math.max(1, Number(c.req.query("months") ?? 6) || 6));

export const reportRoutes = new Hono<AppEnv>()

  .get("/alerts", authorize("relatorios", "ver"), async (c) =>
    c.json({ alerts: await alerts(contextFrom(c), (resource) => hasPermission(c, resource, "ver")) }),
  )

  .get("/reports/financeiro", authorize("financeiro", "ver"), async (c) => c.json(await financeReport(contextFrom(c), months(c))))

  .get("/reports/frequencia", authorize("turmas", "ver"), async (c) => c.json(await attendanceReport(contextFrom(c), range(c))))

  .get("/reports/professores", authorize("professores", "ver"), async (c) =>
    c.json(await teacherReport(contextFrom(c), range(c), hasPermission(c, "folha", "ver"))),
  )

  .get("/reports/matriculas", authorize("alunos", "ver"), async (c) => c.json(await enrollmentReport(contextFrom(c), months(c))));
