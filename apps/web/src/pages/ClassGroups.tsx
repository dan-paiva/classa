import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api, allowsModules, issuesOf, type Modality } from "../api.ts";
import { school, type Schedule } from "../api-school.ts";
import { addDaysIso, fmtIsoDate, scheduleLabel, todayIso, WEEKDAYS } from "../lib/format.ts";
import { Badge, ColorDot, Empty, Field, FormError, LoadError, Loading, PageHead } from "../ui.tsx";

export function ClassGroups() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [creating, setCreating] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [showIndividual, setShowIndividual] = useState(false);
  const groups = useQuery({ queryKey: ["class-groups", slug], queryFn: () => school.classGroups(slug) });
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });

  const list = (groups.data?.classGroups ?? []).filter((g) => (!courseId || g.courseId === courseId) && (showIndividual || !g.individual));

  return (
    <div className="stack-lg">
      <PageHead
        title="Turmas"
        subtitle="O que se repete toda semana e gera as aulas. Aula particular é uma turma de 1 vaga."
        actions={
          !creating && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Nova turma
            </button>
          )
        }
      />
      {creating && <NewClassGroup slug={slug} onClose={() => setCreating(false)} />}

      <div className="toolbar">
        <select aria-label="Curso" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">Todos os cursos</option>
          {courses.data?.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="check" htmlFor="show-individual">
          <input id="show-individual" type="checkbox" checked={showIndividual} onChange={(e) => setShowIndividual(e.target.checked)} />
          Mostrar aulas particulares
        </label>
      </div>

      {groups.isPending ? (
        <Loading />
      ) : groups.isError ? (
        <LoadError error={groups.error} />
      ) : list.length === 0 ? (
        <Empty>Nenhuma turma.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Turma</th>
                <th>Curso</th>
                <th>Horários</th>
                <th>Professor</th>
                <th>Sala</th>
                <th className="num">Ocupação</th>
                <th>Período</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => {
                const full = g.enrolled >= g.capacity;
                return (
                  <tr key={g.id}>
                    <td>
                      <Link to="/e/$slug/turmas/$classGroupId" params={{ slug, classGroupId: g.id }} className="row-link">
                        {g.name}
                      </Link>
                    </td>
                    <td>
                      <span className="title-with-dot">
                        <ColorDot color={g.courseColor} />
                        {g.courseName}
                      </span>
                      {g.moduleName && <div className="muted small">{g.moduleName}</div>}
                    </td>
                    <td className="small">{scheduleLabel(g.schedules)}</td>
                    <td>{g.teacherName ?? <Badge tone="danger">Sem professor</Badge>}</td>
                    <td>{g.roomName ?? "—"}</td>
                    <td className="num">
                      {g.enrolled}/{g.capacity} {full && <Badge tone="warn">Cheia</Badge>}
                    </td>
                    <td className="small">
                      {fmtIsoDate(g.startsOn)} a {fmtIsoDate(g.endsOn)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewClassGroup({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const teachers = useQuery({ queryKey: ["teachers", slug], queryFn: () => school.teachers(slug) });
  const rooms = useQuery({ queryKey: ["rooms", slug], queryFn: () => school.rooms(slug) });

  const [courseId, setCourseId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [name, setName] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [modality, setModality] = useState<Modality>("online");
  const [capacity, setCapacity] = useState("");
  const [startsOn, setStartsOn] = useState(todayIso());
  const [endsOn, setEndsOn] = useState(addDaysIso(todayIso(), 180));
  const [schedules, setSchedules] = useState<Schedule[]>([{ weekday: 1, startTime: "19:00" }]);

  const course = courses.data?.courses.find((c) => c.id === courseId);
  const minutes = course?.lessonMinutes ?? 60;
  /** O professor está livre em todos os horários escolhidos, considerando a duração da aula? */
  const fits = (availability: number[]) =>
    schedules.every((s) => {
      const [h, m] = s.startTime.split(":").map(Number);
      const start = h! * 60 + (m ?? 0);
      for (let hour = Math.floor(start / 60); hour * 60 < start + minutes; hour++) if (!availability.includes(s.weekday * 100 + hour)) return false;
      return true;
    });
  const eligible = (teachers.data?.teachers ?? []).filter(
    (t) => !t.deactivatedAt && t.courses.some((c) => c.courseId === courseId && (!c.moduleIds || !moduleId || c.moduleIds.includes(moduleId))),
  );
  const roomsForModality = (rooms.data?.rooms ?? []).filter((r) => !r.deactivatedAt && (modality === "online" ? r.kind === "virtual" : r.kind !== "virtual"));

  const create = useMutation({
    mutationFn: () =>
      school.createClassGroup(slug, {
        courseId,
        moduleId: moduleId || null,
        name,
        teacherId: teacherId || null,
        roomId: roomId || null,
        modality,
        capacity: capacity ? Number(capacity) : undefined,
        startsOn,
        endsOn,
        schedules,
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["class-groups", slug] });
      if (res.warnings.length) alert(res.warnings.join("\n"));
      navigate({ to: "/e/$slug/turmas/$classGroupId", params: { slug, classGroupId: res.classGroup.id } });
    },
  });
  const issues = issuesOf(create.error);

  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2>Nova turma</h2>
      <div className="grid-fields">
        <Field label="Curso" htmlFor="cg-course" errors={issues.courseId}>
          <select
            id="cg-course"
            required
            value={courseId}
            onChange={(e) => {
              const c = courses.data?.courses.find((x) => x.id === e.target.value);
              setCourseId(e.target.value);
              setModuleId("");
              setTeacherId("");
              if (c) setModality(c.modalities[0]!);
            }}
          >
            <option value="">Escolha…</option>
            {courses.data?.courses
              .filter((c) => !c.deactivatedAt)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        {course && allowsModules(course.type) && (
          <Field label={course.type === "turmas_dedicadas" ? "Turma do contrato" : "Módulo"} htmlFor="cg-module" errors={issues.moduleId}>
            <select id="cg-module" required value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
              <option value="">Escolha…</option>
              {course.modules
                .filter((m) => !m.deactivatedAt)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="Nome da turma" htmlFor="cg-name" errors={issues.name} hint="Ex.: Básico 1 · Seg e Qua 19h">
          <input id="cg-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Modalidade" htmlFor="cg-modality" errors={issues.modality}>
          <select id="cg-modality" value={modality} onChange={(e) => { setModality(e.target.value as Modality); setRoomId(""); }}>
            {(course?.modalities ?? ["online", "presencial"]).map((m) => (
              <option key={m} value={m}>
                {m === "online" ? "Online" : "Presencial"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Professor" htmlFor="cg-teacher" errors={issues.teacherId} hint={courseId && eligible.length === 0 ? "Nenhum professor habilitado neste curso." : "Só aparecem professores habilitados; os indisponíveis nos horários escolhidos ficam bloqueados."}>
          <select id="cg-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">Sem professor por enquanto</option>
            {eligible.map((t) => {
              const free = fits(t.availability);
              return (
                <option key={t.id} value={t.id} disabled={!free}>
                  {t.person.name} ({t.weeklyLoad}/{t.weeklyLimit} aulas/sem.){free ? "" : " · indisponível nesses horários"}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="Sala" htmlFor="cg-room" errors={issues.roomId}>
          <select id="cg-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Sem sala</option>
            {roomsForModality.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        {course?.type !== "particular" && (
          <Field label="Vagas" htmlFor="cg-capacity" errors={issues.capacity} hint={course ? `Padrão do curso: ${course.capacity}` : undefined}>
            <input id="cg-capacity" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        )}
        <Field label="Início" htmlFor="cg-start" errors={issues.startsOn}>
          <input id="cg-start" type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label="Fim" htmlFor="cg-end" errors={issues.endsOn}>
          <input id="cg-end" type="date" required value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
      </div>

      <fieldset className="field">
        <legend>Horários na semana</legend>
        <div className="stack-sm">
          {schedules.map((s, i) => (
            <div key={i} className="inline-form">
              <select aria-label="Dia da semana" value={s.weekday} onChange={(e) => setSchedules(schedules.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}>
                {[1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAYS[d]}
                  </option>
                ))}
              </select>
              <input aria-label="Horário" type="time" value={s.startTime} onChange={(e) => setSchedules(schedules.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} />
              {schedules.length > 1 && (
                <button type="button" className="btn-link" onClick={() => setSchedules(schedules.filter((_, j) => j !== i))}>
                  Remover
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn-link" onClick={() => setSchedules([...schedules, { weekday: 3, startTime: schedules.at(-1)?.startTime ?? "19:00" }])}>
            + Adicionar horário
          </button>
        </div>
        {issues.schedules?.[0] && <small className="error">{issues.schedules[0]}</small>}
      </fieldset>
      <p className="muted small">Ao criar, as aulas das próximas 8 semanas são geradas, sem domingos, feriados e horários fora do funcionamento.</p>
      <FormError error={create.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? "Criando…" : "Criar turma e gerar aulas"}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
