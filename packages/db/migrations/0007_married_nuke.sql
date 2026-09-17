CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"origin" text NOT NULL,
	"campaign" text,
	"course_id" uuid,
	"consultant_user_id" text,
	"stage" text DEFAULT 'captado' NOT NULL,
	"previous_stage" text,
	"lost_reason" text,
	"temperature" text,
	"next_action" text,
	"next_action_on" date,
	"consent" boolean DEFAULT false NOT NULL,
	"student_id" uuid,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_card" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"flow" text NOT NULL,
	"stage" text NOT NULL,
	"title" text NOT NULL,
	"data" jsonb NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_transition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"note" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_card" ADD CONSTRAINT "workflow_card_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_card_id_workflow_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."workflow_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_tenant_stage_idx" ON "lead" USING btree ("tenant_id","stage");--> statement-breakpoint
CREATE INDEX "workflow_card_tenant_flow_idx" ON "workflow_card" USING btree ("tenant_id","flow","stage");--> statement-breakpoint
CREATE INDEX "workflow_transition_card_idx" ON "workflow_transition" USING btree ("card_id");