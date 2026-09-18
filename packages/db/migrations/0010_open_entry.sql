-- Open-entry (DOMINIO.md §5.9), item 12 da ordem de construção.

-- 1. Regime da turma. `individual` passa a ser derivada dele: as duas não podem
--    mais divergir, e quem lê `individual` (folha, telas) continua lendo igual.
ALTER TABLE "class_group" ADD COLUMN "regime" text DEFAULT 'regular' NOT NULL;
--> statement-breakpoint
UPDATE "class_group" SET "regime" = 'particular' WHERE "individual";
--> statement-breakpoint
ALTER TABLE "class_group" DROP COLUMN "individual";
--> statement-breakpoint
ALTER TABLE "class_group" ADD COLUMN "individual" boolean NOT NULL GENERATED ALWAYS AS ("regime" = 'particular') STORED;
--> statement-breakpoint
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_particular_capacity" CHECK ("regime" <> 'particular' OR "capacity" = 1);
--> statement-breakpoint
CREATE INDEX "class_group_open_entry_idx" ON "class_group" USING btree ("tenant_id", "module_id") WHERE "regime" = 'open_entry';
--> statement-breakpoint

-- 2. Regime da matrícula. No open-entry não há turma e o módulo é o nível do aluno.
ALTER TABLE "enrollment" ADD COLUMN "regime" text DEFAULT 'regular' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "module_id" uuid REFERENCES "course_module"("id");
--> statement-breakpoint

--    o regime e o nível saem da turma em que a matrícula já está
UPDATE "enrollment" e
SET "regime" = cg."regime", "module_id" = cg."module_id"
FROM "class_group" cg
WHERE cg."id" = e."class_group_id";
--> statement-breakpoint

ALTER TABLE "enrollment" ALTER COLUMN "class_group_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_regime_shape" CHECK (
  ("regime" = 'open_entry' AND "class_group_id" IS NULL AND "module_id" IS NOT NULL)
  OR ("regime" <> 'open_entry' AND "class_group_id" IS NOT NULL)
);
