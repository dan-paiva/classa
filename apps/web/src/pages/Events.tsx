import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api, ApiError, issuesOf } from "../api.ts";
import { AGENDA_TYPE_LABELS, EVENT_STATE_LABELS, school, type AgendaEvent, type EventInput, type EventKind } from "../api-school.ts";
import { fmtLongDay, fmtTime, isoDay, todayIso } from "../lib/format.ts";
import { ActionError, Badge, Field, FormError, LoadError, Loading, PageHead } from "../ui.tsx";

const KINDS: EventKind[] = ["reuniao", "evento", "nivelamento"];
const ROLE_LABELS: Record<string, string> = { equipe: "equipe", professor: "professor", aluno: "aluno", lead: "lead" };

/** "13:05" no fuso da escola, para preencher o formulário. */
const hhmm = (iso: string) => fmtTime(iso).slice(0, 5);

type Draft = {
  kind: EventKind;
  title: string;
  day: string;
  start: string;
  end: string;
  location: string;
  notes: string;
  participantIds: string[];
  evaluatedPersonId: string;
  evaluatorPersonId: string;
  courseId: string;
};

const fromEvent = (e: AgendaEvent, participants: { id: string }[]): Draft => ({
  kind: e.kind,
  title: e.title,
  day: isoDay(e.startsAt),
  start: hhmm(e.startsAt),
  end: hhmm(e.endsAt),
  location: e.location ?? "",
  notes: e.notes ?? "",
  // avaliado e avaliador entram sozinhos; na edição, ficam fora da lista livre
  participantIds: participants.map((p) => p.id).filter((id) => id !== e.evaluatedPersonId && id !== e.evaluatorPersonId),
  evaluatedPersonId: e.evaluatedPersonId ?? "",
  evaluatorPersonId: e.evaluatorPersonId ?? "",
  courseId: e.courseId ?? "",
});

const toInput = (d: Draft, force: boolean): EventInput => ({
  kind: d.kind,
  title: d.title,
  startsAt: `${d.day}T${d.start}`,
  endsAt: `${d.day}T${d.end}`,
  location: d.location || null,
  notes: d.notes || null,
  participantIds: d.participantIds,
  evaluatedPersonId: d.kind === "nivelamento" ? d.evaluatedPersonId || null : null,
  evaluatorPersonId: d.kind === "nivelamento" ? d.evaluatorPersonId || null : null,
  courseId: d.courseId || null,
  force,
});

/** Formulário de reunião, evento e nivelamento. Choque com aula avisa e deixa salvar mesmo assim. */
function EventForm({ slug, initial, eventId, onSaved, onCancel }: { slug: string; initial: Draft; eventId?: string; onSaved: (id: string) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [pick, setPick] = useState("");
  const people = useQuery({ queryKey: ["agenda-people", slug], queryFn: () => school.agendaPeople(slug) });
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const save = useMutation({
    mutationFn: (force: boolean) => (eventId ? school.updateEvent(slug, eventId, toInput(d, force)) : school.createEvent(slug, toInput(d, force))),
    onSuccess: (r) => onSaved(r.event.id),
  });
  const issues = issuesOf(save.error);
  const clashes = save.error instanceof ApiError && save.error.status === 409 ? (save.error.issues.clashes ?? []) : [];
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const all = people.data?.people ?? [];
  const nameOf = (id: string) => all.find((p) => p.id === id)?.name ?? "…";

  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(false);
      }}
    >
      <div className="grid-fields">
        <Field label="Tipo" htmlFor="ev-kind" errors={issues.kind}>
          <select id="ev-kind" value={d.kind} disabled={!!eventId} onChange={set("kind")}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {AGENDA_TYPE_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Título" htmlFor="ev-title" errors={issues.title}>
          <input id="ev-title" value={d.title} onChange={set("title")} placeholder={d.kind === "nivelamento" ? "Nivelamento" : ""} />
        </Field>
        <Field label="Dia" htmlFor="ev-day" errors={issues.startsAt}>
          <input id="ev-day" type="date" value={d.day} onChange={set("day")} />
        </Field>
        <Field label="Começa" htmlFor="ev-start">
          <input id="ev-start" type="time" value={d.start} onChange={set("start")} />
        </Field>
        <Field label="Termina" htmlFor="ev-end" errors={issues.endsAt}>
          <input id="ev-end" type="time" value={d.end} onChange={set("end")} />
        </Field>
        <Field label="Local ou link" htmlFor="ev-location" hint="Sala, endereço ou link da chamada">
          <input id="ev-location" value={d.location} onChange={set("location")} />
        </Field>
        {d.kind === "nivelamento" && (
          <>
            <Field label="Quem vai ser avaliado" htmlFor="ev-evaluated" errors={issues.evaluatedPersonId} hint="Lead ou aluno">
              <select id="ev-evaluated" value={d.evaluatedPersonId} onChange={set("evaluatedPersonId")}>
                <option value="">Escolha…</option>
                {all
                  .filter((p) => p.roles.includes("lead") || p.roles.includes("aluno"))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.roles.filter((r) => r === "lead" || r === "aluno").join(", ")})
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Avaliador" htmlFor="ev-evaluator" errors={issues.evaluatorPersonId} hint="Professor ou alguém do pedagógico">
              <select id="ev-evaluator" value={d.evaluatorPersonId} onChange={set("evaluatorPersonId")}>
                <option value="">Escolha…</option>
                {all
                  .filter((p) => p.canEvaluate)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Curso" htmlFor="ev-course" errors={issues.courseId}>
              <select id="ev-course" value={d.courseId} onChange={set("courseId")}>
                <option value="">Escolha…</option>
                {courses.data?.courses
                  .filter((c) => !c.deactivatedAt)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
          </>
        )}
      </div>

      <Field label={d.kind === "nivelamento" ? "Outros participantes" : "Participantes"} htmlFor="ev-pick" errors={issues.participantIds}>
        <div className="toolbar">
          <select id="ev-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Escolha uma pessoa…</option>
            {all
              .filter((p) => !d.participantIds.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")})
                </option>
              ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={!pick}
            onClick={() => {
              setD({ ...d, participantIds: [...d.participantIds, pick] });
              setPick("");
            }}
          >
            Incluir
          </button>
        </div>
      </Field>
      {d.participantIds.length > 0 && (
        <div className="chips" style={{ paddingLeft: 0 }}>
          {d.participantIds.map((id) => (
            <button key={id} type="button" className="chip on" title="Tirar da lista" onClick={() => setD({ ...d, participantIds: d.participantIds.filter((x) => x !== id) })}>
              {nameOf(id)} ×
            </button>
          ))}
        </div>
      )}
      <Field label="Observações" htmlFor="ev-notes">
        <textarea id="ev-notes" rows={2} value={d.notes} onChange={set("notes")} />
      </Field>

      {clashes.length > 0 && (
        <div className="subpanel stack-sm" role="alert">
          <strong>Há participante com aula nesse horário:</strong>
          <ul className="plain small">
            {clashes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate(true)}>
              Salvar mesmo assim
            </button>
          </div>
        </div>
      )}
      {clashes.length === 0 && <FormError error={save.error} />}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          Salvar
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function EventNew() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate();
  const initial: Draft = { kind: "reuniao", title: "", day: todayIso(), start: "09:00", end: "10:00", location: "", notes: "", participantIds: [], evaluatedPersonId: "", evaluatorPersonId: "", courseId: "" };
  return (
    <div className="stack-lg">
      <PageHead title="Nova reunião ou evento" subtitle="Nivelamento também se marca aqui, inclusive para quem ainda é lead." />
      <EventForm
        slug={slug}
        initial={initial}
        onSaved={(eventId) => navigate({ to: "/e/$slug/eventos/$eventId", params: { slug, eventId } })}
        onCancel={() => navigate({ to: "/e/$slug/agenda", params: { slug } })}
      />
    </div>
  );
}

export function EventDetail() {
  const { slug, eventId } = useParams({ strict: false }) as { slug: string; eventId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["event", slug, eventId], queryFn: () => school.event(slug, eventId) });
  const [editing, setEditing] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["event", slug, eventId] }), qc.invalidateQueries({ queryKey: ["agenda", slug] })]);
  const cancel = useMutation({ mutationFn: (reason: string) => school.cancelEvent(slug, eventId, reason), onSuccess: refresh });
  const noShow = useMutation({ mutationFn: () => school.eventNoShow(slug, eventId), onSuccess: refresh });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;
  const { event: e, participants, can } = q.data;
  const open = e.state === "agendado";

  return (
    <div className="stack-lg">
      <PageHead
        title={
          <span className={e.state === "cancelado" ? "struck" : undefined}>
            {e.title}
          </span>
        }
        subtitle={`${AGENDA_TYPE_LABELS[e.kind]} · ${fmtLongDay(e.startsAt)}, ${fmtTime(e.startsAt)}–${fmtTime(e.endsAt)}`}
        actions={
          <Link to="/e/$slug/agenda" params={{ slug }} className="btn">
            Voltar à agenda
          </Link>
        }
      />
      {editing ? (
        <EventForm
          slug={slug}
          eventId={e.id}
          initial={fromEvent(e, participants)}
          onSaved={async () => {
            setEditing(false);
            await refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <section className="panel stack">
          <p>
            <Badge tone={e.state === "agendado" ? "info" : e.state === "realizado" ? "ok" : "muted"}>{EVENT_STATE_LABELS[e.state]}</Badge>
            {e.cancelReason && <span className="muted small"> · {e.cancelReason}</span>}
          </p>
          <dl className="facts">
            {e.location && (
              <>
                <dt>Local ou link</dt>
                <dd>{/^https?:\/\//.test(e.location) ? <a href={e.location}>{e.location}</a> : e.location}</dd>
              </>
            )}
            {e.kind === "nivelamento" && (
              <>
                <dt>Avaliado</dt>
                <dd>{e.evaluatedName}</dd>
                <dt>Avaliador</dt>
                <dd>{e.evaluatorName}</dd>
                {e.courseName && (
                  <>
                    <dt>Curso</dt>
                    <dd>{e.courseName}</dd>
                  </>
                )}
                {e.suggestedModuleName && (
                  <>
                    <dt>Módulo sugerido</dt>
                    <dd>{e.suggestedModuleName}</dd>
                  </>
                )}
                {e.resultNotes && (
                  <>
                    <dt>Observação</dt>
                    <dd>{e.resultNotes}</dd>
                  </>
                )}
              </>
            )}
            <dt>Participantes</dt>
            <dd>{participants.length ? participants.map((p) => p.name).join(", ") : "—"}</dd>
            {e.notes && (
              <>
                <dt>Observações</dt>
                <dd>{e.notes}</dd>
              </>
            )}
          </dl>
          <div className="actions">
            {can.edit && open && (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Editar
              </button>
            )}
            {can.record && open && (
              <button type="button" className="btn" disabled={noShow.isPending} onClick={() => confirm("Registrar que o avaliado não compareceu?") && noShow.mutate()}>
                Não compareceu
              </button>
            )}
            {can.cancel && e.state !== "cancelado" && (
              <button
                type="button"
                className="btn btn-danger"
                disabled={cancel.isPending}
                onClick={() => {
                  const reason = prompt("Motivo do cancelamento");
                  if (reason?.trim()) cancel.mutate(reason);
                }}
              >
                Cancelar {AGENDA_TYPE_LABELS[e.kind].toLowerCase()}
              </button>
            )}
          </div>
          <ActionError error={cancel.error ?? noShow.error} />
        </section>
      )}
      {e.kind === "nivelamento" && can.record && e.state !== "cancelado" && !editing && <LevelingResult slug={slug} event={e} onSaved={refresh} />}
    </div>
  );
}

/** Resultado: alimenta a decisão administrativa, não matricula nem muda nível sozinho. */
function LevelingResult({ slug, event, onSaved }: { slug: string; event: AgendaEvent; onSaved: () => Promise<unknown> }) {
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const [moduleId, setModuleId] = useState(event.suggestedModuleId ?? "");
  const [notes, setNotes] = useState(event.resultNotes ?? "");
  const save = useMutation({ mutationFn: () => school.eventResult(slug, event.id, { suggestedModuleId: moduleId, resultNotes: notes || null }), onSuccess: onSaved });
  const options = (courses.data?.courses ?? []).filter((c) => !event.courseId || c.id === event.courseId).flatMap((c) => c.modules.filter((m) => !m.deactivatedAt).map((m) => ({ id: m.id, label: event.courseId ? m.name : `${c.name} · ${m.name}` })));
  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>Resultado do nivelamento</h2>
      <p className="muted small">O resultado orienta a matrícula. Ele não matricula ninguém e não muda o nível de quem já é aluno.</p>
      <div className="grid-fields">
        <Field label="Módulo sugerido" htmlFor="lv-module" errors={issuesOf(save.error).suggestedModuleId}>
          <select id="lv-module" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">Escolha…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Observação" htmlFor="lv-notes">
          <textarea id="lv-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <FormError error={save.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={!moduleId || save.isPending}>
          {event.state === "realizado" ? "Atualizar resultado" : "Registrar resultado"}
        </button>
      </div>
    </form>
  );
}
