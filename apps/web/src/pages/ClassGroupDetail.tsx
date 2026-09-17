import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { issuesOf } from "../api.ts";
import { school } from "../api-school.ts";
import { addDaysIso, money, parseReais, fmtIsoDate, fmtShortDate, fmtTime, fmtWeekday, scheduleLabel, todayIso } from "../lib/format.ts";
import { plural } from "../lib/format.ts";
import { LessonStateBadge, StudentStatusBadge, UsageBar } from "../status.tsx";
import { ActionError, Badge, ColorDot, Field, FormError, LoadError, Loading, PageHead } from "../ui.tsx";

export function ClassGroupDetail() {
  const { slug, classGroupId } = useParams({ strict: false }) as { slug: string; classGroupId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["class-group", slug, classGroupId], queryFn: () => school.classGroup(slug, classGroupId) });
  const [enrolling, setEnrolling] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  const generate = useMutation({
    mutationFn: () => school.generateLessons(slug, classGroupId, { from: todayIso(), to: addDaysIso(todayIso(), 56) }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["class-group", slug, classGroupId] });
      const g = res.generation;
      alert(
        `${g.created} aulas novas, ${g.existing} já existiam.` +
          (g.skipped.length ? `\n${g.skipped.length} horários pulados (feriado, domingo ou fora do funcionamento).` : "") +
          (g.conflicts.length ? `\n${g.conflicts.length} choques de horário com outras aulas do professor ou da sala.` : ""),
      );
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;
  const { classGroup: g, enrollments, lessons } = q.data;
  const active = enrollments.filter((e) => !e.endedAt);
  const now = Date.now();
  const past = lessons.filter((l) => new Date(l.startsAt).getTime() < now).reverse().slice(0, 10);
  const upcoming = lessons.filter((l) => new Date(l.startsAt).getTime() >= now).slice(0, 10);

  return (
    <div className="stack-lg">
      <nav className="crumbs" aria-label="Trilha">
        <Link to="/e/$slug/turmas" params={{ slug }}>
          Turmas
        </Link>
        <span aria-hidden="true">/</span>
        <span>{g.name}</span>
      </nav>
      <PageHead
        title={
          <span className="title-with-dot">
            <ColorDot color={g.courseColor} />
            {g.name}
          </span>
        }
        subtitle={`${g.courseName}${g.moduleName ? ` · ${g.moduleName}` : ""} · ${scheduleLabel(g.schedules)} · ${fmtIsoDate(g.startsOn)} a ${fmtIsoDate(g.endsOn)}`}
        actions={
          <button type="button" className="btn" disabled={generate.isPending} onClick={() => generate.mutate()}>
            Gerar aulas das próximas 8 semanas
          </button>
        }
      />

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Professor</span>
          <strong className="stat-value small-value">
            {g.teacherId ? (
              <Link to="/e/$slug/professores/$teacherId" params={{ slug, teacherId: g.teacherId }}>
                {g.teacherName}
              </Link>
            ) : (
              "Sem professor"
            )}
          </strong>
        </div>
        <div className="stat">
          <span className="stat-label">Sala</span>
          <strong className="stat-value small-value">{g.roomName ?? "—"}</strong>
        </div>
        <div className={`stat${active.length >= g.capacity ? " stat-warn" : ""}`}>
          <span className="stat-label">Ocupação</span>
          <strong className="stat-value">
            {active.length}/{g.capacity}
          </strong>
        </div>
        <div className="stat">
          <span className="stat-label">Modalidade</span>
          <strong className="stat-value small-value">{g.modality === "online" ? "Online" : "Presencial"}</strong>
        </div>
        {g.individual && (
          <div className="stat">
            <span className="stat-label">Valor por aula (professor)</span>
            <strong className="stat-value small-value">{money(g.teacherRateCents ?? 12000)}</strong>
            <button
              type="button"
              className="btn-link small"
              onClick={() => {
                const v = prompt("Valor pago ao professor por aula (R$)", ((g.teacherRateCents ?? 12000) / 100).toFixed(2).replace(".", ","));
                if (v) school.setTeacherRate(slug, g.id, parseReais(v)).then(() => qc.invalidateQueries({ queryKey: ["class-group", slug, classGroupId] }));
              }}
            >
              Alterar
            </button>
          </div>
        )}
      </div>

      <section className="panel stack">
        <div className="row">
          <h2>Alunos matriculados</h2>
          <span className="actions">
            <label className="check" htmlFor="show-ended">
              <input id="show-ended" type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
              Mostrar encerradas
            </label>
            {!enrolling && active.length < g.capacity && (
              <button type="button" className="btn btn-primary" onClick={() => setEnrolling(true)}>
                Matricular aluno
              </button>
            )}
          </span>
        </div>
        {enrolling && <EnrollForm slug={slug} classGroupId={g.id} packageHint={g.individual} onClose={() => setEnrolling(false)} />}
        {active.length >= g.capacity && <p className="muted small">Turma cheia: não aceita novas matrículas.</p>}
        <table className="compact">
          <thead>
            <tr>
              <th>Aluno</th>
              <th>Situação</th>
              <th>Início</th>
              <th className="num">Saldo</th>
              <th>Uso do pacote</th>
            </tr>
          </thead>
          <tbody>
            {enrollments
              .filter((e) => showEnded || !e.endedAt)
              .map((e) => (
                <tr key={e.id} className={e.endedAt ? "is-off" : undefined}>
                  <td>
                    <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: e.studentId }}>
                      {e.studentName}
                    </Link>
                    {e.endedAt && <Badge tone="muted">Encerrada</Badge>}
                  </td>
                  <td>
                    <StudentStatusBadge status={e.studentStatus} />
                  </td>
                  <td className="small">{fmtIsoDate(e.startsOn)}</td>
                  <td className="num">{e.balance}</td>
                  <td>
                    <UsageBar used={e.used} granted={e.granted} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <div className="grid-2">
        <LessonTable title="Próximas aulas" slug={slug} lessons={upcoming} />
        <LessonTable title="Aulas recentes" slug={slug} lessons={past} />
      </div>
    </div>
  );
}

function LessonTable({ title, slug, lessons }: { title: string; slug: string; lessons: Awaited<ReturnType<typeof school.classGroup>>["lessons"] }) {
  return (
    <section className="panel stack">
      <h2>{title}</h2>
      {lessons.length === 0 ? (
        <p className="muted">Nenhuma aula.</p>
      ) : (
        <ul className="lesson-list">
          {lessons.map((l) => (
            <li key={l.id}>
              <Link to="/e/$slug/aulas/$lessonId" params={{ slug, lessonId: l.id }} className="lesson-link">
                <span className="lesson-time">
                  {fmtWeekday(l.startsAt)} {fmtShortDate(l.startsAt)} {fmtTime(l.startsAt)}
                </span>
                <span className="lesson-main small">
                  {l.state === "concluida" ? `${plural(l.present, "presente", "presentes")} · ${plural(l.absent, "falta", "faltas")}` : `${l.enrolled} inscritos`}
                  {l.originalTeacherName && <span className="muted"> · substituto {l.teacherName}</span>}
                </span>
                <LessonStateBadge lesson={l} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EnrollForm({ slug, classGroupId, onClose }: { slug: string; classGroupId: string; packageHint: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const students = useQuery({ queryKey: ["students", slug], queryFn: () => school.students(slug) });
  const [studentId, setStudentId] = useState("");
  const [packageLessons, setPackageLessons] = useState("");
  const [installments, setInstallments] = useState("6");
  const [discount, setDiscount] = useState("");
  const [search, setSearch] = useState("");

  const create = useMutation({
    mutationFn: () =>
      school.createEnrollment(slug, {
        studentId,
        classGroupId,
        packageLessons: packageLessons ? Number(packageLessons) : undefined,
        contract: { installments: Number(installments), discountCents: discount ? Math.round(Number(discount.replace(",", ".")) * 100) : 0 },
      }),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["class-group", slug, classGroupId] }), qc.invalidateQueries({ queryKey: ["students", slug] })]);
      onClose();
    },
  });
  const issues = issuesOf(create.error);
  const options = (students.data?.students ?? []).filter(
    (s) => !["cancelado", "inativo"].includes(s.status) && (!search || s.person.name.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <form
      className="subpanel stack"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="grid-fields">
        <Field label="Buscar aluno" htmlFor="enroll-search">
          <input id="enroll-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome" />
        </Field>
        <Field label="Aluno" htmlFor="enroll-student" errors={issues.studentId}>
          <select id="enroll-student" required value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Escolha…</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.person.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Aulas no pacote" htmlFor="enroll-package" errors={issues.packageLessons} hint="Vazio = padrão do curso">
          <input id="enroll-package" inputMode="numeric" value={packageLessons} onChange={(e) => setPackageLessons(e.target.value)} />
        </Field>
        <Field label="Parcelas" htmlFor="enroll-installments" errors={issues.installments}>
          <select id="enroll-installments" value={installments} onChange={(e) => setInstallments(e.target.value)}>
            {[1, 2, 3, 4, 6, 10, 12].map((n) => (
              <option key={n} value={n}>
                {n}x
              </option>
            ))}
          </select>
        </Field>
        <Field label="Desconto (R$)" htmlFor="enroll-discount" errors={issues.discountCents}>
          <input id="enroll-discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </Field>
      </div>
      <p className="muted small">A matrícula lança o pacote no extrato, inscreve o aluno nas próximas aulas e emite o contrato com as parcelas (vencimento dia 10).</p>
      <FormError error={create.error} />
      <ActionError error={create.error && (create.error as { status?: number }).status === 422 ? null : null} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          Matricular
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
