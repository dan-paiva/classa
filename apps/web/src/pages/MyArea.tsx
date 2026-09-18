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

      <OpenSlotsPanel slug={slug} />

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
                {e.className ?? (
                  <>
                    <Badge tone="info">Open-entry</Badge> {e.moduleName ?? "sem nível"}
                  </>
                )}{" "}
                · contrato até {fmtIsoDate(e.endsOn)} {e.endedAt && <Badge tone="muted">Encerrada</Badge>}
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

/**
 * Vagas abertas do aluno. Só aparece para quem tem matrícula open-entry; se o
 * curso não deixa o aluno agendar sozinho, a API responde 403 e a mensagem
 * dela é o que o aluno lê.
 */
function OpenSlotsPanel({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-open-slots", slug], queryFn: () => school.myOpenSlots(slug) });
  const reserve = useMutation({
    mutationFn: ({ enrollmentId, lessonId }: { enrollmentId: string; lessonId: string }) => school.reserveMySlot(slug, enrollmentId, lessonId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["my-open-slots", slug] });
      await qc.invalidateQueries({ queryKey: ["my-area", slug] });
    },
  });

  if (q.isPending || q.isError) return null; // o painel é opcional: não atrapalha o resto da área
  const comVagas = q.data.matriculas.filter((m) => m.slots.length > 0);
  if (comVagas.length === 0) return null;

  return (
    <section className="panel stack">
      <h2>Marcar aula</h2>
      <p className="muted small">Você escolhe o horário que der, dentro do seu nível. Cancelar no prazo devolve a aula.</p>
      <ActionError error={reserve.error} />
      {comVagas.map((m) => {
        const livres = m.slots.filter((s) => !s.mine && !s.full);
        return (
          <div key={m.enrollmentId} className="stack-sm">
            <strong className="small">
              {m.courseName} · {m.moduleName ?? "sem nível"}
            </strong>
            <span className="small muted">
              {m.available > 0
                ? `${m.available} aula${m.available > 1 ? "s" : ""} para marcar${livres.length > 8 ? ` · mostrando os 8 horários mais próximos de ${livres.length}` : ""}`
                : "Sem saldo para marcar: cancele outra ou renove o pacote"}
            </span>
            {livres.length === 0 ? (
              <p className="muted small">Nenhum horário livre no seu nível por enquanto.</p>
            ) : (
              <ul className="lesson-list slot-list">
                {livres.slice(0, 8).map((s) => (
                  <li key={s.id} className="lesson-link">
                    <span className="lesson-time">
                      {fmtWeekday(s.startsAt)} {fmtShortDate(s.startsAt)} {fmtTime(s.startsAt)}
                    </span>
                    <span className="lesson-main">
                      {s.className}
                      <small className="muted">
                        {s.teacherName ?? "professor a definir"} · {s.roomName ?? "sala a definir"} · {s.seatsLeft} vaga
                        {s.seatsLeft > 1 ? "s" : ""}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="btn"
                      disabled={reserve.isPending || m.available <= 0}
                      onClick={() => reserve.mutate({ enrollmentId: m.enrollmentId, lessonId: s.id })}
                    >
                      Marcar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
