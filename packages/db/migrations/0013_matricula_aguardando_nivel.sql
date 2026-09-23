-- Paga antes do nivelamento (DOMINIO.md §7.5.1): a matrícula nasce no fechamento,
-- com contrato e pacote, e só ganha turma ou nível depois do nivelamento.
ALTER TABLE "enrollment" ADD COLUMN "level_pending" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "enrollment" DROP CONSTRAINT "enrollment_regime_shape";
--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_regime_shape" CHECK (
  ("level_pending" AND "class_group_id" IS NULL AND "module_id" IS NULL)
  OR (NOT "level_pending" AND (
    ("regime" = 'open_entry' AND "class_group_id" IS NULL AND "module_id" IS NOT NULL)
    OR ("regime" <> 'open_entry' AND "class_group_id" IS NOT NULL)
  ))
);
