import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { school, SUPPORT_REASON_LABELS, type MonthStatus, type PayrollSituation } from "../api-school.ts";
import { fmtDate, fmtIsoDate, fmtShortDate, fmtTime, fmtWeekday, money, plural, todayIso } from "../lib/format.ts";
import { ActionError, Badge, LoadError, Loading, PageHead, Stat, type Tone } from "../ui.tsx";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const STATUS: Record<MonthStatus, [string, Tone, string]> = {
  em_andamento: ["Em andamento", "info", "O mês ainda não terminou. Os valores mudam conforme as aulas são concluídas."],
  travada: ["Travada", "warn", "Há aulas não finalizadas. Registre a presença e conclua para poder fechar."],
  pronta: ["Pronta para fechar", "ok", "Todas as aulas do mês estão resolvidas."],
  fechada: ["Fechada", "neutral", "Valores gravados no fechamento. As aulas deste mês não podem mais ser alteradas."],
};
const SITUATION: Record<PayrollSituation, [string, Tone]> = {
  paga: ["Paga", "ok"],
  descontada: ["Descontada · suporte", "danger"],
  pendente: ["Pendente · não finalizada", "warn"],
  fora: ["Não entra", "muted"],
};

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + delta, 1)).toISOString().slice(0, 7);
};

export function Payroll() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const qc = useQueryClient();
  const [month, setMonth] = useState(shiftMonth(todayIso().slice(0, 7), -1));
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["payroll", slug, month], queryFn: () => school.payroll(slug, month) });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["payroll", slug] }), qc.invalidateQueries({ queryKey: ["finance", slug] })]);
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });

  const [y, m] = month.split("-").map(Number);
  const p = q.data?.payroll;
  const [label, tone, help] = p ? STATUS[p.status] : ["…", "neutral" as Tone, ""];

  return (
    <div className="stack-lg">
      <PageHead
        title="Folha de professores"
        subtitle={`Competência de ${MONTHS[m! - 1]} de ${y}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setMonth(shiftMonth(month, -1))}>
              ← Anterior
            </button>
            <button type="button" className="btn" onClick={() => setMonth(todayIso().slice(0, 7))}>
              Mês atual
            </button>
            <button type="button" className="btn" onClick={() => setMonth(shiftMonth(month, 1))}>
              Próximo →
            </button>
          </>
        }
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} />
      ) : (
        <>
          <div className="row">
            <span className="actions">
              <Badge tone={tone}>{label}</Badge>
              <span className="muted small">{help}</span>
            </span>
            <span className="actions">
              {p!.status === "pronta" && (
                <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => confirm("Fechar a folha? As aulas do mês ficam travadas.") && act.mutate(() => school.closeMonth(slug, month))}>
                  Fechar competência
                </button>
              )}
              {p!.status === "fechada" && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const j = prompt("Justificativa para reabrir a folha");
                    if (j) act.mutate(() => school.reopenMonth(slug, month, j));
                  }}
                >
                  Reabrir
                </button>
              )}
            </span>
          </div>
          <ActionError error={act.error} />

          <div className="stats">
            <Stat label="Líquido a pagar" value={money(p!.totals.netCents)} tone="ok" />
            <Stat label="Bruto" value={money(p!.totals.grossCents)} hint={`${p!.totals.paidLessons + p!.totals.discountedLessons} aulas · ${Math.round(p!.totals.minutes / 60)} h`} />
            <Stat label="Descontos (suporte)" value={money(p!.totals.discountCents)} tone={p!.totals.discountCents ? "danger" : undefined} hint={`${p!.totals.discountedLessons} aulas`} />
            <Stat label="Aulas pendentes" value={p!.totals.pendingLessons} tone={p!.totals.pendingLessons ? "warn" : undefined} hint="não finalizadas" />
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Professor</th>
                  <th className="num">Pagas</th>
                  <th className="num">Descontadas</th>
                  <th className="num">Pendentes</th>
                  <th className="num">Horas</th>
                  <th className="num">Bruto</th>
                  <th className="num">Desconto</th>
                  <th className="num">Líquido</th>
                  <th>Pagamento</th>
                </tr>
              </thead>
              <tbody>
                {p!.lines.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">
                      Nenhuma aula dada nesta competência.
                    </td>
                  </tr>
                )}
                {p!.lines.map((l) => (
                  <Fragment key={l.teacherId}>
                    <tr>
                      <td>
                        <button type="button" className="btn-link" onClick={() => setOpen(open === l.teacherId ? null : l.teacherId)}>
                          {open === l.teacherId ? "▾" : "▸"} {l.teacherName}
                        </button>
                      </td>
                      <td className="num">{l.paidLessons}</td>
                      <td className="num">{l.discountedLessons || "—"}</td>
                      <td className="num">{l.pendingLessons ? <Badge tone="warn">{l.pendingLessons}</Badge> : "—"}</td>
                      <td className="num">{(l.minutes / 60).toFixed(1).replace(".", ",")}</td>
                      <td className="num">{money(l.grossCents)}</td>
                      <td className="num">{l.discountCents ? money(l.discountCents) : "—"}</td>
                      <td className="num">
                        <strong>{money(l.netCents)}</strong>
                      </td>
                      <td>
                        {p!.status !== "fechada" ? (
                          <span className="muted small">após o fechamento</span>
                        ) : l.paidOn ? (
                          <Badge tone="ok">Pago em {fmtIsoDate(l.paidOn)}</Badge>
                        ) : (
                          <button type="button" className="btn-link" onClick={() => act.mutate(() => school.markLinePaid(slug, l.lineId!, todayIso()))}>
                            Marcar como pago hoje
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === l.teacherId && (
                      <tr className="detail-row">
                        <td colSpan={9}>
                          <table className="compact">
                            <tbody>
                              {l.lessons.map((x) => (
                                <tr key={x.lessonId}>
                                  <td className="small">
                                    <Link to="/e/$slug/aulas/$lessonId" params={{ slug, lessonId: x.lessonId }}>
                                      {fmtWeekday(x.startsAt)} {fmtShortDate(x.startsAt)} {fmtTime(x.startsAt)}
                                    </Link>
                                  </td>
                                  <td className="small">
                                    {x.className}
                                    {x.substitute && <span className="muted"> · como substituto</span>}
                                  </td>
                                  <td className="small muted">
                                    {plural(x.present, "presente", "presentes")} · {plural(x.absent, "falta", "faltas")}
                                  </td>
                                  <td>
                                    <Badge tone={SITUATION[x.situation][1]}>{SITUATION[x.situation][0]}</Badge>
                                    {x.supportReason && <span className="muted small"> {SUPPORT_REASON_LABELS[x.supportReason]}</span>}
                                  </td>
                                  <td className="num small">
                                    {money(x.valueCents)}
                                    {x.overridden && <span className="muted"> (ajustado)</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted small">
            Aula com presença ou falta do aluno é paga. Aula com pedido de suporte é descontada. Cancelada não entra. Quem substituiu recebe a aula. Turmas pagam valor hora × duração; aula particular paga o valor fixo da turma (padrão R$ 120).
          </p>

          {q.data!.periods.length > 0 && (
            <section className="panel stack">
              <h2>Histórico de fechamentos</h2>
              <table className="compact">
                <tbody>
                  {q.data!.periods.map((per) => (
                    <tr key={per.id}>
                      <td>{per.month.split("-").reverse().join("/")}</td>
                      <td className="small">fechada em {fmtDate(per.closedAt)}</td>
                      <td className="num">{money(per.netCents)}</td>
                      <td className="small">{per.reopenedAt ? <Badge tone="warn">Reaberta: {per.reopenJustification}</Badge> : <Badge tone="neutral">Vigente</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
