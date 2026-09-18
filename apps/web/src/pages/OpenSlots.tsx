import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { school, type Enrollment, type OpenSlot } from "../api-school.ts";
import { fmtShortDate, fmtTime, fmtWeekday } from "../lib/format.ts";
import { ActionError, Badge, Empty, Field, LoadError, Loading, PageHead, Stat } from "../ui.tsx";

/**
 * Vagas open-entry (DOMINIO.md §5.9): a escola publica os horários e o aluno
 * ocupa. Aqui a secretaria escolhe a matrícula e reserva por ele; o aluno faz
 * o mesmo pela área dele quando o curso permite.
 */
export function OpenSlots() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [enrollmentId, setEnrollmentId] = useState("");
  const enrollments = useQuery({ queryKey: ["enrollments", slug, "open"], queryFn: () => school.enrollments(slug, { active: "1" }) });

  const open = (enrollments.data?.enrollments ?? []).filter((e) => e.regime === "open_entry");
  const chosen = open.find((e) => e.id === enrollmentId);

  return (
    <div className="stack-lg">
      <PageHead
        title="Vagas open-entry"
        subtitle="No open-entry o aluno não tem turma fixa: ele pega as vagas do nível dele, aula a aula."
      />

      {enrollments.isPending ? (
        <Loading />
      ) : enrollments.isError ? (
        <LoadError error={enrollments.error} />
      ) : open.length === 0 ? (
        <Empty>
          Nenhuma matrícula open-entry ativa. Crie uma na ficha do aluno, escolhendo o regime open-entry, e publique ofertas em{" "}
          <Link to="/e/$slug/turmas" params={{ slug }}>
            Turmas
          </Link>
          .
        </Empty>
      ) : (
        <>
          <div className="panel stack">
            <Field label="Aluno" htmlFor="oe-enrollment" hint="Só matrículas open-entry ativas.">
              <select id="oe-enrollment" value={enrollmentId} onChange={(e) => setEnrollmentId(e.target.value)}>
                <option value="">Escolha…</option>
                {open.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.studentName} · {e.courseName} · {e.moduleName ?? "sem nível"}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {chosen && <SlotsFor slug={slug} enrollment={chosen} />}
        </>
      )}
    </div>
  );
}

function SlotsFor({ slug, enrollment }: { slug: string; enrollment: Enrollment }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["open-slots", slug, enrollment.id], queryFn: () => school.openSlots(slug, enrollment.id) });
  const reserve = useMutation({
    mutationFn: (lessonId: string) => school.reserveSlot(slug, enrollment.id, lessonId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["open-slots", slug, enrollment.id] });
      await qc.invalidateQueries({ queryKey: ["enrollments", slug, "open"] });
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;
  const slots = q.data.slots;
  const minhas = slots.filter((s) => s.mine).length;

  return (
    <section className="stack-lg">
      <div className="stats">
        <Stat label="Nível" value={enrollment.moduleName ?? "—"} hint={enrollment.courseName} />
        <Stat label="Saldo de aulas" value={enrollment.balance} tone={enrollment.balance <= 0 ? "danger" : undefined} />
        <Stat label="Já reservadas" value={minhas} hint="contam no saldo" />
        <Stat label="Vagas abertas" value={slots.filter((s) => !s.full && !s.mine).length} />
      </div>

      <ActionError error={reserve.error} />

      {slots.length === 0 ? (
        <Empty>
          Nenhuma aula publicada no nível {enrollment.moduleName ?? "desta matrícula"}. Crie uma oferta open-entry desse módulo em{" "}
          <Link to="/e/$slug/turmas" params={{ slug }}>
            Turmas
          </Link>
          .
        </Empty>
      ) : (
        <SlotTable slug={slug} slots={slots} onReserve={(id) => reserve.mutate(id)} pending={reserve.isPending} />
      )}
    </section>
  );
}

/** A tabela é a mesma na secretaria e na área do aluno. Uma linha por vaga, com o dia junto: são dezenas de horários, e repetir cabeçalho por dia tornava a página ilegível. */
export function SlotTable({
  slug,
  slots,
  onReserve,
  pending,
}: {
  slug: string;
  slots: OpenSlot[];
  onReserve: (lessonId: string) => void;
  pending: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Hora</th>
            <th>Oferta</th>
            <th>Professor</th>
            <th>Sala</th>
            <th className="num">Vagas</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {slots.map((s, i) => {
            const dia = s.startsAt.slice(0, 10);
            const primeiroDoDia = i === 0 || slots[i - 1]!.startsAt.slice(0, 10) !== dia;
            return (
              <tr key={s.id} className={primeiroDoDia && i > 0 ? "row-group" : undefined}>
                <td className="small">
                  {primeiroDoDia ? (
                    <>
                      {fmtWeekday(s.startsAt)} {fmtShortDate(s.startsAt)}
                    </>
                  ) : (
                    <span className="muted">·</span>
                  )}
                </td>
                <td>{fmtTime(s.startsAt)}</td>
                <td>
                  <Link to="/e/$slug/aulas/$lessonId" params={{ slug, lessonId: s.id }} className="row-link">
                    {s.className}
                  </Link>
                </td>
                <td className="small">{s.teacherName ?? <Badge tone="danger">Sem professor</Badge>}</td>
                <td className="small">{s.roomName ?? "—"}</td>
                <td className="num small">
                  {s.seatsLeft} de {s.capacity}
                </td>
                <td className="num">
                  {s.mine ? (
                    <Badge tone="ok">Reservada</Badge>
                  ) : s.full ? (
                    <Badge tone="warn">Cheia</Badge>
                  ) : (
                    <button type="button" className="btn" disabled={pending} onClick={() => onReserve(s.id)}>
                      Reservar
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
