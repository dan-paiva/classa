CREATE TABLE "class_group" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid,
	"name" text NOT NULL,
	"teacher_id" uuid,
	"room_id" uuid,
	"modality" text NOT NULL,
	"capacity" integer NOT NULL,
	"individual" boolean DEFAULT false NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "class_group_course_name_uq" UNIQUE("course_id","name"),
	CONSTRAINT "class_group_capacity_positive" CHECK ("class_group"."capacity" > 0),
	CONSTRAINT "class_group_period" CHECK ("class_group"."ends_on" >= "class_group"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "class_schedule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	CONSTRAINT "class_schedule_slot_uq" UNIQUE("class_group_id","weekday","start_time"),
	CONSTRAINT "class_schedule_weekday" CHECK ("class_schedule"."weekday" between 1 and 6)
);
--> statement-breakpoint
CREATE TABLE "credit_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"lesson_id" uuid,
	"reversal_of_id" uuid,
	"justification" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_entry_amount_not_zero" CHECK ("credit_entry"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "enrollment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"modality" text NOT NULL,
	"package_lessons" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_package_positive" CHECK ("enrollment"."package_lessons" > 0),
	CONSTRAINT "enrollment_period" CHECK ("enrollment"."ends_on" >= "enrollment"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "holiday" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_tenant_date_uq" UNIQUE("tenant_id","date")
);
--> statement-breakpoint
CREATE TABLE "lesson" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"teacher_id" uuid,
	"original_teacher_id" uuid,
	"room_id" uuid,
	"state" text DEFAULT 'agendada' NOT NULL,
	"cancel_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_class_start_uq" UNIQUE("class_group_id","starts_at"),
	CONSTRAINT "lesson_period" CHECK ("lesson"."ends_at" > "lesson"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "lesson_student" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" text DEFAULT 'inscrito' NOT NULL,
	"cancelled_in_time" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_student_uq" UNIQUE("lesson_id","enrollment_id")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"cpf" text,
	"phone" text,
	"birth_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"link" text,
	"capacity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "room_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "student" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text DEFAULT 'ativo' NOT NULL,
	"previous_status" text,
	"availability" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_person_uq" UNIQUE("person_id")
);
--> statement-breakpoint
CREATE TABLE "teacher" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"weekly_limit" integer DEFAULT 24 NOT NULL,
	"hourly_rate_cents" integer,
	"availability" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "teacher_person_uq" UNIQUE("person_id"),
	CONSTRAINT "teacher_weekly_limit_positive" CHECK ("teacher"."weekly_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "teacher_course" (
	"tenant_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"module_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_course_teacher_id_course_id_pk" PRIMARY KEY("teacher_id","course_id")
);
--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "settings" jsonb DEFAULT '{"operatingHours":[{"weekday":0,"closed":true},{"weekday":1,"open":"07:00","close":"22:00"},{"weekday":2,"open":"07:00","close":"22:00"},{"weekday":3,"open":"07:00","close":"22:00"},{"weekday":4,"open":"07:00","close":"22:00"},{"weekday":5,"open":"07:00","close":"22:00"},{"weekday":6,"open":"08:00","close":"13:00"}],"policies":{"noShowDebits":true,"lateCancelDebits":true,"delinquencyDays":15,"installments":6,"dueDay":10}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_module_id_course_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."course_module"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_schedule" ADD CONSTRAINT "class_schedule_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_schedule" ADD CONSTRAINT "class_schedule_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_module_id_course_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."course_module"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_original_teacher_id_teacher_id_fk" FOREIGN KEY ("original_teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_student" ADD CONSTRAINT "lesson_student_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_student" ADD CONSTRAINT "lesson_student_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_student" ADD CONSTRAINT "lesson_student_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_student" ADD CONSTRAINT "lesson_student_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher" ADD CONSTRAINT "teacher_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher" ADD CONSTRAINT "teacher_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_course" ADD CONSTRAINT "teacher_course_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_course" ADD CONSTRAINT "teacher_course_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_course" ADD CONSTRAINT "teacher_course_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_group_tenant_idx" ON "class_group" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "credit_entry_enrollment_idx" ON "credit_entry" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "enrollment_student_idx" ON "enrollment" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "enrollment_class_idx" ON "enrollment" USING btree ("class_group_id");--> statement-breakpoint
CREATE INDEX "lesson_tenant_starts_idx" ON "lesson" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "lesson_teacher_starts_idx" ON "lesson" USING btree ("teacher_id","starts_at");--> statement-breakpoint
CREATE INDEX "lesson_student_student_idx" ON "lesson_student" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_tenant_email_uq" ON "person" USING btree ("tenant_id",lower("email")) WHERE "person"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "person_tenant_cpf_uq" ON "person" USING btree ("tenant_id","cpf") WHERE "person"."cpf" is not null;--> statement-breakpoint
CREATE INDEX "person_tenant_name_idx" ON "person" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "student_tenant_status_idx" ON "student" USING btree ("tenant_id","status");