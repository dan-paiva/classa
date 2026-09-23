import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { uuid } from "../../http/query.ts";
import { authorize } from "../../http/require-tenant.ts";
import { parseBody } from "../../http/validation.ts";
import { contextFrom } from "../../services/context.ts";
import { createMaterial, listMaterials, setMaterialActive, updateMaterial } from "../../services/materials.ts";

const materialInput = z.object({
  courseId: uuid,
  moduleId: uuid.nullish(),
  title: z.string({ error: "Informe o título" }),
  url: z.string({ error: "Informe o link" }),
  notes: z.string().nullish(),
});

/** Material do aluno (DOMINIO.md §4.5): o Acadêmico cadastra, o CX entrega. */
export const materialRoutes = new Hono<AppEnv>()
  .get("/materials", authorize("materiais", "ver"), async (c) =>
    c.json({ materials: await listMaterials(contextFrom(c), { courseId: c.req.query("courseId") || undefined }) }),
  )
  .post("/materials", authorize("materiais", "editar"), async (c) => {
    const { data, error } = await parseBody(c, materialInput);
    if (error) return error;
    return c.json({ material: await createMaterial(contextFrom(c), data) }, 201);
  })
  .patch("/materials/:id", authorize("materiais", "editar"), async (c) => {
    const { data, error } = await parseBody(c, materialInput);
    if (error) return error;
    return c.json({ material: await updateMaterial(contextFrom(c), c.req.param("id"), data) });
  })
  .post("/materials/:id/:action{deactivate|reactivate}", authorize("materiais", "inativar"), async (c) =>
    c.json({ material: await setMaterialActive(contextFrom(c), c.req.param("id"), c.req.param("action") === "reactivate") }),
  );
