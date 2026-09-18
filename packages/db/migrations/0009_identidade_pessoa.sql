-- Identidade da pessoa (DOMINIO.md §3.1, §3.4 e §6.5), item 11 da ordem de construção.
-- Ordem importa: cria e preenche antes de largar qualquer coluna.

-- 1. E-mails da pessoa em tabela própria.
CREATE TABLE "person_email" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "kind" text NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 2. Traz o que já existe. Tudo entra como pessoal e principal: é o que o
--    cadastro atual significa. Quem for colaborador reclassifica depois, e a
--    troca de tipo não mexe em id nenhum.
INSERT INTO "person_email" ("id", "tenant_id", "person_id", "email", "kind", "is_primary")
SELECT gen_random_uuid(), "tenant_id", "id", lower("email"), 'pessoal', true
FROM "person"
WHERE "email" IS NOT NULL AND btrim("email") <> '';
--> statement-breakpoint

CREATE UNIQUE INDEX "person_email_tenant_email_uq" ON "person_email" USING btree ("tenant_id", lower("email"));
--> statement-breakpoint
ALTER TABLE "person_email" ADD CONSTRAINT "person_email_person_kind_uq" UNIQUE("person_id", "kind");
--> statement-breakpoint
CREATE UNIQUE INDEX "person_email_primary_uq" ON "person_email" USING btree ("person_id") WHERE "is_primary";
--> statement-breakpoint
CREATE INDEX "person_email_person_idx" ON "person_email" USING btree ("person_id");
--> statement-breakpoint

DROP INDEX IF EXISTS "person_tenant_email_uq";
--> statement-breakpoint
ALTER TABLE "person" DROP COLUMN "email";
--> statement-breakpoint

-- 3. O lead passa a apontar para a pessoa, em vez de repetir a ficha dela.
ALTER TABLE "lead" ADD COLUMN "person_id" uuid REFERENCES "person"("id");
--> statement-breakpoint

--    a) lead já convertido: a pessoa é a do aluno.
UPDATE "lead" l
SET "person_id" = s."person_id"
FROM "student" s
WHERE s."id" = l."student_id" AND l."person_id" IS NULL;
--> statement-breakpoint

--    b) lead com e-mail que já é de alguém: é a mesma pessoa.
UPDATE "lead" l
SET "person_id" = pe."person_id"
FROM "person_email" pe
WHERE pe."tenant_id" = l."tenant_id" AND lower(pe."email") = lower(l."email") AND l."person_id" IS NULL;
--> statement-breakpoint

--    c) o resto vira pessoa nova, com os dados que o lead tinha.
WITH novos AS (
  SELECT "id" AS lead_id, gen_random_uuid() AS person_id FROM "lead" WHERE "person_id" IS NULL
), inseridos AS (
  INSERT INTO "person" ("id", "tenant_id", "name", "phone", "created_at", "updated_at")
  SELECT n.person_id, l."tenant_id", l."name", l."phone", l."created_at", l."updated_at"
  FROM novos n JOIN "lead" l ON l."id" = n.lead_id
  RETURNING "id"
)
UPDATE "lead" l SET "person_id" = n.person_id FROM novos n WHERE l."id" = n.lead_id;
--> statement-breakpoint

--    d) e o e-mail que o lead trazia vira e-mail da pessoa nova, quando ninguém mais usa.
INSERT INTO "person_email" ("id", "tenant_id", "person_id", "email", "kind", "is_primary")
SELECT DISTINCT ON (l."tenant_id", lower(l."email"))
  gen_random_uuid(), l."tenant_id", l."person_id", lower(l."email"), 'pessoal', true
FROM "lead" l
WHERE l."email" IS NOT NULL AND btrim(l."email") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "person_email" pe
    WHERE pe."tenant_id" = l."tenant_id" AND lower(pe."email") = lower(l."email")
  )
ORDER BY l."tenant_id", lower(l."email"), l."created_at";
--> statement-breakpoint

ALTER TABLE "lead" ALTER COLUMN "person_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "lead_person_idx" ON "lead" USING btree ("person_id");
--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "name";
--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "email";
--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "phone";
--> statement-breakpoint

-- 4. A mesma pessoa pode ter vínculo de trabalho e de aluno, mas só um de cada.
CREATE UNIQUE INDEX "membership_person_profile_uq" ON "membership" USING btree ("tenant_id", "person_id", "profile_type") WHERE "person_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "membership_person_idx" ON "membership" USING btree ("tenant_id", "person_id");
