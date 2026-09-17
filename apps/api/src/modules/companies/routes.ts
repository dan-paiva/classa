import { COMPANY_MODELS, PAYMENT_METHODS } from "@classa/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { isoDate, uuid } from "../../http/query.ts";
import {authorize} from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import {
  companyDetail,
  createCompany,
  generateCharge,
  linkStudent,
  listCompanies,
  payCharge,
  recordReport,
  renewCompany,
  unlinkStudent,
  updateCompany,
} from "../../services/companies.ts";
import { contextFrom } from "../../services/context.ts";

const companyInput = z.object({
  name: z.string({ error: "Informe o nome" }),
  cnpj: z.string().nullish(),
  segment: z.string().nullish(),
  model: z.enum(COMPANY_MODELS, { error: "Escolha o modelo" }),
  hrName: z.string().nullish(),
  hrEmail: z.string().nullish(),
  startsOn: isoDate,
  endsOn: isoDate,
  licenses: z.number({ error: "Informe as licenças" }).int(),
  contractedLessons: z.number().int().min(0).optional(),
  licensePriceCents: z.number({ error: "Informe o valor por licença" }).int().min(0),
  subsidyPercent: z.number().int().optional(),
  discountPercent: z.number().int().optional(),
  autoRenew: z.boolean().optional(),
  allowedCourseIds: z.array(uuid).nullish(),
});

export const companyRoutes = new Hono<AppEnv>()
  .get("/companies", authorize("empresas", "ver"), async (c) => c.json({ companies: await listCompanies(contextFrom(c)) }))
  .get("/companies/:id", authorize("empresas", "ver"), async (c) => c.json(await companyDetail(contextFrom(c), c.req.param("id"))))

  .post("/companies", authorize("empresas", "editar"), async (c) => {
    const { data, error } = await parseBody(c, companyInput);
    if (error) return error;
    return c.json({ company: await createCompany(contextFrom(c), data) }, 201);
  })

  .put("/companies/:id", authorize("empresas", "editar"), async (c) => {
    const { data, error } = await parseBody(c, companyInput);
    if (error) return error;
    return c.json({ company: await updateCompany(contextFrom(c), c.req.param("id"), data) });
  })

  .post("/companies/:id/renew", authorize("empresas", "editar"), async (c) => {
    const { data, error } = await parseBody(
      c,
      z.object({ endsOn: isoDate, licenses: z.number().int().optional(), addLessons: z.number().int().optional(), licensePriceCents: z.number().int().min(0).optional() }),
    );
    if (error) return error;
    return c.json({ company: await renewCompany(contextFrom(c), c.req.param("id"), data) });
  })

  .post("/companies/:id/students", authorize("empresas", "editar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ studentId: uuid }));
    if (error) return error;
    return c.json(await linkStudent(contextFrom(c), c.req.param("id"), data.studentId));
  })

  .delete("/companies/:id/students/:studentId", authorize("empresas", "editar"), async (c) =>
    c.json({ student: await unlinkStudent(contextFrom(c), c.req.param("id"), c.req.param("studentId")) }),
  )

  .post("/companies/:id/charges", authorize("empresas", "editar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ month: z.string() }));
    if (error) return error;
    return c.json({ charge: await generateCharge(contextFrom(c), c.req.param("id"), data.month) }, 201);
  })

  .post("/company-charges/:id/pay", authorize("empresas", "operar"), async (c) => {
    const { data, error } = await parseBody(c, z.object({ method: z.enum(PAYMENT_METHODS), paidOn: isoDate.optional() }));
    if (error) return error;
    return c.json({ charge: await payCharge(contextFrom(c), c.req.param("id"), data) });
  })

  .post("/companies/:id/report", authorize("empresas", "operar"), async (c) => c.json({ company: await recordReport(contextFrom(c), c.req.param("id")) }));
