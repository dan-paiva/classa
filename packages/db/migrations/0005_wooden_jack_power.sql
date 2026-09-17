CREATE TABLE "payroll_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"paid_lessons" integer NOT NULL,
	"discounted_lessons" integer NOT NULL,
	"minutes" integer NOT NULL,
	"gross_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"details" jsonb NOT NULL,
	"paid_on" date,
	"paid_by" text,
	CONSTRAINT "payroll_line_period_teacher_uq" UNIQUE("period_id","teacher_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"closed_by" text,
	"gross_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"lessons" integer NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by" text,
	"reopen_justification" text
);
--> statement-breakpoint
ALTER TABLE "class_group" ADD COLUMN "teacher_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "rate_override_cents" integer;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "rate_override_reason" text;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "support_reason" text;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "support_detail" text;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "support_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_period_id_payroll_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period" ADD CONSTRAINT "payroll_period_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_period_tenant_month_idx" ON "payroll_period" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_period_open_uq" ON "payroll_period" USING btree ("tenant_id","month") WHERE "payroll_period"."reopened_at" is null;