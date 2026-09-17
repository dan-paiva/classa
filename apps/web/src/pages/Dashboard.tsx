import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "@tanstack/react-router";
import { useMembership } from "../lib/permissions.ts";
import { school } from "../api-school.ts";
import { addDaysIso, fmtShortDate, fmtTime, fmtWeekday, money, todayIso } from "../lib/format.ts";
import { LessonStateBadge, UsageBar } from "../status.tsx";
import { Badge, ColorDot, Empty, Loading, PageHead, Stat } from "../ui.tsx";

/** Para onde cada alerta leva: o alerta serve para resolver, não só para avisar. */
const ALERT_LINK: Record<string, string> = {
  "aulas-nao-finalizadas": "/e/$slug/agenda",
  "aulas-sem-professor": "/e/$slug/agenda",
  "aulas-sem-sala": "/e/$slug/agenda",
  "parcelas-vencidas": "/e/$slug/financeiro",
  renovacoes: "/e/$slug/acoes",
  "pacotes-zerados": "/e/$slug/alunos",
  "folha-aberta": "/e/$slug/folha",
  "empresas-vencendo": "/e/$slug/empresas",
  "empresas-licencas": "/e/$slug/empresas",
};

function Alerts({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ["alerts", slug], queryFn: () => school.alerts(slug) });
  const alerts = q.data?.alerts ?? [];
  if (q.isPending || alerts.length === 0) return null;
  return (
    <section className="panel stack">
      <div className="row">
        <h2>O que precisa de atenção</h2>
        <Link to="/e/$slug/relatorios" params={{ slug }}>
          Ver relatórios
        </Link>
      </div>
      <ul className="alert-list">
        {alerts.map((a) => (
          <li key={a.key}>
            <Link to={ALERT_LINK[a.key] ?? "/e/$slug"} params={{ slug }} className="alert-item">
              <Badge tone={a.tone}>{a.count}</Badge>
              <span>
                {a.title}
                <small className="muted">{a.detail}</small>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Dashboard() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const membership = useMembership();
  if (membership?.profileType === "aluno") return <Navigate to="/e/$slug/minha-area" params={{ slug }} replace />;
  if (membership && membership.profileType !== "admin" && !(membership.permissions.financeiro ?? []).includes("ver")) {
    return <Navigate to="/e/$slug/agenda" params={{ slug }} replace />;
  }
  return <DashboardContent slug={slug} />;
}

function DashboardContent({ slug }: { slug: string }) {
  const today = todayIso();
  const month = today.slice(0, 7);

  const todayLessons = useQuery({ queryKey: ["lessons", slug, today, "hoje"], queryFn: () => school.lessons(slug, { from: `${today}T03:00:00Z`, to: `${addDaysIso(today, 1)}T03:00:00Z` }) });
  const recent = useQuery({ queryKey: ["lessons", slug, "pendencias"], queryFn: () => school.lessons(slug, { from: `${addDaysIso(today, -14)}T03:00:00Z`, to: `${addDaysIso(today, 7)}T03:00:00Z` }) });
  const summary = useQuery({ queryKey: ["finance", slug, month], queryFn: () => school.financeSummary(slug, month) });
  const enrollments = useQuery({ queryKey: ["enrollments", slug, "ativas"], queryFn: () => school.enrollments(slug, { active: "1" }) });
  const overdue = useQuery({ queryKey: ["installments", slug, "vencida"], queryFn: () => school.installments(slug, { status: "vencida" }) });

  const now = Date.now();
  const naoFinalizadas = recent.data?.lessons.filter((l) => l.state === "nao_finalizada") ?? [];
  const semProfessor = recent.data?.lessons.filter((l) => l.flags.semProfessor && new Date(l.startsAt).getTime() > now) ?? [];
  const pacotes = (enrollments.data?.enrollments ?? []).filter((e) => e.usage >= 0.8).sort((a, b) => b.usage - a.usage);
  const devedores = Object.values(
    (overdue.data?.installments ?? []).reduce<Record<string, { studentId: string; name: string; cents: number; count: number; days: number }>>((acc, i) => {
      const cur = (acc[i.studentId] ??= { studentId: i.studentId, name: i.studentName, cents: 0, count: 0, days: 0 });
      cur.cents += i.amountCents - i.paidCents;
      cur.count++;
      cur.days = Math.max(cur.days, i.daysLate);
      return acc;
    }, {}),
  ).sort((a, b) => b.cents - a.cents);

  const s = summary.data?.summary;
  const lessonsToday = todayLessons.data?.lessons.filter((l) => l.state !== "cancelada") ?? [];

  return (
    <div className="stack-lg">
      <PageHead title="Início" subtitle={`Hoje, ${fmtWeekday(new Date())} ${fmtShortDate(new Date())}`} />

      <div className="stats">
        <Stat label="Aulas hoje" value={todayLessons.isPending ? "…" : lessonsToday.length} hint={`${lessonsToday.reduce((n, l) => n + l.enrolled, 0)} alunos inscritos`} />
        <Stat label="Não finalizadas" value={recent.isPending ? "…" : naoFinalizadas.length} tone={naoFinalizadas.length ? "warn" : undefined} hint="últimos 14 dias" />
        <Stat label="Recebido no mês" value={s ? money(s.receivedCents) : "…"} tone="ok" />
        <Stat label="Vencido em aberto" value={s ? money(s.overdueCents) : "…"} tone={s?.overdueCents ? "danger" : undefined} hint={s ? `${s.overdueCount} parcelas · ${s.overdueStudents} alunos` : undefined} />
      </div>

      <Alerts slug={slug} />

      <div className="grid-2">
        <section className="panel stack">
          <div className="row">
            <h2>Aulas de hoje</h2>
            <Link to="/e/$slug/agenda" params={{ slug }}>
              Abrir agenda
            </Link>
          </div>
          {todayLessons.isPending ? (
            <Loading />
          ) : lessonsToday.length === 0 ? (
            <p className="muted">Nenhuma aula hoje.</p>
          ) : (
            <ul className="lesson-list">
              {lessonsToday.map((l) => (
                <li key={l.id}>
                  <Link to="/e/$slug/aulas/$lessonId" params={{ slug, lessonId: l.id }} className="lesson-link">
                    <span className="lesson-time">{fmtTime(l.startsAt)}</span>
                    <span className="lesson-main">
                      <span className="title-with-dot">
                        <ColorDot color={l.courseColor} />
                        {l.className}
                      </span>
                      <small className="muted">
                        {l.teacherName ?? "sem professor"} · {l.roomName ?? "sem sala"} · {l.enrolled}/{l.capacity}
                      </small>
                    </span>
                    <LessonStateBadge lesson={l} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel stack">
          <h2>Pendências</h2>
          {naoFinalizadas.length === 0 && semProfessor.length === 0 ? (
            <p className="muted">Nada pendente na agenda.</p>
          ) : (
            <ul className="lesson-list">
              {[...semProfessor, ...naoFinalizadas].slice(0, 8).map((l) => (
                <li key={l.id}>
                  <Link to="/e/$slug/aulas/$lessonId" params={{ slug, lessonId: l.id }} className="lesson-link">
                    <span className="lesson-time">
                      {fmtShortDate(l.startsAt)} {fmtTime(l.startsAt)}
                    </span>
                    <span className="lesson-main">
                      {l.className}
                      <small className="muted">{l.teacherName ?? "sem professor"}</small>
                    </span>
                    <LessonStateBadge lesson={l} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Aula não finalizada trava o fechamento da folha do mês.</p>
        </section>

        <section className="panel stack">
          <div className="row">
            <h2>Pacotes quase no fim</h2>
            <span className="muted small">80% ou mais usado</span>
          </div>
          {enrollments.isPending ? (
            <Loading />
          ) : pacotes.length === 0 ? (
            <p className="muted">Nenhuma matrícula perto do fim do pacote.</p>
          ) : (
            <table className="compact">
              <tbody>
                {pacotes.slice(0, 8).map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: e.studentId }}>
                        {e.studentName}
                      </Link>
                      <div className="muted small">{e.className}</div>
                    </td>
                    <td className="num">restam {e.balance}</td>
                    <td>
                      <UsageBar used={e.used} granted={e.granted} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel stack">
          <div className="row">
            <h2>Inadimplência</h2>
            <Link to="/e/$slug/financeiro" params={{ slug }}>
              Abrir financeiro
            </Link>
          </div>
          {overdue.isPending ? (
            <Loading />
          ) : devedores.length === 0 ? (
            <Empty>Nenhuma parcela vencida.</Empty>
          ) : (
            <table className="compact">
              <tbody>
                {devedores.slice(0, 8).map((d) => (
                  <tr key={d.studentId}>
                    <td>
                      <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: d.studentId }}>
                        {d.name}
                      </Link>
                    </td>
                    <td className="muted small">
                      {d.count} parcela{d.count > 1 ? "s" : ""} · {d.days} dias
                    </td>
                    <td className="num">{money(d.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s && (
            <p className="muted small">
              Receita reconhecida no mês {money(s.recognizedCents)} ({s.concludedLessons} aulas concluídas) · carteira a reconhecer {money(s.portfolioCents)}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

