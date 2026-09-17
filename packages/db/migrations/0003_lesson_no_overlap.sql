-- Professor e sala não podem ter duas aulas sobrepostas (aula cancelada não conta).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_teacher_no_overlap"
  EXCLUDE USING gist ("teacher_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("teacher_id" IS NOT NULL AND "state" <> 'cancelada');
--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_room_no_overlap"
  EXCLUDE USING gist ("room_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("room_id" IS NOT NULL AND "state" <> 'cancelada');
