import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { school } from "../api-school.ts";
import { fmtIsoDate, fmtLongDay, fmtShortDate, fmtTime, fmtWeekday, money } from "../lib/format.ts";
import { InstallmentBadge, UsageBar } from "../status.tsx";
import { ActionError, Badge, ColorDot, LoadError, Loading, PageHead, Stat } from "../ui.tsx";

/** Área do aluno: matrículas, próximas aulas (com cancelamento), histórico e parcelas. */
export function MyArea() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-area", slug], queryFn: () => school.myArea(slug) });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "cancelar" | "reagendar" }) => school.myLesson(slug, id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-area", slug] }),
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;
  const { student, enrollments, installments, lessons } = q.data;
  const now = Date.now();
  const upcoming = lessons.filter((l) => new Date(l.startsAt).getTime() > now && l.state !== "cancelada").slice(0, 10);
  const history = lessons.filter((l) => new Date(l.startsAt).getTime() <= now).reverse().slice(0, 20);
  const active = enrollments.filter((e) => !e.endedAt);
  const open = installments.filter((i) => i.status === "vencida" || i.status === "a_vencer");

  return (
    <div className="stack-lg">
      <PageHead title={`Olá, ${student.name.split(" ")[0]}`} subtitle="Suas aulas, seus pacotes e seu financeiro." />
      <div className="stats">
        <Stat label="Aulas restantes" value={active.reduce((s, e) => s + e.balance, 0)} />
        <Stat label="Próxima aula" value={upcoming[0] ? `${fmtWeekday(upcoming[0].startsAt)} ${fmtTime(upcoming[0].startsAt)}` : "—"} hint={upcoming[0] ? fmtShortDate(upcoming[0].startsAt) : undefined} />
        <Stat label="Em aberto" value={money(open.reduce((s, i) => s + i.amountCents - i.paidCents, 0))} tone={installments.some((i) => i.status === "vencida") ? "danger" : undefined} />
      </div>

      <div className="grid-2">
        <section className="panel stack">
          <h2>Próximas aulas</h2>
          {upcoming.length === 0 ? (
            <p className="muted">Nenhuma aula agendada.</p>
          ) : (
            <ul className="lesson-list">
              {upcoming.map((l) => (
                <li key={l.id} className="lesson-link">
                  <span className="lesson-time">
                    {fmtWeekday(l.startsAt)} {fmtShortDate(l.startsAt)} {fmtTime(l.startsAt)}
                  </span>
                  <span className="lesson-main">
                    <span className="title-with-dot">
                      <ColorDot color={l.courseColor} />
                      {l.className}
                    </span>
                    <small className="muted">
                      {l.teacherName ?? "professor a definir"} · {l.roomLink ? <a href={l.roomLink} target="_blank" rel="noreferrer">entrar na sala</a> : (l.roomName ?? "sala a definir")}
                    </small>
                  </span>
                  {l.myStatus === "cancelou" ? (
                    <span className="badges">
                      <Badge tone={l.cancelledInTime ? "muted" : "warn"}>{l.cancelledInTime ? "Cancelada no prazo" : "Cancelada fora do prazo"}</Badge>
                      <button type="button" className="btn-link" onClick={() => act.mutate({ id: l.id, action: "reagendar" })}>
                        Desfazer
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn-link danger"
                      onClick={() => confirm(`Cancelar sua aula de ${fmtLongDay(l.startsAt)} às ${fmtTime(l.startsAt)}? Fora do prazo do curso, a aula conta como usada.`) && act.mutate({ id: l.id, action: "cancelar" })}
                    >
                      Não vou
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ActionError error={act.error} />
        </section>

        <section className="panel stack">
          <h2>Meus cursos</h2>
          {enrollments.map((e) => (
            <div key={e.id} className="stack-sm">
              <strong className="title-with-dot">
                <ColorDot color={e.courseColor} />
                {e.courseName}
              </strong>
              <span className="small muted">
                {e.className} · contrato até {fmtIsoDate(e.endsOn)} {e.endedAt && <Badge tone="muted">Encerrada</Badge>}
              </span>
              <span className="small">
                {e.balance} aulas restantes <UsageBar used={e.used} granted={e.granted} />
              </span>
            </div>
          ))}
        </section>

        <section className="panel stack">
          <h2>Histórico</h2>
          <ul className="lesson-list">
            {history.map((l) => (
              <li key={l.id} className="lesson-link">
                <span className="lesson-time">
                  {fmtShortDate(l.startsAt)} {fmtTime(l.startsAt)}
                </span>
                <span className="lesson-main small">{l.className}</span>
                {l.myStatus === "presente" ? (
                  <Badge tone="ok">Presente</Badge>
                ) : l.myStatus === "falta" ? (
                  <Badge tone="danger">Falta</Badge>
                ) : l.myStatus === "cancelou" ? (
                  <Badge tone="muted">Cancelou</Badge>
                ) : l.state === "cancelada" ? (
                  <Badge tone="muted">Aula cancelada</Badge>
                ) : (
                  <Badge tone="warn">Sem registro</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel stack">
          <h2>Parcelas</h2>
          <table className="compact">
            <tbody>
              {installments.map((i) => (
                <tr key={i.id}>
                  <td className="small">
                    {i.courseName} · {i.number}/{i.installmentsCount}
                  </td>
                  <td className="small">{fmtIsoDate(i.dueDate)}</td>
                  <td className="num">{money(i.amountCents)}</td>
                  <td>
                    <InstallmentBadge status={i.status} daysLate={i.daysLate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
