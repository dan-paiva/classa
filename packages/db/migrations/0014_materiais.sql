-- Material pedagógico e entrega no pós-venda (DOMINIO.md §4.5 e §7.5.1).
CREATE TABLE "course_material" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "course_id" uuid NOT NULL REFERENCES "course"("id"),
  "module_id" uuid REFERENCES "course_module"("id"),
  "title" text NOT NULL,
  "url" text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "course_material_course_idx" ON "course_material" USING btree ("tenant_id", "course_id");
--> statement-breakpoint
CREATE TABLE "material_delivery" (
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrollment_id" uuid NOT NULL REFERENCES "enrollment"("id"),
  "material_id" uuid NOT NULL REFERENCES "course_material"("id"),
  "delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "delivered_by" text,
  CONSTRAINT "material_delivery_enrollment_id_material_id_pk" PRIMARY KEY ("enrollment_id", "material_id")
);
