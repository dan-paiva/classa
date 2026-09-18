import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api, issuesOf } from "../api.ts";
import {
  CREDIT_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  REGIME_HINTS,
  REGIME_LABELS,
  school,
  STUDENT_STATUS_LABELS,
  STUDENT_STATUSES,
  type ClassRegime,
  type Enrollment,
  type Installment,
  type PaymentMethod,
  type StudentStatus,
} from "../api-school.ts";
import { AvailabilityGrid } from "../components/AvailabilityGrid.tsx";
import { fmtDate, fmtIsoDate, fmtShortDate, fmtTime, fmtWeekday, formatCpf, formatPhone, money, parseReais, todayIso } from "../lib/format.ts";
import { InstallmentBadge, LessonStateBadge, StudentStatusBadge, UsageBar } from "../status.tsx";
import { ActionError, Badge, ColorDot, Empty, Field, FormError, LoadError, Loading, PageHead, PersonExists } from "../ui.tsx";

export function Students() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const query = useQuery({ queryKey: ["students", slug, q, status], queryFn: () => school.students(slug, { q, status }) });

  return (
    <div className="stack-lg">
      <PageHead
        title="Alunos"
        actions={
          <Link to="/e/$slug/alunos/novo" params={{ slug }} className="btn btn-primary">
            Novo aluno
          </Link>
        }
      />
      <div className="toolbar">
        <input aria-label="Buscar" placeholder="Buscar por nome, e-mail ou CPF" value={q} onChange={(e) => setQ(e.target.value)} className="grow" />
        <select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas as situações</option>
          {STUDENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STUDENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {query.data && <span className="muted small">{query.data.students.length} alunos</span>}
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <LoadError error={query.error} />
      ) : query.data.students.length === 0 ? (
        <Empty>Nenhum aluno encontrado.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Aluno</th>
                <th>Contato</th>
                <th>Situação</th>
                <th className="num">Matrículas</th>
                <th className="num">Saldo de aulas</th>
                <th>Financeiro</th>
              </tr>
            </thead>
            <tbody>
              {query.data.students.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: s.id }} className="row-link">
                      {s.person.name}
                    </Link>
                    <div className="muted small">
                      {formatCpf(s.person.cpf)}
                      {s.companyName && ` · ${s.companyName}`}
                    </div>
                  </td>
                  <td className="small">
                    {s.person.email ?? "—"}
                    <div className="muted">{formatPhone(s.person.phone)}</div>
                  </td>
                  <td>
                    <StudentStatusBadge status={s.status} />
                  </td>
                  <td className="num">{s.activeEnrollments}</td>
                  <td className="num">{s.activeEnrollments ? s.balance : "—"}</td>
                  <td>{s.overdueInstallments > 0 ? <Badge tone="danger">{s.overdueInstallments} vencida{s.overdueInstallments > 1 ? "s" : ""}</Badge> : <span className="muted small">em dia</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function StudentForm() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [person, setPerson] = useState({ name: "", email: "", phone: "", cpf: "", birthDate: "" });
  const [availability, setAvailability] = useState<number[]>([]);
  const create = useMutation({
    mutationFn: () =>
      school.createStudent(slug, {
        person: { name: person.name, email: person.email || null, phone: person.phone || null, cpf: person.cpf || null, birthDate: person.birthDate || null },
        availability,
      }),
    onSuccess: async ({ student }) => {
      await qc.invalidateQueries({ queryKey: ["students", slug] });
      navigate({ to: "/e/$slug/alunos/$studentId", params: { slug, studentId: student.id } });
    },
  });
  const issues = issuesOf(create.error);
  const set = (k: keyof typeof person) => (e: React.ChangeEvent<HTMLInputElement>) => setPerson({ ...person, [k]: e.target.value });

  return (
    <form
      className="stack-lg"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <PageHead title="Novo aluno" subtitle="Depois de cadastrar, matricule o aluno numa turma pela ficha dele ou pela turma." />
      <section className="panel stack">
        <div className="grid-fields">
          <Field label="Nome completo" htmlFor="s-name" errors={issues.name}>
            <input id="s-name" required value={person.name} onChange={set("name")} />
          </Field>
          <Field label="E-mail pessoal" htmlFor="s-email" errors={issues.email} hint="Se ele também trabalhar na escola, o corporativo entra pelo convite de acesso.">
            <input id="s-email" type="email" value={person.email} onChange={set("email")} />
          </Field>
          <Field label="Telefone" htmlFor="s-phone" errors={issues.phone}>
            <input id="s-phone" inputMode="tel" value={person.phone} onChange={set("phone")} />
          </Field>
          <Field label="CPF" htmlFor="s-cpf" errors={issues.cpf} hint="Opcional, mas evita cadastro duplicado">
            <input id="s-cpf" inputMode="numeric" value={person.cpf} onChange={set("cpf")} />
          </Field>
          <Field label="Data de nascimento" htmlFor="s-birth" errors={issues.birthDate}>
            <input id="s-birth" type="date" value={person.birthDate} onChange={set("birthDate")} />
          </Field>
        </div>
      </section>
      <section className="panel stack">
        <h2>Disponibilidade</h2>
        <p className="muted small">Opcional. Ajuda a encontrar turma e horário de aula particular.</p>
        <AvailabilityGrid value={availability} onChange={setAvailability} />
      </section>
      <PersonExists error={create.error} />
      <FormError error={create.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          Cadastrar aluno
        </button>
        <Link to="/e/$slug/alunos" params={{ slug }} className="btn">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------- ficha */

export function StudentDetail() {
  const { slug, studentId } = useParams({ strict: false }) as { slug: string; studentId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["student", slug, studentId], queryFn: () => school.student(slug, studentId) });
  const [tab, setTab] = useState<"matriculas" | "financeiro" | "aulas" | "dados">("matriculas");
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["student", slug, studentId] }),
      qc.invalidateQueries({ queryKey: ["students", slug] }),
      qc.invalidateQueries({ queryKey: ["installments", slug] }),
      qc.invalidateQueries({ queryKey: ["finance", slug] }),
    ]);
  const status = useMutation({ mutationFn: (s: StudentStatus | "reativar") => school.setStudentStatus(slug, studentId, s), onSuccess: refresh });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;
  const { student: s, enrollments, installments, lessons } = q.data;
  const active = enrollments.filter((e) => !e.endedAt);
  const overdue = installments.filter((i) => i.status === "vencida");
  const off = s.status === "inativo" || s.status === "cancelado";

  return (
    <div className="stack-lg">
      <nav className="crumbs" aria-label="Trilha">
        <Link to="/e/$slug/alunos" params={{ slug }}>
          Alunos
        </Link>
        <span aria-hidden="true">/</span>
        <span>{s.person.name}</span>
      </nav>
      <PageHead
        title={s.person.name}
        subtitle={
          <>
            <StudentStatusBadge status={s.status} />{" "}
            {s.company && (
              <>
                <Link to="/e/$slug/empresas/$companyId" params={{ slug, companyId: s.company.id }}>
                  {s.company.name}
                </Link>{" "}
                ({s.company.model.toUpperCase()}) ·{" "}
              </>
            )}
            {s.person.email ?? "sem e-mail"} · {formatPhone(s.person.phone)} · CPF {formatCpf(s.person.cpf)}
          </>
        }
        actions={
          off ? (
            <button type="button" className="btn" onClick={() => status.mutate("reativar")}>
              Reativar{s.previousStatus ? ` (volta como ${STUDENT_STATUS_LABELS[s.previousStatus].toLowerCase()})` : ""}
            </button>
          ) : (
            <select
              aria-label="Mudar situação"
              value=""
              onChange={(e) => {
                const next = e.target.value as StudentStatus;
                if (!next) return;
                if (next === "cancelado" && !confirm("Cancelar o aluno encerra todas as matrículas ativas e cancela as parcelas futuras. Continuar?")) return;
                status.mutate(next);
              }}
            >
              <option value="">Mudar situação…</option>
              {STUDENT_STATUSES.filter((x) => x !== s.status && x !== "inadimplente").map((x) => (
                <option key={x} value={x}>
                  {STUDENT_STATUS_LABELS[x]}
                </option>
              ))}
            </select>
          )
        }
      />
      <ActionError error={status.error} />

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Matrículas ativas</span>
          <strong className="stat-value">{active.length}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Saldo de aulas</span>
          <strong className="stat-value">{active.reduce((n, e) => n + e.balance, 0)}</strong>
        </div>
        <div className={`stat${overdue.length ? " stat-danger" : ""}`}>
          <span className="stat-label">Vencido</span>
          <strong className="stat-value small-value">{money(overdue.reduce((n, i) => n + i.amountCents - i.paidCents, 0))}</strong>
          <span className="stat-hint">{overdue.length} parcela(s)</span>
        </div>
        <div className="stat">
          <span className="stat-label">Presença (30 dias)</span>
          <strong className="stat-value">{presenceRate(lessons)}</strong>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ["matriculas", "Matrículas"],
            ["financeiro", "Financeiro"],
            ["aulas", "Aulas"],
            ["dados", "Dados e disponibilidade"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "tab on" : "tab"} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "matriculas" && <EnrollmentsTab slug={slug} studentId={s.id} enrollments={enrollments} onChange={refresh} canEnroll={!off} />}
      {tab === "financeiro" && <FinanceTab slug={slug} installments={installments} onChange={refresh} />}
      {tab === "aulas" && <LessonsTab slug={slug} lessons={lessons} />}
      {tab === "dados" && <DataTab slug={slug} student={s} onChange={refresh} />}
    </div>
  );
}

function presenceRate(lessons: Awaited<ReturnType<typeof school.student>>["lessons"]) {
  const p = lessons.filter((l) => l.myStatus === "presente").length;
  const f = lessons.filter((l) => l.myStatus === "falta").length;
  return p + f ? `${Math.round((p / (p + f)) * 100)}%` : "—";
}

function EnrollmentsTab({ slug, studentId, enrollments, onChange, canEnroll }: { slug: string; studentId: string; enrollments: Enrollment[]; onChange: () => Promise<unknown>; canEnroll: boolean }) {
  const groups = useQuery({ queryKey: ["class-groups", slug], queryFn: () => school.classGroups(slug) });
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const [adding, setAdding] = useState(false);
  const [regime, setRegime] = useState<ClassRegime>("regular");
  const [classGroupId, setClassGroupId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [installments, setInstallments] = useState("6");
  const [ledgerOf, setLedgerOf] = useState<string | null>(null);
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: onChange });
  const create = useMutation({
    mutationFn: () =>
      school.createEnrollment(
        slug,
        regime === "open_entry"
          ? { studentId, regime, courseId, moduleId, contract: { installments: Number(installments) } }
          : { studentId, classGroupId, contract: { installments: Number(installments) } },
      ),
    onSuccess: async () => {
      setAdding(false);
      setClassGroupId("");
      setCourseId("");
      setModuleId("");
      await onChange();
    },
  });

  // turmas regulares com vaga; a open-entry não entra aqui, porque nela ninguém se matricula
  const available = (groups.data?.classGroups ?? []).filter((g) => !g.deactivatedAt && g.regime !== "open_entry" && g.enrolled < g.capacity);
  // só curso com módulo pode ter open-entry: o módulo é o nível
  const openCourses = (courses.data?.courses ?? []).filter((c) => !c.deactivatedAt && c.modules.some((m) => !m.deactivatedAt));
  const openCourse = openCourses.find((c) => c.id === courseId);

  return (
    <section className="panel stack">
      <div className="row">
        <h2>Matrículas</h2>
        {canEnroll && !adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Nova matrícula
          </button>
        )}
      </div>
      {adding && (
        <form
          className="subpanel inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Regime" htmlFor="ne-regime" hint={REGIME_HINTS[regime]}>
            <select id="ne-regime" value={regime} onChange={(e) => setRegime(e.target.value as ClassRegime)}>
              <option value="regular">{REGIME_LABELS.regular}</option>
              <option value="open_entry">{REGIME_LABELS.open_entry}</option>
            </select>
          </Field>
          {regime === "open_entry" ? (
            <>
              <Field label="Curso" htmlFor="ne-course">
                <select
                  id="ne-course"
                  required
                  value={courseId}
                  onChange={(e) => {
                    setCourseId(e.target.value);
                    setModuleId("");
                  }}
                >
                  <option value="">Escolha…</option>
                  {openCourses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nível" htmlFor="ne-module" hint="É ele que limita o que o aluno pode reservar.">
                <select id="ne-module" required value={moduleId} onChange={(e) => setModuleId(e.target.value)} disabled={!openCourse}>
                  <option value="">Escolha…</option>
                  {openCourse?.modules
                    .filter((m) => !m.deactivatedAt)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
            </>
          ) : (
            <Field label="Turma (só as que têm vaga)" htmlFor="ne-group">
              <select id="ne-group" required value={classGroupId} onChange={(e) => setClassGroupId(e.target.value)}>
                <option value="">Escolha…</option>
                {available.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.courseName} · {g.name} ({g.enrolled}/{g.capacity})
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Parcelas" htmlFor="ne-inst">
            <select id="ne-inst" value={installments} onChange={(e) => setInstallments(e.target.value)}>
              {[1, 2, 3, 4, 6, 10, 12].map((n) => (
                <option key={n} value={n}>
                  {n}x
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            Matricular
          </button>
          <button type="button" className="btn" onClick={() => setAdding(false)}>
            Cancelar
          </button>
          <ActionError error={create.error} />
        </form>
      )}
      {enrollments.length === 0 ? (
        <p className="muted">Nenhuma matrícula.</p>
      ) : (
        <table className="compact">
          <thead>
            <tr>
              <th>Curso e turma</th>
              <th>Contrato</th>
              <th className="num">Saldo</th>
              <th>Uso do pacote</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {enrollments.map((e) => (
              <tr key={e.id} className={e.endedAt ? "is-off" : undefined}>
                <td>
                  <span className="title-with-dot">
                    <ColorDot color={e.courseColor} />
                    {e.courseName}
                  </span>
                  <div className="small">
                    {e.classGroupId ? (
                      <Link to="/e/$slug/turmas/$classGroupId" params={{ slug, classGroupId: e.classGroupId }}>
                        {e.className}
                      </Link>
                    ) : (
                      <>
                        <Badge tone="info">Open-entry</Badge> {e.moduleName ?? "sem nível"}
                      </>
                    )}
                    {e.endedAt && <Badge tone="muted">Encerrada em {fmtDate(e.endedAt)}</Badge>}
                  </div>
                </td>
                <td className="small">
                  {fmtIsoDate(e.startsOn)} a {fmtIsoDate(e.endsOn)}
                  <div className="muted">{e.packageLessons} aulas</div>
                </td>
                <td className="num">{e.balance}</td>
                <td>
                  <UsageBar used={e.used} granted={e.granted} />
                </td>
                <td className="right">
                  <span className="actions">
                    <button type="button" className="btn-link" onClick={() => setLedgerOf(ledgerOf === e.id ? null : e.id)}>
                      Extrato
                    </button>
                    {e.endedAt ? (
                      <button type="button" className="btn-link" onClick={() => act.mutate(() => school.reactivateEnrollment(slug, e.id))}>
                        Reativar
                      </button>
                    ) : (
                      <>
                        <TransferButton slug={slug} enrollment={e} onDone={onChange} />
                        <button
                          type="button"
                          className="btn-link danger"
                          onClick={() => confirm("Encerrar a matrícula? O aluno sai das próximas aulas e as parcelas futuras em aberto são canceladas.") && act.mutate(() => school.endEnrollment(slug, e.id))}
                        >
                          Encerrar
                        </button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ActionError error={act.error} />
      {ledgerOf && <Ledger slug={slug} enrollmentId={ledgerOf} onChange={onChange} />}
    </section>
  );
}

function TransferButton({ slug, enrollment, onDone }: { slug: string; enrollment: Enrollment; onDone: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const groups = useQuery({ queryKey: ["class-groups", slug], queryFn: () => school.classGroups(slug), enabled: open });
  const move = useMutation({
    mutationFn: (classGroupId: string) => school.transferEnrollment(slug, enrollment.id, classGroupId),
    onSuccess: async () => {
      setOpen(false);
      await onDone();
    },
  });
  if (!open)
    return (
      <button type="button" className="btn-link" onClick={() => setOpen(true)}>
        Trocar turma
      </button>
    );
  const options = (groups.data?.classGroups ?? []).filter((g) => g.courseId === enrollment.courseId && g.id !== enrollment.classGroupId && !g.deactivatedAt);
  return (
    <span className="actions">
      <select aria-label="Nova turma" defaultValue="" onChange={(e) => e.target.value && move.mutate(e.target.value)}>
        <option value="">{groups.isPending ? "Carregando…" : options.length ? "Nova turma…" : "Nenhuma outra turma do curso"}</option>
        {options.map((g) => (
          <option key={g.id} value={g.id} disabled={g.enrolled >= g.capacity}>
            {g.name} ({g.enrolled}/{g.capacity})
          </option>
        ))}
      </select>
      <button type="button" className="btn-link" onClick={() => setOpen(false)}>
        Fechar
      </button>
      <ActionError error={move.error} />
    </span>
  );
}

function Ledger({ slug, enrollmentId, onChange }: { slug: string; enrollmentId: string; onChange: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["credits", slug, enrollmentId], queryFn: () => school.credits(slug, enrollmentId) });
  const [amount, setAmount] = useState("");
  const [justification, setJustification] = useState("");
  const add = useMutation({
    mutationFn: () => school.addCredits(slug, enrollmentId, { kind: "ajuste", amount: Number(amount), justification }),
    onSuccess: async () => {
      setAmount("");
      setJustification("");
      await Promise.all([qc.invalidateQueries({ queryKey: ["credits", slug, enrollmentId] }), onChange()]);
    },
  });
  const issues = issuesOf(add.error);
  return (
    <div className="subpanel stack">
      <h3>Extrato de créditos</h3>
      {q.isPending ? (
        <Loading />
      ) : (
        <table className="compact">
          <tbody>
            {q.data?.entries.map(({ entry, lessonStartsAt }) => (
              <tr key={entry.id}>
                <td className="small">{fmtDate(entry.createdAt)}</td>
                <td>
                  {CREDIT_KIND_LABELS[entry.kind] ?? entry.kind}
                  {lessonStartsAt && <span className="muted small"> · aula de {fmtShortDate(lessonStartsAt)}</span>}
                  {entry.justification && <div className="muted small">{entry.justification}</div>}
                </td>
                <td className={`num ${entry.amount > 0 ? "ok" : "error"}`}>{entry.amount > 0 ? `+${entry.amount}` : entry.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Ajuste (+ ou −)" htmlFor="adj-amount" errors={issues.amount}>
          <input id="adj-amount" inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="ex.: 2 ou -1" />
        </Field>
        <Field label="Justificativa" htmlFor="adj-just" errors={issues.justification}>
          <input id="adj-just" required value={justification} onChange={(e) => setJustification(e.target.value)} />
        </Field>
        <button type="submit" className="btn" disabled={add.isPending}>
          Lançar ajuste
        </button>
      </form>
      <FormError error={add.error} />
    </div>
  );
}

function FinanceTab({ slug, installments, onChange }: { slug: string; installments: Installment[]; onChange: () => Promise<unknown> }) {
  if (installments.length === 0) return <Empty>Nenhuma parcela. Matrículas de turma corporativa não geram cobrança individual.</Empty>;
  return (
    <section className="panel stack">
      <h2>Parcelas</h2>
      <InstallmentsTable slug={slug} installments={installments} onChange={onChange} showStudent={false} />
    </section>
  );
}

export function InstallmentsTable({ slug, installments, onChange, showStudent = true }: { slug: string; installments: Installment[]; onChange: () => Promise<unknown>; showStudent?: boolean }) {
  const [paying, setPaying] = useState<string | null>(null);
  return (
    <table className="compact">
      <thead>
        <tr>
          {showStudent && <th>Aluno</th>}
          <th>Curso</th>
          <th>Parcela</th>
          <th>Vencimento</th>
          <th className="num">Valor</th>
          <th className="num">Pago</th>
          <th>Situação</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {installments.map((i) => (
          <tr key={i.id}>
            {showStudent && (
              <td>
                <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: i.studentId }}>
                  {i.studentName}
                </Link>
              </td>
            )}
            <td className="small">{i.courseName}</td>
            <td className="small">
              {i.number}/{i.installmentsCount}
            </td>
            <td className="small">{fmtIsoDate(i.dueDate)}</td>
            <td className="num">{money(i.amountCents)}</td>
            <td className="num">{i.paidCents ? money(i.paidCents) : "—"}</td>
            <td>
              <InstallmentBadge status={i.status} daysLate={i.daysLate} />
            </td>
            <td className="right">
              <span className="cell-actions">
              {(i.status === "vencida" || i.status === "a_vencer") &&
                (paying === i.id ? (
                  <PayForm slug={slug} installment={i} onClose={() => setPaying(null)} onDone={onChange} />
                ) : (
                  <button type="button" className="btn-link" onClick={() => setPaying(i.id)}>
                    Registrar pagamento
                  </button>
                ))}
              {i.paidCents > 0 && <Payments slug={slug} installmentId={i.id} onChange={onChange} />}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PayForm({ slug, installment: i, onClose, onDone }: { slug: string; installment: Installment; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [amount, setAmount] = useState(((i.amountCents - i.paidCents) / 100).toFixed(2).replace(".", ","));
  const [paidOn, setPaidOn] = useState(todayIso());
  const pay = useMutation({
    mutationFn: () => school.registerPayment(slug, i.id, { method, amountCents: parseReais(amount) ?? undefined, paidOn }),
    onSuccess: async () => {
      onClose();
      await onDone();
    },
  });
  return (
    <form
      className="pay-form"
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate();
      }}
    >
      <select aria-label="Forma de pagamento" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
        {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <input aria-label="Valor" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input aria-label="Data do pagamento" type="date" value={paidOn} max={todayIso()} onChange={(e) => setPaidOn(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={pay.isPending}>
        Confirmar
      </button>
      <button type="button" className="btn-link" onClick={onClose}>
        Cancelar
      </button>
      <ActionError error={pay.error} />
    </form>
  );
}

function Payments({ slug, installmentId, onChange }: { slug: string; installmentId: string; onChange: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["payments", slug, installmentId], queryFn: () => school.payments(slug, installmentId), enabled: open });
  const reverse = useMutation({
    mutationFn: ({ id, justification }: { id: string; justification: string }) => school.reversePayment(slug, id, justification),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["payments", slug, installmentId] }), onChange()]);
    },
  });
  if (!open)
    return (
      <button type="button" className="btn-link" onClick={() => setOpen(true)}>
        Pagamentos
      </button>
    );
  const payments = q.data?.payments ?? [];
  const reversed = new Set(payments.map((p) => p.reversalOfId).filter(Boolean));
  return (
    <div className="payments">
      {payments.map((p) => (
        <div key={p.id} className="small">
          {fmtIsoDate(p.paidOn)} · {PAYMENT_METHOD_LABELS[p.method]} · <span className={p.amountCents < 0 ? "error" : undefined}>{money(p.amountCents)}</span>
          {p.reversalOfId && <span className="muted"> estorno: {p.justification}</span>}
          {p.amountCents > 0 && !reversed.has(p.id) && (
            <button
              type="button"
              className="btn-link danger"
              onClick={() => {
                const j = prompt("Justificativa do estorno");
                if (j) reverse.mutate({ id: p.id, justification: j });
              }}
            >
              Estornar
            </button>
          )}
        </div>
      ))}
      <ActionError error={reverse.error} />
      <button type="button" className="btn-link" onClick={() => setOpen(false)}>
        Fechar
      </button>
    </div>
  );
}

function LessonsTab({ slug, lessons }: { slug: string; lessons: Awaited<ReturnType<typeof school.student>>["lessons"] }) {
  const now = Date.now();
  const upcoming = lessons.filter((l) => new Date(l.startsAt).getTime() >= now);
  const past = lessons.filter((l) => new Date(l.startsAt).getTime() < now).reverse();
  const myBadge = (l: (typeof lessons)[number]) =>
    l.myStatus === "presente" ? (
      <Badge tone="ok">Presente</Badge>
    ) : l.myStatus === "falta" ? (
      <Badge tone="danger">Falta</Badge>
    ) : l.myStatus === "cancelou" ? (
      <Badge tone={l.cancelledInTime ? "muted" : "warn"}>{l.cancelledInTime ? "Cancelou no prazo" : "Cancelou fora do prazo"}</Badge>
    ) : (
      <LessonStateBadge lesson={l} />
    );
  return (
    <div className="grid-2">
      {[
        ["Próximas aulas", upcoming],
        ["Últimos 30 dias", past],
      ].map(([title, list]) => (
        <section key={title as string} className="panel stack">
          <h2>{title as string}</h2>
          {(list as typeof lessons).length === 0 ? (
            <p className="muted">Nenhuma aula.</p>
          ) : (
            <ul className="lesson-list">
              {(list as typeof lessons).map((l) => (
                <li key={l.id}>
                  <Link to="/e/$slug/aulas/$lessonId" params={{ slug, lessonId: l.id }} className="lesson-link">
                    <span className="lesson-time">
                      {fmtWeekday(l.startsAt)} {fmtShortDate(l.startsAt)} {fmtTime(l.startsAt)}
                    </span>
                    <span className="lesson-main small">
                      {l.className}
                      <span className="muted"> · {l.teacherName ?? "sem professor"}</span>
                    </span>
                    {myBadge(l)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function DataTab({ slug, student: s, onChange }: { slug: string; student: Awaited<ReturnType<typeof school.student>>["student"]; onChange: () => Promise<unknown> }) {
  const [person, setPerson] = useState({
    name: s.person.name,
    email: s.person.email ?? "",
    phone: s.person.phone ?? "",
    cpf: s.person.cpf ?? "",
    birthDate: s.person.birthDate ?? "",
  });
  const [availability, setAvailability] = useState(s.availability);
  const save = useMutation({
    mutationFn: () =>
      school.updateStudent(slug, s.id, {
        person: { name: person.name, email: person.email || null, phone: person.phone || null, cpf: person.cpf || null, birthDate: person.birthDate || null },
        availability,
      }),
    onSuccess: onChange,
  });
  const issues = issuesOf(save.error);
  const set = (k: keyof typeof person) => (e: React.ChangeEvent<HTMLInputElement>) => setPerson({ ...person, [k]: e.target.value });
  return (
    <form
      className="stack-lg"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <section className="panel stack">
        <h2>Dados pessoais</h2>
        <div className="grid-fields">
          <Field label="Nome completo" htmlFor="d-name" errors={issues.name}>
            <input id="d-name" required value={person.name} onChange={set("name")} />
          </Field>
          <Field label="E-mail" htmlFor="d-email" errors={issues.email}>
            <input id="d-email" type="email" value={person.email} onChange={set("email")} />
          </Field>
          <Field label="Telefone" htmlFor="d-phone" errors={issues.phone}>
            <input id="d-phone" value={person.phone} onChange={set("phone")} />
          </Field>
          <Field label="CPF" htmlFor="d-cpf" errors={issues.cpf}>
            <input id="d-cpf" value={person.cpf} onChange={set("cpf")} />
          </Field>
          <Field label="Data de nascimento" htmlFor="d-birth" errors={issues.birthDate}>
            <input id="d-birth" type="date" value={person.birthDate} onChange={set("birthDate")} />
          </Field>
        </div>
      </section>
      <section className="panel stack">
        <h2>Disponibilidade</h2>
        <AvailabilityGrid value={availability} onChange={setAvailability} />
      </section>
      <FormError error={save.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          Salvar
        </button>
        {save.isSuccess && <span className="ok">Salvo</span>}
      </div>
    </form>
  );
}
