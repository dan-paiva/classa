import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { school } from "../api-school.ts";
import { addDaysIso, fmtIsoDate, money, plural, todayIso } from "../lib/format.ts";
import { canDo, useMembership } from "../lib/permissions.ts";
import { Badge, ColorDot, Empty, LoadError, Loading, PageHead, Stat } from "../ui.tsx";

type TabKey = "financeiro" | "frequencia" | "professores" | "matriculas";
const TABS: { key: TabKey; label: string; resource: string }[] = [
  { key: "financeiro", label: "Financeiro", resource: "financeiro" },
  { key: "frequencia", label: "Frequência", resource: "turmas" },
  { key: "professores", label: "Professores", resource: "professores" },
  { key: "matriculas", label: "Matrículas", resource: "alunos" },
];

const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mm) - 1]}/${y!.slice(2)}`;
};

/** Baixa a tabela como CSV, para abrir no Excel ou no Google Planilhas. */
function downloadCsv(name: string, headers: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn" onClick={onClick}>
      Baixar planilha
    </button>
  );
}

/** Barra proporcional ao maior valor da coluna, para comparar de bater o olho. */
function Bar({ value, max, tone = "ok" }: { value: number; max: number; tone?: "ok" | "warn" | "danger" | "info" }) {
  const pct = max > 0 ? Math.max(0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="mini-bar" title={`${pct}%`}>
      <span className={`mini-bar-fill tone-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Reports() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const membership = useMembership();
  const available = TABS.filter((t) => canDo(membership, t.resource, "ver"));
  const [tab, setTab] = useState<TabKey>(available[0]?.key ?? "financeiro");

  if (available.length === 0) return <Empty>Seu perfil não tem acesso a nenhum relatório.</Empty>;
  const current = available.some((t) => t.key === tab) ? tab : available[0]!.key;

  return (
    <div className="stack-lg">
      <PageHead title="Relatórios" subtitle="Números do período para acompanhar a escola e exportar para planilha." />
      <div className="tabs">
        {available.map((t) => (
          <button key={t.key} type="button" className={`tab ${current === t.key ? "on" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {current === "financeiro" && <FinanceReport slug={slug} />}
      {current === "frequencia" && <AttendanceReport slug={slug} />}
      {current === "professores" && <TeacherReport slug={slug} />}
      {current === "matriculas" && <EnrollmentReport slug={slug} />}
    </div>
  );
}

/* --------------------------------------------------------------- financeiro */

function FinanceReport({ slug }: { slug: string }) {
  const [months, setMonths] = useState(6);
  const q = useQuery({ queryKey: ["report", "financeiro", slug, months], queryFn: () => school.reportFinance(slug, months) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;

  const rows = q.data.months;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.receivedCents, r.recognizedCents)));
  const total = rows.reduce(
    (t, r) => ({ received: t.received + r.receivedCents, recognized: t.recognized + r.recognizedCents, payroll: t.payroll + r.payrollCents }),
    { received: 0, recognized: 0, payroll: 0 },
  );

  return (
    <div className="stack">
      <div className="toolbar">
        <MonthsPicker value={months} onChange={setMonths} />
        <ExportButton
          onClick={() =>
            downloadCsv(
              `classa-financeiro-${rows.at(-1)?.month}`,
              ["Mês", "Recebido", "Receita das aulas dadas", "Custo com professores", "Margem", "Aulas", "Alunos"],
              rows.map((r) => [r.month, r.receivedCents / 100, r.recognizedCents / 100, r.payrollCents / 100, r.marginCents / 100, r.lessons, r.students]),
            )
          }
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th className="num">Recebido</th>
              <th className="num">Aulas dadas</th>
              <th className="num">Professores</th>
              <th className="num">Margem</th>
              <th>Comparação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td>
                  {monthLabel(r.month)}
                  {r.payrollStatus !== "fechada" && r.payrollCents > 0 && <div className="muted small">folha em aberto</div>}
                </td>
                <td className="num">{money(r.receivedCents)}</td>
                <td className="num">
                  {money(r.recognizedCents)}
                  <div className="muted small">{plural(r.lessons, "aula", "aulas")}</div>
                </td>
                <td className="num">{money(r.payrollCents)}</td>
                <td className={`num ${r.marginCents < 0 ? "negative" : ""}`}>{money(r.marginCents)}</td>
                <td style={{ minWidth: 160 }}>
                  <Bar value={r.receivedCents} max={max} tone="info" />
                  <Bar value={r.recognizedCents} max={max} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th className="num">{money(total.received)}</th>
              <th className="num">{money(total.recognized)}</th>
              <th className="num">{money(total.payroll)}</th>
              <th className="num">{money(total.recognized - total.payroll)}</th>
              <th />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small">
        <strong>Recebido</strong> é o dinheiro que entrou no mês (barra azul). <strong>Aulas dadas</strong> é quanto valem as aulas concluídas no mês (barra verde), esteja a parcela paga ou não.{" "}
        <strong>Professores</strong> vem da folha do mesmo mês.
      </p>
    </div>
  );
}

function MonthsPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label className="inline-field">
      Período
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={3}>últimos 3 meses</option>
        <option value={6}>últimos 6 meses</option>
        <option value={12}>últimos 12 meses</option>
      </select>
    </label>
  );
}

function RangePicker({ from, to, onChange }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  return (
    <>
      <label className="inline-field">
        De
        <input type="date" value={from} max={to} onChange={(e) => onChange({ from: e.target.value, to })} />
      </label>
      <label className="inline-field">
        até
        <input type="date" value={to} min={from} onChange={(e) => onChange({ from, to: e.target.value })} />
      </label>
    </>
  );
}

/* --------------------------------------------------------------- frequência */

function AttendanceReport({ slug }: { slug: string }) {
  const [range, setRange] = useState({ from: addDaysIso(todayIso(), -30), to: todayIso() });
  const q = useQuery({ queryKey: ["report", "frequencia", slug, range], queryFn: () => school.reportAttendance(slug, range) });

  return (
    <div className="stack">
      <div className="toolbar">
        <RangePicker from={range.from} to={range.to} onChange={setRange} />
        {q.data && (
          <ExportButton
            onClick={() =>
              downloadCsv(
                `classa-frequencia-${range.from}-a-${range.to}`,
                ["Turma", "Curso", "Aulas", "Presenças", "Faltas", "Cancelou a tempo", "Cancelou em cima da hora", "Presença %"],
                q.data.groups.map((g) => [g.className, g.courseName, g.lessons, g.present, g.absent, g.cancelledInTime, g.cancelledLate, g.attendancePercent]),
              )
            }
          />
        )}
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} />
      ) : q.data.totals.lessons === 0 ? (
        <Empty>Nenhuma aula concluída neste período.</Empty>
      ) : (
        <>
          <div className="stats">
            <Stat label="Aulas concluídas" value={q.data.totals.lessons} />
            <Stat label="Presenças" value={q.data.totals.present} />
            <Stat label="Faltas" value={q.data.totals.absent} tone={q.data.totals.absent ? "warn" : undefined} />
            <Stat label="Presença média" value={`${q.data.totals.attendancePercent ?? 0}%`} tone={(q.data.totals.attendancePercent ?? 100) < 80 ? "danger" : "ok"} />
          </div>
          <div className="grid-2">
            <section className="panel stack">
              <h2>Por turma</h2>
              <table className="compact">
                <tbody>
                  {q.data.groups.map((g) => (
                    <tr key={g.classGroupId}>
                      <td>
                        <Link to="/e/$slug/turmas/$classGroupId" params={{ slug, classGroupId: g.classGroupId }} className="title-with-dot">
                          <ColorDot color={g.courseColor} />
                          {g.className}
                        </Link>
                        <div className="muted small">
                          {plural(g.lessons, "aula", "aulas")} · {g.present} presenças · {g.absent} faltas
                          {g.cancelledLate > 0 && ` · ${g.cancelledLate} cancelou em cima da hora`}
                        </div>
                      </td>
                      <td className="num" style={{ width: 150 }}>
                        <Bar value={g.attendancePercent ?? 0} max={100} tone={(g.attendancePercent ?? 0) < 80 ? "warn" : "ok"} />
                        <span className="small">{g.attendancePercent ?? "—"}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="panel stack">
              <h2>Alunos que mais faltaram</h2>
              {q.data.students.length === 0 ? (
                <p className="muted">Ninguém faltou no período.</p>
              ) : (
                <table className="compact">
                  <tbody>
                    {q.data.students.map((s) => (
                      <tr key={s.studentId}>
                        <td>
                          <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: s.studentId }}>
                            {s.studentName}
                          </Link>
                        </td>
                        <td className="muted small">
                          {[s.absent > 0 && plural(s.absent, "falta", "faltas"), s.cancelledLate > 0 && `${plural(s.cancelledLate, "cancelamento", "cancelamentos")} em cima da hora`]
                            .filter(Boolean)
                            .join(" · ")}
                        </td>
                        <td className="num">
                          <Badge tone={(s.attendancePercent ?? 100) < 75 ? "danger" : "warn"}>{s.attendancePercent ?? "—"}%</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted small">Quem está abaixo de 75% costuma ser o primeiro a cancelar a matrícula: vale um contato.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- professores */

function TeacherReport({ slug }: { slug: string }) {
  const [range, setRange] = useState({ from: addDaysIso(todayIso(), -30), to: todayIso() });
  const q = useQuery({ queryKey: ["report", "professores", slug, range], queryFn: () => school.reportTeachers(slug, range) });
  const withCost = q.data?.teachers.some((t) => t.costCents != null) ?? false;

  return (
    <div className="stack">
      <div className="toolbar">
        <RangePicker from={range.from} to={range.to} onChange={setRange} />
        {q.data && (
          <ExportButton
            onClick={() =>
              downloadCsv(
                `classa-professores-${range.from}-a-${range.to}`,
                ["Professor", "Aulas dadas", "Horas", "Aulas por semana", "Limite semanal", "Substituições", "Apoio", "Canceladas", "Não finalizadas", "Custo"],
                q.data.teachers.map((t) => [
                  t.teacherName,
                  t.lessons,
                  t.hours,
                  t.lessonsPerWeek,
                  t.weeklyLimit ?? "",
                  t.substitutions,
                  t.support,
                  t.cancelled,
                  t.unfinished,
                  t.costCents == null ? "" : t.costCents / 100,
                ]),
              )
            }
          />
        )}
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} />
      ) : q.data.teachers.length === 0 ? (
        <Empty>Nenhuma aula neste período.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Professor</th>
                <th className="num">Aulas dadas</th>
                <th className="num">Horas</th>
                <th className="num">Por semana</th>
                <th className="num">Substituições</th>
                <th className="num">Apoio</th>
                {withCost && <th className="num">Custo</th>}
              </tr>
            </thead>
            <tbody>
              {q.data.teachers.map((t) => (
                <tr key={t.teacherId}>
                  <td>
                    <Link to="/e/$slug/professores/$teacherId" params={{ slug, teacherId: t.teacherId }}>
                      {t.teacherName}
                    </Link>
                    {t.unfinished > 0 && <div className="muted small">{plural(t.unfinished, "aula não finalizada", "aulas não finalizadas")}</div>}
                  </td>
                  <td className="num">
                    {t.lessons}
                    {t.cancelled > 0 && <div className="muted small">{t.cancelled} canceladas</div>}
                  </td>
                  <td className="num">{t.hours.toLocaleString("pt-BR")}</td>
                  <td className="num">
                    {t.lessonsPerWeek.toLocaleString("pt-BR")}
                    {t.weeklyLimit != null && (
                      <div className={`small ${t.overLimit ? "negative" : "muted"}`}>
                        limite {t.weeklyLimit}/semana{t.overLimit ? " · acima" : ""}
                      </div>
                    )}
                  </td>
                  <td className="num">{t.substitutions || "—"}</td>
                  <td className="num">{t.support || "—"}</td>
                  {withCost && <td className="num">{t.costCents == null ? "—" : money(t.costCents)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        O período tem {q.data ? plural(q.data.weeks, "semana", "semanas") : "—"}; "por semana" é a média nesse intervalo, comparada ao limite de cada professor. O custo conta só as aulas já pagas pela folha.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- matrículas */

/** Ordem fixa, do melhor para o pior, com singular e plural certos. */
const STATUS_LABEL: [status: string, one: string, many: string][] = [
  ["ativo", "ativo", "ativos"],
  ["inadimplente", "inadimplente", "inadimplentes"],
  ["congelado", "congelado", "congelados"],
  ["suspenso", "suspenso", "suspensos"],
  ["inativo", "inativo", "inativos"],
  ["cancelado", "cancelado", "cancelados"],
];

function EnrollmentReport({ slug }: { slug: string }) {
  const [months, setMonths] = useState(6);
  const q = useQuery({ queryKey: ["report", "matriculas", slug, months], queryFn: () => school.reportEnrollments(slug, months) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;

  const rows = q.data.months;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.started, r.ended)));
  const total = rows.reduce((t, r) => ({ started: t.started + r.started, ended: t.ended + r.ended }), { started: 0, ended: 0 });

  return (
    <div className="stack">
      <div className="toolbar">
        <MonthsPicker value={months} onChange={setMonths} />
        <ExportButton
          onClick={() =>
            downloadCsv(
              `classa-matriculas-${rows.at(-1)?.month}`,
              ["Mês", "Novas matrículas", "Encerradas", "Saldo"],
              rows.map((r) => [r.month, r.started, r.ended, r.started - r.ended]),
            )
          }
        />
      </div>
      <div className="grid-2">
        <section className="panel stack">
          <h2>Entradas e saídas</h2>
          <table className="compact">
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)}</td>
                  <td style={{ width: 140 }}>
                    <Bar value={r.started} max={max} />
                    <Bar value={r.ended} max={max} tone="danger" />
                  </td>
                  <td className="num small">
                    +{r.started} / −{r.ended}
                  </td>
                  <td className={`num ${r.started - r.ended < 0 ? "negative" : ""}`}>{r.started - r.ended > 0 ? `+${r.started - r.ended}` : r.started - r.ended}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <th />
                <th className="num small">
                  +{total.started} / −{total.ended}
                </th>
                <th className="num">{total.started - total.ended > 0 ? `+${total.started - total.ended}` : total.started - total.ended}</th>
              </tr>
            </tfoot>
          </table>
        </section>
        <section className="panel stack">
          <h2>Alunos hoje</h2>
          <ul className="chip-list">
            {STATUS_LABEL.map(([status, one, many]) => {
              const n = q.data.byStatus.find((s) => s.status === status)?.n ?? 0;
              if (n === 0) return null;
              return (
                <li key={status}>
                  <Badge tone={status === "ativo" ? "ok" : status === "inadimplente" ? "danger" : "neutral"}>{plural(n, one, many)}</Badge>
                </li>
              );
            })}
          </ul>
          <h2>Matrículas ativas por curso</h2>
          <table className="compact">
            <tbody>
              {q.data.byCourse.map((c) => (
                <tr key={c.courseName}>
                  <td className="title-with-dot">
                    <ColorDot color={c.courseColor} />
                    {c.courseName}
                  </td>
                  <td className="num">{c.active}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <p className="muted small">Uma matrícula conta no mês em que começou; a saída conta no mês em que foi encerrada. Período de {fmtIsoDate(`${rows[0]?.month}-01`)} em diante.</p>
    </div>
  );
}
