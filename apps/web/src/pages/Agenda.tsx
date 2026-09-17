import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api.ts";
import { school, type Lesson } from "../api-school.ts";
import { addDaysIso, fmtIsoDate, fmtTime, isoDay, mondayOf, todayIso, WEEKDAYS } from "../lib/format.ts";
import { plural } from "../lib/format.ts";
import { LessonStateBadge } from "../status.tsx";
import { ColorDot, LoadError, Loading, PageHead } from "../ui.tsx";

export function Agenda() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [week, setWeek] = useState(() => mondayOf(todayIso()));
  const [teacherId, setTeacherId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);

  const from = `${week}T03:00:00Z`;
  const to = `${addDaysIso(week, 7)}T03:00:00Z`;
  const lessons = useQuery({
    queryKey: ["lessons", slug, week, teacherId, courseId],
    queryFn: () => school.lessons(slug, { from, to, teacherId: teacherId || undefined, courseId: courseId || undefined }),
  });
  const teachers = useQuery({ queryKey: ["teachers", slug], queryFn: () => school.teachers(slug) });
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });

  const days = Array.from({ length: 6 }, (_, i) => addDaysIso(week, i));
  const byDay = new Map<string, Lesson[]>();
  for (const l of lessons.data?.lessons ?? []) {
    if (!showCancelled && l.state === "cancelada") continue;
    const d = isoDay(l.startsAt);
    byDay.set(d, [...(byDay.get(d) ?? []), l]);
  }
  const today = todayIso();
  const all = lessons.data?.lessons ?? [];

  return (
    <div className="stack-lg">
      <PageHead
        title="Agenda"
        subtitle={`Semana de ${fmtIsoDate(week)} a ${fmtIsoDate(addDaysIso(week, 5))}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setWeek(addDaysIso(week, -7))}>
              ← Anterior
            </button>
            <button type="button" className="btn" onClick={() => setWeek(mondayOf(todayIso()))}>
              Hoje
            </button>
            <button type="button" className="btn" onClick={() => setWeek(addDaysIso(week, 7))}>
              Próxima →
            </button>
          </>
        }
      />

      <div className="toolbar">
        <select aria-label="Professor" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          <option value="">Todos os professores</option>
          {teachers.data?.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.person.name}
            </option>
          ))}
        </select>
        <select aria-label="Curso" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">Todos os cursos</option>
          {courses.data?.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="check" htmlFor="show-cancelled">
          <input id="show-cancelled" type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
          Mostrar canceladas
        </label>
        <span className="muted small">
          {all.filter((l) => l.state !== "cancelada").length} aulas · {all.filter((l) => l.state === "nao_finalizada").length} não finalizadas ·{" "}
          {all.filter((l) => l.flags.semProfessor).length} sem professor
        </span>
      </div>

      {lessons.isPending ? (
        <Loading />
      ) : lessons.isError ? (
        <LoadError error={lessons.error} />
      ) : (
        <div className="week">
          {days.map((d, i) => (
            <section key={d} className={`day${d === today ? " day-today" : ""}`}>
              <h3>
                {WEEKDAYS[(i + 1) % 7]} <span className="muted">{fmtIsoDate(d).slice(0, 5)}</span>
              </h3>
              {(byDay.get(d) ?? []).length === 0 ? (
                <p className="muted small">Sem aulas</p>
              ) : (
                (byDay.get(d) ?? []).map((l) => (
                  <Link
                    key={l.id}
                    to="/e/$slug/aulas/$lessonId"
                    params={{ slug, lessonId: l.id }}
                    className={`card-lesson state-${l.state}`}
                    style={{ borderLeftColor: l.courseColor }}
                  >
                    <span className="card-time">
                      {fmtTime(l.startsAt)}–{fmtTime(l.endsAt)}
                    </span>
                    <strong className="title-with-dot">
                      <ColorDot color={l.courseColor} />
                      {l.className}
                    </strong>
                    <span className="muted small">
                      {l.teacherName ?? "sem professor"} · {l.roomName ?? "sem sala"}
                    </span>
                    <span className="small">
                      {l.state === "concluida" ? `${plural(l.present, "presente", "presentes")} · ${plural(l.absent, "falta", "faltas")}` : `${l.enrolled}/${l.capacity} inscritos`}
                    </span>
                    <LessonStateBadge lesson={l} />
                  </Link>
                ))
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
