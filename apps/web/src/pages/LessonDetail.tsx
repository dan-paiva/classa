import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { school, SUPPORT_REASON_LABELS, type RosterEntry, type SupportReason } from "../api-school.ts";
import { fmtLongDay, fmtTime, isoDay, money, parseReais, todayIso } from "../lib/format.ts";
import { LessonStateBadge } from "../status.tsx";
import { ActionError, Badge, ColorDot, LoadError, Loading, PageHead } from "../ui.tsx";
import { useCan } from "../lib/permissions.ts";

export function LessonDetail() {
  const { slug, lessonId } = useParams({ strict: false }) as { slug: string; lessonId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["lesson", slug, lessonId], queryFn: () => school.lesson(slug, lessonId) });
  const canEditAgenda = useCan("agenda", "editar");
  const canCancel = useCan("agenda", "inativar");
  const canSeeClasses = useCan("turmas");
  const canSeeStudents = useCan("alunos");
  const canEditPayroll = useCan("folha", "editar");
  const teachers = useQuery({ queryKey: ["teachers", slug], queryFn: () => school.teachers(slug), enabled: canEditAgenda });
  const [draft, setDraft] = useState<Record<string, "presente" | "falta">>({});
  const [reason, setReason] = useState("");
  const [newTeacher, setNewTeacher] = useState("");
  const [supportReason, setSupportReason] = useState<SupportReason | "">("");
  const [supportDetail, setSupportDetail] = useState("");
  const [rate, setRate] = useState("");
  const [rateReason, setRateReason] = useState("");

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["lesson", slug, lessonId] }), qc.invalidateQueries({ queryKey: ["lessons", slug] })]);
  const action = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      setDraft({});
      await refresh();
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;
  const { lesson: l, roster } = q.data;

  const started = new Date(l.startsAt).getTime() <= Date.now();
  const isDayOrPast = isoDay(l.startsAt) <= todayIso();
  const canMark = isDayOrPast && l.state !== "cancelada" && l.state !== "concluida";
  const statusOf = (r: RosterEntry) => draft[r.enrollmentId] ?? r.status;
  const active = roster.filter((r) => r.status !== "cancelou");
  const pending = active.filter((r) => statusOf(r) === "inscrito").length;
  const hasDraft = Object.keys(draft).length > 0;

  const saveAttendance = () =>
    school.setAttendance(slug, l.id, Object.entries(draft).map(([enrollmentId, status]) => ({ enrollmentId, status })));

  const eligibleTeachers = (teachers.data?.teachers ?? []).filter(
    (t) => !t.deactivatedAt && t.id !== l.teacherId && t.courses.some((c) => c.courseId === l.courseId && (!c.moduleIds || !l.moduleId || c.moduleIds.includes(l.moduleId))),
  );

  return (
    <div className="stack-lg">
      <nav className="crumbs" aria-label="Trilha">
        <Link to="/e/$slug/agenda" params={{ slug }}>
          Agenda
        </Link>
        <span aria-hidden="true">/</span>
        {canSeeClasses ? (
          <Link to="/e/$slug/turmas/$classGroupId" params={{ slug, classGroupId: l.classGroupId }}>
            {l.className}
          </Link>
        ) : (
          <span>{l.className}</span>
        )}
      </nav>

      <PageHead
        title={
          <span className="title-with-dot">
            <ColorDot color={l.courseColor} />
            {l.className}
          </span>
        }
        subtitle={
          <>
            {fmtLongDay(l.startsAt)}, {fmtTime(l.startsAt)} às {fmtTime(l.endsAt)} · {l.courseName}
            {l.moduleName ? ` · ${l.moduleName}` : ""}
          </>
        }
        actions={<LessonStateBadge lesson={l} />}
      />

      <div className="grid-2">
        <section className="panel stack">
          <h2>Dados da aula</h2>
          <dl className="facts">
            <dt>Professor</dt>
            <dd>
              {l.teacherName ?? <Badge tone="danger">Sem professor</Badge>}
              {l.originalTeacherName && <span className="muted small"> · substituindo {l.originalTeacherName}</span>}
            </dd>
            <dt>Sala</dt>
            <dd>
              {l.roomName ?? "—"}
              {l.roomLink && (
                <>
                  {" · "}
                  <a href={l.roomLink} target="_blank" rel="noreferrer">
                    Abrir sala
                  </a>
                </>
              )}
            </dd>
            <dt>Modalidade</dt>
            <dd>{l.modality === "online" ? "Online" : "Presencial"}</dd>
            <dt>Inscritos</dt>
            <dd>
              {l.enrolled} de {l.capacity} vagas
            </dd>
            {l.cancelReason && (
              <>
                <dt>Motivo do cancelamento</dt>
                <dd>{l.cancelReason}</dd>
              </>
            )}
          </dl>

          {l.state === "agendada" && !started && (canEditAgenda || canCancel) && (
            <div className="stack">
              {canEditAgenda && (
              <div className="inline-form">
                <div className="field">
                  <label htmlFor="new-teacher">Trocar professor desta aula</label>
                  <select id="new-teacher" value={newTeacher} onChange={(e) => setNewTeacher(e.target.value)}>
                    <option value="">Escolha…</option>
                    {eligibleTeachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.person.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="btn" disabled={!newTeacher || action.isPending} onClick={() => action.mutate(() => school.changeLessonTeacher(slug, l.id, newTeacher))}>
                  Trocar
                </button>
              </div>
              )}
              {canCancel && (
              <div className="inline-form">
                <div className="field">
                  <label htmlFor="cancel-reason">Cancelar a aula (ninguém perde crédito)</label>
                  <input id="cancel-reason" placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={action.isPending}
                  onClick={() => confirm("Cancelar esta aula para todos os alunos?") && action.mutate(() => school.cancelLesson(slug, l.id, reason))}
                >
                  Cancelar aula
                </button>
              </div>
              )}
            </div>
          )}
          {l.state === "cancelada" && !started && canCancel && (
            <button type="button" className="btn" onClick={() => action.mutate(() => school.cancelLesson(slug, l.id, "", true))}>
              Desfazer cancelamento
            </button>
          )}
          <ActionError error={action.error} />

          {l.teacherId && l.state !== "cancelada" && isDayOrPast && (
            <div className="subpanel stack">
              <h3>Folha do professor</h3>
              {l.supportReason ? (
                <p className="small">
                  <Badge tone="danger">Descontada da folha</Badge> Suporte pedido: {SUPPORT_REASON_LABELS[l.supportReason]}
                  {l.supportDetail ? ` · ${l.supportDetail}` : ""}{" "}
                  {canEditPayroll && (
                    <button type="button" className="btn-link" onClick={() => action.mutate(() => school.requestSupport(slug, l.id, null))}>
                      Retirar pedido
                    </button>
                  )}
                </p>
              ) : (
                <div className="inline-form">
                  <div className="field">
                    <label htmlFor="support-reason">Pedido de suporte (desconta esta aula)</label>
                    <select id="support-reason" value={supportReason} onChange={(e) => setSupportReason(e.target.value as SupportReason)}>
                      <option value="">Motivo…</option>
                      {Object.entries(SUPPORT_REASON_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="support-detail">Detalhe</label>
                    <input id="support-detail" value={supportDetail} onChange={(e) => setSupportDetail(e.target.value)} />
                  </div>
                  <button type="button" className="btn" disabled={!supportReason || action.isPending} onClick={() => action.mutate(() => school.requestSupport(slug, l.id, supportReason as SupportReason, supportDetail))}>
                    Registrar
                  </button>
                </div>
              )}
              {l.individual && canEditPayroll && (
                <>
                  {l.rateOverrideCents != null ? (
                    <p className="small">
                      Valor desta aula ajustado para {money(l.rateOverrideCents)} ({l.rateOverrideReason}){" "}
                      <button type="button" className="btn-link" onClick={() => action.mutate(() => school.overrideRate(slug, l.id, null))}>
                        Voltar ao valor da turma
                      </button>
                    </p>
                  ) : (
                    <div className="inline-form">
                      <div className="field">
                        <label htmlFor="rate-value">Alterar valor só desta aula (R$)</label>
                        <input id="rate-value" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
                      </div>
                      <div className="field">
                        <label htmlFor="rate-reason">Motivo</label>
                        <input id="rate-reason" value={rateReason} onChange={(e) => setRateReason(e.target.value)} />
                      </div>
                      <button type="button" className="btn" disabled={!rate || action.isPending} onClick={() => action.mutate(() => school.overrideRate(slug, l.id, parseReais(rate), rateReason))}>
                        Alterar
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        <section className="panel stack">
          <div className="row">
            <h2>Lista de presença</h2>
            {canMark && active.length > 0 && (
              <button type="button" className="btn-link" onClick={() => setDraft(Object.fromEntries(active.map((r) => [r.enrollmentId, "presente" as const])))}>
                Marcar todos presentes
              </button>
            )}
          </div>
          {!isDayOrPast && l.state !== "cancelada" && <p className="muted small">A lista de presença abre no dia da aula.</p>}
          {roster.length === 0 ? (
            <p className="muted">Nenhum aluno inscrito.</p>
          ) : (
            <table className="compact">
              <tbody>
                {roster.map((r) => {
                  const st = statusOf(r);
                  return (
                    <tr key={r.id}>
                      <td>
                        {canSeeStudents ? (
                          <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: r.studentId }}>
                            {r.studentName}
                          </Link>
                        ) : (
                          r.studentName
                        )}
                        <div className="muted small">saldo {r.balance} aulas</div>
                      </td>
                      <td className="right">
                        {r.status === "cancelou" ? (
                          <span className="badges">
                            <Badge tone="muted">Cancelou</Badge>
                            <Badge tone={r.cancelledInTime ? "ok" : "warn"}>{r.cancelledInTime ? "no prazo" : "fora do prazo"}</Badge>
                            {!started && l.state === "agendada" && (
                              <button type="button" className="btn-link" onClick={() => action.mutate(() => school.cancelStudentLesson(slug, l.id, r.enrollmentId, true))}>
                                Desfazer
                              </button>
                            )}
                          </span>
                        ) : canMark ? (
                          <span className="segmented" role="group" aria-label={`Presença de ${r.studentName}`}>
                            <button type="button" className={st === "presente" ? "on ok" : ""} onClick={() => setDraft({ ...draft, [r.enrollmentId]: "presente" })}>
                              Presente
                            </button>
                            <button type="button" className={st === "falta" ? "on danger" : ""} onClick={() => setDraft({ ...draft, [r.enrollmentId]: "falta" })}>
                              Falta
                            </button>
                          </span>
                        ) : st === "presente" ? (
                          <Badge tone="ok">Presente</Badge>
                        ) : st === "falta" ? (
                          <Badge tone="danger">Falta</Badge>
                        ) : !started && l.state === "agendada" && canEditAgenda ? (
                          <button type="button" className="btn-link" onClick={() => confirm(`Cancelar a ida de ${r.studentName} a esta aula?`) && action.mutate(() => school.cancelStudentLesson(slug, l.id, r.enrollmentId))}>
                            Cancelar agendamento
                          </button>
                        ) : (
                          <Badge tone="info">Inscrito</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {canMark && (
            <div className="actions">
              <button type="button" className="btn" disabled={!hasDraft || action.isPending} onClick={() => action.mutate(saveAttendance)}>
                Salvar presença
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={action.isPending || pending > 0}
                title={pending > 0 ? `Faltam ${pending} alunos` : undefined}
                onClick={() =>
                  action.mutate(async () => {
                    if (hasDraft) await saveAttendance();
                    await school.concludeLesson(slug, l.id);
                  })
                }
              >
                Concluir aula
              </button>
              {pending > 0 && <span className="muted small">Faltam {pending} para concluir</span>}
            </div>
          )}
          {l.state === "concluida" && <p className="muted small">Aula concluída: presenças e faltas já foram lançadas no extrato de créditos.</p>}
        </section>
      </div>
    </div>
  );
}
