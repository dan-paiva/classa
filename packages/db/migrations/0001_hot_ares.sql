CREATE TABLE "course" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"color" text NOT NULL,
	"capacity" integer NOT NULL,
	"lesson_minutes" integer NOT NULL,
	"package_lessons" integer NOT NULL,
	"cancel_notice_hours" integer NOT NULL,
	"lesson_price_cents" integer NOT NULL,
	"modalities" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "course_tenant_name_uq" UNIQUE("tenant_id","name"),
	CONSTRAINT "course_capacity_positive" CHECK ("course"."capacity" > 0),
	CONSTRAINT "course_lesson_minutes_positive" CHECK ("course"."lesson_minutes" > 0),
	CONSTRAINT "course_package_lessons_positive" CHECK ("course"."package_lessons" > 0),
	CONSTRAINT "course_cancel_notice_non_negative" CHECK ("course"."cancel_notice_hours" >= 0),
	CONSTRAINT "course_price_non_negative" CHECK ("course"."lesson_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "course_module" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "course_module_course_name_uq" UNIQUE("course_id","name")
);
--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module" ADD CONSTRAINT "course_module_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module" ADD CONSTRAINT "course_module_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_module_course_idx" ON "course_module" USING btree ("course_id");