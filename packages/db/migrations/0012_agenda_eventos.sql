-- Eventos, reuniões e nivelamentos (DOMINIO.md §5.8), item 13 da ordem de construção.
-- Tabela à parte de `lesson`: a agenda geral (§5.10) é uma leitura das duas.
CREATE TABLE "agenda_event" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "location" text,
  "notes" text,
  "state" text DEFAULT 'agendado' NOT NULL,
  "cancel_reason" text,
  "evaluated_person_id" uuid REFERENCES "person"("id"),
  "evaluator_person_id" uuid REFERENCES "person"("id"),
  "course_id" uuid REFERENCES "course"("id"),
  "suggested_module_id" uuid REFERENCES "course_module"("id"),
  "result_notes" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agenda_event_period" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "agenda_event_leveling" CHECK ("kind" <> 'nivelamento' or "evaluated_person_id" is not null)
);
--> statement-breakpoint
CREATE INDEX "agenda_event_tenant_starts_idx" ON "agenda_event" USING btree ("tenant_id", "starts_at");
--> statement-breakpoint
CREATE TABLE "agenda_event_participant" (
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "event_id" uuid NOT NULL REFERENCES "agenda_event"("id") ON DELETE CASCADE,
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  CONSTRAINT "agenda_event_participant_event_id_person_id_pk" PRIMARY KEY ("event_id", "person_id")
);
--> statement-breakpoint
CREATE INDEX "agenda_event_participant_person_idx" ON "agenda_event_participant" USING btree ("person_id");
