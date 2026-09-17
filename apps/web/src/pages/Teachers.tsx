import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api, allowsModules, issuesOf, type Course } from "../api.ts";
import { school, type Teacher } from "../api-school.ts";
import { AvailabilityGrid } from "../components/AvailabilityGrid.tsx";
import { fmtShortDate, fmtTime, fmtWeekday, formatPhone, money, parseReais, scheduleLabel } from "../lib/format.ts";
import { LessonStateBadge } from "../status.tsx";
import { ActionError, Badge, ColorDot, Empty, Field, FormError, LoadError, Loading, PageHead } from "../ui.tsx";

export function Teachers() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const q = useQuery({ queryKey: ["teachers", slug], queryFn: () => school.teachers(slug) });
  const [showInactive, setShowInactive] = useState(false);
  const list = (q.data?.teachers ?? []).filter((t) => showInactive || !t.deactivatedAt);

  return (
    <div className="stack-lg">
      <PageHead
        title="Professores"
        subtitle="Cursos que cada um pode dar, disponibilidade e carga semanal."
        actions={
          <Link to="/e/$slug/professores/novo" params={{ slug }} className="btn btn-primary">
            Novo professor
          </Link>
        }
      />
      <label className="check" htmlFor="t-inactive">
        <input id="t-inactive" type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Mostrar inativos
      </label>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} />
      ) : list.length === 0 ? (
        <Empty>Nenhum professor cadastrado.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Professor</th>
                <th>Contato</th>
                <th>Pode dar aula de</th>
                <th className="num">Carga semanal</th>
                <th className="num">Disponível</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} className={t.deactivatedAt ? "is-off" : undefined}>
                  <td>
                    <Link to="/e/$slug/professores/$teacherId" params={{ slug, teacherId: t.id }} className="row-link">
                      {t.person.name}
                    </Link>
                  </td>
                  <td className="small">
                    {t.person.email ?? "—"}
                    <div className="muted">{formatPhone(t.person.phone)}</div>
                  </td>
                  <td className="small">
                    {t.courses.map((c) => (
                      <span key={c.courseId} className="title-with-dot">
                        <ColorDot color={c.color} />
                        {c.courseName}
                        {c.moduleIds ? ` (${c.moduleIds.length} módulos)` : ""}
                      </span>
                    ))}
                  </td>
                  <td className="num">
                    {t.weeklyLoad}/{t.weeklyLimit} {t.weeklyLoad > t.weeklyLimit && <Badge tone="warn">Acima do teto</Badge>}
                  </td>
                  <td className="num">{t.availability.length} h</td>
                  <td>{t.deactivatedAt ? <Badge tone="muted">Inativo</Badge> : <Badge tone="ok">Ativo</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------- habilitação por curso */

type Qualification = Record<string, string[] | null>; // courseId → módulos (null = todos)

function QualificationEditor({ courses, value, onChange }: { courses: Course[]; value: Qualification; onChange: (v: Qualification) => void }) {
  return (
    <div className="stack-sm">
      {courses
        .filter((c) => !c.deactivatedAt)
        .map((c) => {
          const on = c.id in value;
          const mods = value[c.id];
          const activeMods = c.modules.filter((m) => !m.deactivatedAt);
          return (
            <div key={c.id} className="qual">
              <label className="check" htmlFor={`q-${c.id}`}>
                <input
                  id={`q-${c.id}`}
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const next = { ...value };
                    if (e.target.checked) next[c.id] = null;
                    else delete next[c.id];
                    onChange(next);
                  }}
                />
                <ColorDot color={c.color} />
                {c.name}
              </label>
              {on && allowsModules(c.type) && activeMods.length > 0 && (
                <div className="chips">
                  {activeMods.map((m) => {
                    const checked = mods === null || mods!.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`chip${checked ? " on" : ""}`}
                        aria-pressed={checked}
                        onClick={() => {
                          const current = mods === null ? activeMods.map((x) => x.id) : mods!;
                          const toggled = checked ? current.filter((x) => x !== m.id) : [...current, m.id];
                          const next = { ...value };
                          if (toggled.length === 0) delete next[c.id];
                          else next[c.id] = toggled.length === activeMods.length ? null : toggled;
                          onChange(next);
                        }}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

const toCourses = (q: Qualification) => Object.entries(q).map(([courseId, moduleIds]) => ({ courseId, moduleIds }));
const fromTeacher = (t: Teacher): Qualification => Object.fromEntries(t.courses.map((c) => [c.courseId, c.moduleIds]));

/* ------------------------------------------------------------------ cadastro */

export function TeacherForm() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [rate, setRate] = useState("");
  const [limit, setLimit] = useState("24");
  const [qual, setQual] = useState<Qualification>({});
  const [availability, setAvailability] = useState<number[]>([]);

  const create = useMutation({
    mutationFn: () =>
      school.createTeacher(slug, {
        person: { name, email: email || null, phone: phone || null, cpf: cpf || null },
        weeklyLimit: Number(limit),
        hourlyRateCents: rate ? parseReais(rate) : null,
        availability,
        courses: toCourses(qual),
      }),
    onSuccess: async ({ teacher }) => {
      await qc.invalidateQueries({ queryKey: ["teachers", slug] });
      navigate({ to: "/e/$slug/professores/$teacherId", params: { slug, teacherId: teacher.id } });
    },
  });
  const issues = issuesOf(create.error);

  return (
    <form
      className="stack-lg"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <PageHead title="Novo professor" />
      <section className="panel stack">
        <h2>Dados pessoais</h2>
        <div className="grid-fields">
          <Field label="Nome completo" htmlFor="t-name" errors={issues.name}>
            <input id="t-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-mail" htmlFor="t-email" errors={issues.email}>
            <input id="t-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Telefone" htmlFor="t-phone" errors={issues.phone}>
            <input id="t-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98765-4321" />
          </Field>
          <Field label="CPF" htmlFor="t-cpf" errors={issues.cpf}>
            <input id="t-cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} />
          </Field>
          <Field label="Valor hora (R$)" htmlFor="t-rate" errors={issues.hourlyRateCents} hint="Usado na folha de pagamento">
            <input id="t-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label="Teto de aulas por semana" htmlFor="t-limit" errors={issues.weeklyLimit} hint="Passar do teto só gera aviso">
            <input id="t-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        </div>
      </section>
      <section className="panel stack">
        <h2>Pode dar aula de</h2>
        <p className="muted small">Marque os cursos. Em cursos com módulos, desmarque os módulos que o professor não dá.</p>
        {courses.data ? <QualificationEditor courses={courses.data.courses} value={qual} onChange={setQual} /> : <Loading />}
        {issues.courses?.[0] && <small className="error">{issues.courses[0]}</small>}
      </section>
      <section className="panel stack">
        <h2>Disponibilidade</h2>
        <AvailabilityGrid value={availability} onChange={setAvailability} />
      </section>
      <FormError error={create.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          Cadastrar professor
        </button>
        <Link to="/e/$slug/professores" params={{ slug }} className="btn">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------- ficha */

export function TeacherDetail() {
  const { slug, teacherId } = useParams({ strict: false }) as { slug: string; teacherId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["teacher", slug, teacherId], queryFn: () => school.teacher(slug, teacherId) });
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const [qual, setQual] = useState<Qualification | null>(null);
  const [availability, setAvailability] = useState<number[] | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const [rate, setRate] = useState<string | null>(null);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["teacher", slug, teacherId] }), qc.invalidateQueries({ queryKey: ["teachers", slug] })]);
  const save = useMutation({
    mutationFn: (input: Parameters<typeof school.updateTeacher>[2]) => school.updateTeacher(slug, teacherId, input),
    onSuccess: async () => {
      setQual(null);
      setAvailability(null);
      setLimit(null);
      setRate(null);
      await refresh();
    },
  });
  const toggle = useMutation({ mutationFn: (active: boolean) => school.setTeacherActive(slug, teacherId, active), onSuccess: refresh });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;
  const { teacher: t, classGroups, lessons } = q.data;
  const now = Date.now();
  const upcoming = lessons.filter((l) => new Date(l.startsAt).getTime() >= now && l.state !== "cancelada").slice(0, 12);
  const pending = lessons.filter((l) => l.state === "nao_finalizada");
  const issues = issuesOf(save.error);

  return (
    <div className="stack-lg">
      <nav className="crumbs" aria-label="Trilha">
        <Link to="/e/$slug/professores" params={{ slug }}>
          Professores
        </Link>
        <span aria-hidden="true">/</span>
        <span>{t.person.name}</span>
      </nav>
      <PageHead
        title={t.person.name}
        subtitle={`${t.person.email ?? "sem e-mail"} · ${formatPhone(t.person.phone)}`}
        actions={
          <button
            type="button"
            className={t.deactivatedAt ? "btn" : "btn btn-danger"}
            onClick={() => (t.deactivatedAt || confirm("Inativar o professor? Ele sai dos seletores e não recebe aulas novas.")) && toggle.mutate(!!t.deactivatedAt)}
          >
            {t.deactivatedAt ? "Reativar" : "Inativar"}
          </button>
        }
      />
      <ActionError error={toggle.error} />

      <div className="stats">
        <div className={`stat${t.weeklyLoad > t.weeklyLimit ? " stat-warn" : ""}`}>
          <span className="stat-label">Carga semanal</span>
          <strong className="stat-value">
            {t.weeklyLoad}/{t.weeklyLimit}
          </strong>
        </div>
        <div className="stat">
          <span className="stat-label">Turmas</span>
          <strong className="stat-value">{classGroups.length}</strong>
        </div>
        <div className={`stat${pending.length ? " stat-warn" : ""}`}>
          <span className="stat-label">Aulas não finalizadas</span>
          <strong className="stat-value">{pending.length}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Valor hora</span>
          <strong className="stat-value small-value">{t.hourlyRateCents != null ? money(t.hourlyRateCents) : "—"}</strong>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel stack">
          <div className="row">
            <h2>Pode dar aula de</h2>
            {qual === null && (
              <button type="button" className="btn-link" onClick={() => setQual(fromTeacher(t))}>
                Editar
              </button>
            )}
          </div>
          {qual === null ? (
            <ul className="plain">
              {t.courses.map((c) => (
                <li key={c.courseId} className="title-with-dot">
                  <ColorDot color={c.color} />
                  {c.courseName} {c.moduleIds && <span className="muted small">({c.moduleIds.length} módulos)</span>}
                </li>
              ))}
            </ul>
          ) : (
            <>
              {courses.data && <QualificationEditor courses={courses.data.courses} value={qual} onChange={setQual} />}
              <div className="actions">
                <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate({ courses: toCourses(qual) })}>
                  Salvar habilitações
                </button>
                <button type="button" className="btn" onClick={() => setQual(null)}>
                  Cancelar
                </button>
              </div>
            </>
          )}
          <div className="grid-fields">
            <Field label="Teto semanal" htmlFor="td-limit" errors={issues.weeklyLimit}>
              <input id="td-limit" inputMode="numeric" value={limit ?? String(t.weeklyLimit)} onChange={(e) => setLimit(e.target.value)} />
            </Field>
            <Field label="Valor hora (R$)" htmlFor="td-rate" errors={issues.hourlyRateCents}>
              <input id="td-rate" inputMode="decimal" value={rate ?? (t.hourlyRateCents != null ? (t.hourlyRateCents / 100).toFixed(2).replace(".", ",") : "")} onChange={(e) => setRate(e.target.value)} />
            </Field>
          </div>
          {(limit !== null || rate !== null) && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={save.isPending}
              onClick={() => save.mutate({ ...(limit !== null ? { weeklyLimit: Number(limit) } : {}), ...(rate !== null ? { hourlyRateCents: rate ? parseReais(rate) : null } : {}) })}
            >
              Salvar
            </button>
          )}
          <FormError error={save.error} />
        </section>

        <section className="panel stack">
          <div className="row">
            <h2>Disponibilidade</h2>
            {availability === null ? (
              <button type="button" className="btn-link" onClick={() => setAvailability(t.availability)}>
                Editar
              </button>
            ) : (
              <span className="actions">
                <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate({ availability })}>
                  Salvar
                </button>
                <button type="button" className="btn" onClick={() => setAvailability(null)}>
                  Cancelar
                </button>
              </span>
            )}
          </div>
          <AvailabilityGrid value={availability ?? t.availability} onChange={availability === null ? undefined : setAvailability} readOnly={availability === null} />
        </section>
      </div>

      <div className="grid-2">
        <section className="panel stack">
          <h2>Turmas</h2>
          {classGroups.length === 0 ? (
            <p className="muted">Nenhuma turma.</p>
          ) : (
            <ul className="plain">
              {classGroups.map((g) => (
                <li key={g.id}>
                  <Link to="/e/$slug/turmas/$classGroupId" params={{ slug, classGroupId: g.id }}>
                    {g.name}
                  </Link>
                  <div className="muted small">
                    {scheduleLabel(g.schedules)} · {g.enrolled}/{g.capacity}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel stack">
          <h2>Próximas aulas</h2>
          {upcoming.length === 0 ? (
            <p className="muted">Nenhuma aula agendada.</p>
          ) : (
            <ul className="lesson-list">
              {upcoming.map((l) => (
                <li key={l.id}>
                  <Link to="/e/$slug/aulas/$lessonId" params={{ slug, lessonId: l.id }} className="lesson-link">
                    <span className="lesson-time">
                      {fmtWeekday(l.startsAt)} {fmtShortDate(l.startsAt)} {fmtTime(l.startsAt)}
                    </span>
                    <span className="lesson-main small">{l.className}</span>
                    <LessonStateBadge lesson={l} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
