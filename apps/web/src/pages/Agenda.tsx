import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api.ts";
import { AGENDA_TYPE_LABELS, EVENT_STATE_LABELS, school, type AgendaItem, type AgendaItemType, type EventState } from "../api-school.ts";
import { addDaysIso, fmtIsoDate, fmtTime, isoDay, mondayOf, todayIso, WEEKDAYS } from "../lib/format.ts";
import { useCan, useMembership } from "../lib/permissions.ts";
import { Badge, ColorDot, LoadError, Loading, PageHead } from "../ui.tsx";

/** Recortes prontos da agenda geral (DOMINIO.md §5.10). O do professor e o da sala são os filtros. */
type Preset = "tudo" | "minha" | "vagas";

const LESSON_STATE_LABELS: Record<string, string> = {
  em_andamento: "Em andamento",
  concluida: "Concluída",
  nao_finalizada: "Não finalizada",
  cancelada: "Cancelada",
};

/**
 * Agenda geral: aula, reunião, evento e nivelamento numa tela só. Aula e evento
 * seguem em tabelas separadas; aqui é só a leitura unificada. Cancelado
 * aparece riscado, não some.
 */
export function Agenda() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const membership = useMembership();
  const ownOnly = membership?.profileType === "prestador";
  const [week, setWeek] = useState(() => mondayOf(todayIso()));
  const [preset, setPreset] = useState<Preset>(ownOnly ? "minha" : "tudo");
  const [f, setF] = useState({ type: "", teacherId: "", roomId: "", classGroupId: "", courseId: "", moduleId: "", personId: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value, ...(k === "courseId" ? { moduleId: "" } : {}) });

  const canSeeTeachers = useCan("professores");
  const canSeeCourses = useCan("cursos");
  const canSeeGroups = useCan("turmas");
  const canCreate = useCan("eventos", "operar");
  const canPickPeople = useCan("eventos");

  const from = `${week}T03:00:00Z`;
  const to = `${addDaysIso(week, 7)}T03:00:00Z`;
  const filters = {
    from,
    to,
    ...(ownOnly ? {} : f),
    ...(preset === "minha" && !ownOnly ? { personId: "me" } : {}),
    ...(preset === "vagas" ? { openSlots: "1" } : {}),
  };
  const agenda = useQuery({ queryKey: ["agenda", slug, filters], queryFn: () => school.agenda(slug, filters) });
  const teachers = useQuery({ queryKey: ["teachers", slug], queryFn: () => school.teachers(slug), enabled: canSeeTeachers && !ownOnly });
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug), enabled: canSeeCourses && !ownOnly });
  const rooms = useQuery({ queryKey: ["rooms", slug], queryFn: () => school.rooms(slug), enabled: canSeeGroups && !ownOnly });
  const groups = useQuery({ queryKey: ["class-groups", slug], queryFn: () => school.classGroups(slug), enabled: canSeeGroups && !ownOnly });
  const people = useQuery({ queryKey: ["agenda-people", slug], queryFn: () => school.agendaPeople(slug), enabled: canPickPeople && !ownOnly });
  const modules = courses.data?.courses.find((c) => c.id === f.courseId)?.modules ?? [];

  const days = Array.from({ length: 6 }, (_, i) => addDaysIso(week, i));
  const items = agenda.data?.items ?? [];
  const byDay = new Map<string, AgendaItem[]>();
  for (const it of items) {
    const d = isoDay(it.startsAt);
    byDay.set(d, [...(byDay.get(d) ?? []), it]);
  }
  const today = todayIso();
  const active = items.filter((i) => !i.cancelled);
  const hasFilter = Object.values(f).some(Boolean);

  return (
    <div className="stack-lg">
      <PageHead
        title={ownOnly ? "Minha agenda" : "Agenda"}
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
            {canCreate && (
              <Link to="/e/$slug/eventos/novo" params={{ slug }} className="btn btn-primary">
                Nova reunião ou evento
              </Link>
            )}
          </>
        }
      />

      {!ownOnly && (
        <div className="tabs" role="tablist">
          {(
            [
              ["tudo", "Tudo"],
              ["minha", "Minha agenda"],
              ["vagas", "Vagas open-entry"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={preset === key} className={preset === key ? "tab on" : "tab"} onClick={() => setPreset(key)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {!ownOnly && (
        <div className="toolbar">
          {preset !== "vagas" && (
            <select aria-label="Tipo" value={f.type} onChange={set("type")}>
              <option value="">Todos os tipos</option>
              {(Object.keys(AGENDA_TYPE_LABELS) as AgendaItemType[]).map((k) => (
                <option key={k} value={k}>
                  {AGENDA_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          )}
          {canSeeTeachers && (
            <select aria-label="Professor" value={f.teacherId} onChange={set("teacherId")}>
              <option value="">Todos os professores</option>
              {teachers.data?.teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.person.name}
                </option>
              ))}
            </select>
          )}
          {canSeeGroups && (
            <select aria-label="Sala" value={f.roomId} onChange={set("roomId")}>
              <option value="">Todas as salas</option>
              {rooms.data?.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          {canSeeGroups && (
            <select aria-label="Turma" value={f.classGroupId} onChange={set("classGroupId")}>
              <option value="">Todas as turmas</option>
              {groups.data?.classGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          {canSeeCourses && (
            <select aria-label="Curso" value={f.courseId} onChange={set("courseId")}>
              <option value="">Todos os cursos</option>
              {courses.data?.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {f.courseId && modules.length > 0 && (
            <select aria-label="Nível" value={f.moduleId} onChange={set("moduleId")}>
              <option value="">Todos os níveis</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          {canPickPeople && preset === "tudo" && (
            <select aria-label="Pessoa" value={f.personId} onChange={set("personId")}>
              <option value="">Qualquer pessoa</option>
              {people.data?.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.roles.join(", ")})
                </option>
              ))}
            </select>
          )}
          {hasFilter && (
            <button type="button" className="btn-link" onClick={() => setF({ type: "", teacherId: "", roomId: "", classGroupId: "", courseId: "", moduleId: "", personId: "" })}>
              Limpar filtros
            </button>
          )}
          <span className="muted small">
            {active.filter((i) => i.type === "aula").length} aulas · {active.filter((i) => i.type !== "aula").length} outros compromissos
          </span>
        </div>
      )}
      {(f.roomId || f.classGroupId || f.moduleId) && preset !== "vagas" && (
        <p className="muted small">Filtro por sala, turma ou nível mostra só aulas: reunião, evento e nivelamento não têm esses campos.</p>
      )}

      {agenda.isPending ? (
        <Loading />
      ) : agenda.isError ? (
        <LoadError error={agenda.error} />
      ) : (
        <div className="week">
          {days.map((d, i) => (
            <section key={d} className={`day${d === today ? " day-today" : ""}`}>
              <h3>
                {WEEKDAYS[(i + 1) % 7]} <span className="muted">{fmtIsoDate(d).slice(0, 5)}</span>
              </h3>
              {(byDay.get(d) ?? []).length === 0 ? (
                <p className="muted small">{preset === "vagas" ? "Sem vagas" : "Nada marcado"}</p>
              ) : (
                (byDay.get(d) ?? []).map((it) => <ItemCard key={`${it.type}-${it.id}`} slug={slug} item={it} />)
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemCard({ slug, item }: { slug: string; item: AgendaItem }) {
  const className = `card-lesson${item.cancelled ? " state-cancelada" : ""}${item.type !== "aula" ? " card-event" : ""}`;
  const style = { borderLeftColor: item.color ?? "var(--muted)" };
  const content = (
    <>
      <span className="card-time">
        {fmtTime(item.startsAt)}–{fmtTime(item.endsAt)}
      </span>
      <strong className="title-with-dot">
        {item.color && <ColorDot color={item.color} />}
        {item.title}
      </strong>
      {item.detail && <span className="muted small">{item.detail}</span>}
      <span>
        {item.type !== "aula" && <Badge tone="info">{AGENDA_TYPE_LABELS[item.type]}</Badge>}{" "}
        {item.seatsLeft !== undefined && item.state === "agendada" && <Badge tone={item.seatsLeft > 0 ? "ok" : "muted"}>{item.seatsLeft > 0 ? `${item.seatsLeft} vaga(s)` : "Cheia"}</Badge>}
        {item.type === "aula" && LESSON_STATE_LABELS[item.state] && <Badge tone={item.state === "nao_finalizada" ? "warn" : "muted"}>{LESSON_STATE_LABELS[item.state]}</Badge>}
        {item.type !== "aula" && item.state !== "agendado" && <Badge tone="muted">{EVENT_STATE_LABELS[item.state as EventState]}</Badge>}
      </span>
    </>
  );
  return item.type === "aula" ? (
    <Link to="/e/$slug/aulas/$lessonId" params={{ slug, lessonId: item.id }} className={className} style={style}>
      {content}
    </Link>
  ) : (
    <Link to="/e/$slug/eventos/$eventId" params={{ slug, eventId: item.id }} className={className} style={style}>
      {content}
    </Link>
  );
}
