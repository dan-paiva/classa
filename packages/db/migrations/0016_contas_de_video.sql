CREATE TABLE "video_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"login" text,
	"max_concurrent" integer DEFAULT 2 NOT NULL,
	"buffer_minutes" integer DEFAULT 10 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "video_account_tenant_name_uq" UNIQUE("tenant_id","name"),
	CONSTRAINT "video_account_max" CHECK ("video_account"."max_concurrent" between 1 and 10),
	CONSTRAINT "video_account_buffer" CHECK ("video_account"."buffer_minutes" between 0 and 60)
);
--> statement-breakpoint
ALTER TABLE "room" ADD COLUMN "video_account_id" uuid;--> statement-breakpoint
ALTER TABLE "video_account" ADD CONSTRAINT "video_account_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_video_account_id_video_account_id_fk" FOREIGN KEY ("video_account_id") REFERENCES "public"."video_account"("id") ON DELETE no action ON UPDATE no action;