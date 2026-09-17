CREATE TABLE "company" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cnpj" text,
	"segment" text,
	"model" text NOT NULL,
	"manager_user_id" text,
	"hr_name" text,
	"hr_email" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"licenses" integer NOT NULL,
	"contracted_lessons" integer DEFAULT 0 NOT NULL,
	"license_price_cents" integer NOT NULL,
	"subsidy_percent" integer DEFAULT 100 NOT NULL,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"allowed_course_ids" uuid[],
	"last_report_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "company_tenant_name_uq" UNIQUE("tenant_id","name"),
	CONSTRAINT "company_period" CHECK ("company"."ends_on" > "company"."starts_on"),
	CONSTRAINT "company_licenses_positive" CHECK ("company"."licenses" >= 1),
	CONSTRAINT "company_subsidy_range" CHECK ("company"."subsidy_percent" between 0 and 100),
	CONSTRAINT "company_discount_range" CHECK ("company"."discount_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "company_charge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"month" text NOT NULL,
	"billed_licenses" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_date" date NOT NULL,
	"paid_on" date,
	"method" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_charge_month_uq" UNIQUE("company_id","month")
);
--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_charge" ADD CONSTRAINT "company_charge_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_charge" ADD CONSTRAINT "company_charge_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_tenant_cnpj_uq" ON "company" USING btree ("tenant_id","cnpj") WHERE "company"."cnpj" is not null;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
