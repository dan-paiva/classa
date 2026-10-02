-- Tipos de curso viram regra (DOMINIO.md §4.1): regular, open_entry e particular (private).
-- O regime da turma e da matrícula passa a ser sempre o tipo do curso.
--
-- Cursos que já existem: particular continua particular; um curso cujas turmas e
-- matrículas são todas open-entry vira open_entry; o resto vira regular. Curso que
-- já misturava regimes vira regular e mantém as turmas e matrículas como estão —
-- as regras novas valem para o que for criado daqui em diante.
UPDATE "course" c SET "type" = CASE
  WHEN c."type" = 'particular' THEN 'particular'
  WHEN (
    EXISTS (SELECT 1 FROM "class_group" g WHERE g."course_id" = c."id" AND g."regime" = 'open_entry')
    OR EXISTS (SELECT 1 FROM "enrollment" e WHERE e."course_id" = c."id" AND e."regime" = 'open_entry')
  )
  AND NOT EXISTS (SELECT 1 FROM "class_group" g WHERE g."course_id" = c."id" AND g."regime" <> 'open_entry')
  AND NOT EXISTS (SELECT 1 FROM "enrollment" e WHERE e."course_id" = c."id" AND e."regime" <> 'open_entry' AND NOT e."level_pending")
  THEN 'open_entry'
  ELSE 'regular'
END;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_type_valid" CHECK ("course"."type" in ('regular', 'open_entry', 'particular'));--> statement-breakpoint

-- Aula private de bônus pelas presenças no open entry (DOMINIO.md §5.9.1).
CREATE TABLE "bonus_lesson" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"milestone" integer NOT NULL,
	"every" integer NOT NULL,
	"enrollment_id" uuid,
	"credit_entry_id" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bonus_lesson_student_milestone_uq" UNIQUE("student_id","milestone")
);--> statement-breakpoint
ALTER TABLE "bonus_lesson" ADD CONSTRAINT "bonus_lesson_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_lesson" ADD CONSTRAINT "bonus_lesson_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_lesson" ADD CONSTRAINT "bonus_lesson_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_lesson" ADD CONSTRAINT "bonus_lesson_credit_entry_id_credit_entry_id_fk" FOREIGN KEY ("credit_entry_id") REFERENCES "public"."credit_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bonus_lesson_student_idx" ON "bonus_lesson" USING btree ("student_id");--> statement-breakpoint

-- As escolas que já usam o Classa ganham a regra da aula bônus ligada (5 presenças = 1 aula
-- private). Dá para mudar ou desligar em Configurações.
UPDATE "tenant" SET "settings" = "settings" || '{"bonus": {"enabled": true, "every": 5}}'::jsonb WHERE NOT ("settings" ? 'bonus');
