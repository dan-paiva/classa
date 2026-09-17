import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { CAMPAIGN_CHANNELS, FLOWS, RETENTION_REASONS, SUBSTITUTION_REASONS, type FlowDefinition, type FlowField, type FlowKey } from "@classa/domain";
import { useState } from "react";
import { api, issuesOf } from "../api.ts";
import { PAYMENT_METHOD_LABELS, school, type FlowOptions, type WorkflowCard } from "../api-school.ts";
import { fmtDate, fmtIsoDate, fmtShortDate, fmtTime, money, parseReais } from "../lib/format.ts";
import { ActionError, Badge, Field, FormError, Loading, PageHead } from "../ui.tsx";

type Option = { value: string; label: string; disabled?: boolean };

const SP_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** O professor está livre em todas as horas da aula (dia da semana e horário no fuso da escola)? */
function freeAt(availability: number[], startsAt: string, endsAt?: string) {
  const parts = Object.fromEntries(SP_PARTS.formatToParts(new Date(startsAt)).map((p) => [p.type, p.value]));
  const weekday = WD[parts.weekday!]!;
  const start = Number(parts.hour) * 60 + Number(parts.minute);
  const minutes = endsAt ? (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000 : 60;
  for (let h = Math.floor(start / 60); h * 60 < start + minutes; h++) if (!availability.includes(weekday * 100 + h)) return false;
  return true;
}

/** Opções de cada campo, a partir das listas da API e do que já foi preenchido no cartão. */
function useFieldOptions(slug: string, flow: FlowKey) {
  const options = useQuery({ queryKey: ["flow-options", slug, flow], queryFn: () => school.flowOptions(slug, flow) });
  const teachers = useQuery({ queryKey: ["teachers", slug], queryFn: () => school.teachers(slug), enabled: flow === "substituicao" });
  const groups = useQuery({ queryKey: ["class-groups", slug], queryFn: () => school.classGroups(slug), enabled: flow === "nivel" });
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug), enabled: flow === "admissao" });
  const o: FlowOptions = options.data?.options ?? {};

  return (field: FlowField, data: Record<string, unknown>): Option[] => {
    const lessonLabel = (l: { startsAt: string; className: string }) => `${fmtShortDate(l.startsAt)} ${fmtTime(l.startsAt)} · ${l.className}`;
    switch (`${flow}.${field.key}`) {
      case "substituicao.lessonId":
        return (o.lessons ?? []).map((l) => ({ value: l.id, label: lessonLabel(l) }));
      case "substituicao.reason":
        return SUBSTITUTION_REASONS.map((r) => ({ value: r, label: r }));
      case "substituicao.substituteId": {
        const l = (o.lessons ?? []).find((x) => x.id === data.lessonId);
        return (teachers.data?.teachers ?? [])
          .filter((t) => !t.deactivatedAt && t.id !== l?.teacherId && (!l || t.courses.some((c) => c.courseId === l.courseId && (!c.moduleIds || !l.moduleId || c.moduleIds.includes(l.moduleId)))))
          .map((t) => {
            const free = !l || freeAt(t.availability, l.startsAt, l.endsAt);
            return { value: t.id, label: `${t.person.name}${free ? "" : " · indisponível no horário"}`, disabled: !free };
          });
      }
      case "nivel.enrollmentId":
      case "renovacao.enrollmentId":
        return (o.enrollments ?? []).map((e) => ({ value: e.id, label: `${e.studentName} · ${e.className}${flow === "renovacao" ? ` · até ${fmtIsoDate(e.endsOn)}` : ""}` }));
      case "nivel.targetClassGroupId": {
        const e = (o.enrollments ?? []).find((x) => x.id === data.enrollmentId);
        return (groups.data?.classGroups ?? [])
          .filter((g) => !g.deactivatedAt && (!e || g.courseId === e.courseId) && g.name !== e?.className)
          .map((g) => ({ value: g.id, label: `${g.name} (${g.enrolled}/${g.capacity})` }));
      }
      case "reposicao.missedLessonStudentId":
        return (o.absences ?? []).map((a) => ({ value: a.id, label: `${a.studentName} · ${fmtShortDate(a.startsAt)} · ${a.className}` }));
      case "reposicao.targetLessonId": {
        const a = (o.absences ?? []).find((x) => x.id === data.missedLessonStudentId);
        return (o.lessons ?? []).filter((l) => !a || l.courseId === a.courseId).map((l) => ({ value: l.id, label: lessonLabel(l) }));
      }
      case "admissao.courseIds":
        return (courses.data?.courses ?? []).filter((c) => !c.deactivatedAt).map((c) => ({ value: c.id, label: c.name }));
      case "cobranca.studentId":
        return (o.students ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${money(s.cents ?? 0)} vencidos` }));
      case "cobranca.method":
        return Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }));
      case "retencao.studentId":
        return (o.students ?? []).map((s) => ({ value: s.id, label: s.name }));
      case "retencao.reason":
        return RETENTION_REASONS.map((r) => ({ value: r, label: r }));
      case "campanha.channel":
        return CAMPAIGN_CHANNELS.map((r) => ({ value: r, label: r }));
      default:
        return [];
    }
  };
}

function FieldInput({ field, value, onChange, options, disabled }: { field: FlowField; value: unknown; onChange: (v: unknown) => void; options: Option[]; disabled?: boolean }) {
  const id = `f-${field.key}`;
  if (field.key === "courseIds") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="chips" style={{ paddingLeft: 0 }}>
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              className={`chip${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((x) => x !== o.value) : [...selected, o.value])}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  switch (field.kind) {
    case "select":
      return (
        <select id={id} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Escolha…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "textarea":
      return <textarea id={id} disabled={disabled} rows={2} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <input id={id} disabled={disabled} inputMode="numeric" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "money":
      return (
        <input
          id={id}
          disabled={disabled}
          inputMode="decimal"
          defaultValue={typeof value === "number" ? (value / 100).toFixed(2).replace(".", ",") : ""}
          onBlur={(e) => onChange(e.target.value ? parseReais(e.target.value) : null)}
        />
      );
    case "date":
      return <input id={id} type="date" disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} />;
    default:
      return <input id={id} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function Flows() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [flow, setFlow] = useState<FlowKey>("substituicao");
  const counts = useQuery({ queryKey: ["flows", slug], queryFn: () => school.flows(slug) });
  const def = FLOWS[flow];

  return (
    <div className="stack-lg">
      <PageHead title="Ações" subtitle="Fluxos da operação em kanban. Cada etapa diz o que precisa para entrar nela e o que muda no sistema." />
      <div className="tabs" role="tablist">
        {Object.values(FLOWS).map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={flow === f.key} className={flow === f.key ? "tab on" : "tab"} onClick={() => setFlow(f.key)}>
            {f.title}
            {counts.data?.openCounts[f.key] ? <span className="tab-count">{counts.data.openCounts[f.key]}</span> : null}
          </button>
        ))}
      </div>
      <FlowBoard key={flow} slug={slug} def={def} />
    </div>
  );
}

function FlowBoard({ slug, def }: { slug: string; def: FlowDefinition }) {
  const qc = useQueryClient();
  const cards = useQuery({ queryKey: ["cards", slug, def.key], queryFn: () => school.cards(slug, def.key) });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["cards", slug, def.key] }),
      qc.invalidateQueries({ queryKey: ["flows", slug] }),
      qc.invalidateQueries({ queryKey: ["card", slug] }),
      qc.invalidateQueries({ queryKey: ["renewal-queue", slug] }),
      qc.invalidateQueries({ queryKey: ["flow-options", slug, def.key] }),
    ]);

  return (
    <div className="stack">
      <div className="row">
        <p className="muted">
          {def.description} <span className="small">Área: {def.area}.</span>
        </p>
        {!creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            Novo(a) {def.singular}
          </button>
        )}
      </div>
      {creating && <CardForm slug={slug} def={def} onDone={() => setCreating(false)} onCreated={refresh} />}
      {def.key === "renovacao" && <RenewalQueue slug={slug} onCreated={refresh} />}
      {cards.isPending ? (
        <Loading />
      ) : (
        <div className="kanban" style={{ gridTemplateColumns: `repeat(${def.stages.length}, minmax(200px, 1fr))` }}>
          {def.stages.map((stage) => {
            const list = (cards.data?.cards ?? []).filter((c) => c.stage === stage.key);
            return (
              <section key={stage.key} className={`kanban-col${stage.final ? " kanban-closed" : ""}`}>
                <h3 title={stage.description}>
                  {stage.label} <span className="muted">{list.length}</span>
                </h3>
                <p className="muted small">{stage.description}</p>
                {list.map((c) => (
                  <button key={c.id} type="button" className={`kcard kcard-button${openId === c.id ? " on" : ""}`} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                    <strong>{c.title}</strong>
                    <span className="muted small">desde {fmtDate(c.stageChangedAt)}</span>
                    {typeof c.data.overdueCents === "number" && <Badge tone="danger">{money(c.data.overdueCents)}</Badge>}
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {openId && <CardPanel slug={slug} def={def} cardId={openId} onChange={refresh} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function CardForm({ slug, def, onDone, onCreated }: { slug: string; def: FlowDefinition; onDone: () => void; onCreated: () => Promise<unknown> }) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const optionsFor = useFieldOptions(slug, def.key);
  const create = useMutation({
    mutationFn: () => school.createCard(slug, def.key, data),
    onSuccess: async () => {
      await onCreated();
      onDone();
    },
  });
  const issues = issuesOf(create.error);
  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2>Novo(a) {def.singular}</h2>
      <div className="grid-fields">
        {def.fields.map((f) => (
          <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={`f-${f.key}`} errors={issues[f.key]} hint={f.hint}>
            <FieldInput field={f} value={data[f.key]} options={optionsFor(f, data)} onChange={(v) => setData({ ...data, [f.key]: v })} />
          </Field>
        ))}
      </div>
      <FormError error={create.error} />
      <ActionError error={create.error && (create.error as { status?: number }).status === 400 ? create.error : null} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          Criar
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function CardPanel({ slug, def, cardId, onChange, onClose }: { slug: string; def: FlowDefinition; cardId: string; onChange: () => Promise<unknown>; onClose: () => void }) {
  const q = useQuery({ queryKey: ["card", slug, cardId], queryFn: () => school.card(slug, cardId) });
  const optionsFor = useFieldOptions(slug, def.key);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const save = useMutation({ mutationFn: (d: Record<string, unknown>) => school.updateCard(slug, cardId, d), onSuccess: async () => { setDraft(null); await onChange(); } });
  const move = useMutation({
    mutationFn: async (to: string) => {
      if (draft) await school.updateCard(slug, cardId, draft);
      return school.moveCard(slug, cardId, to);
    },
    onSuccess: async () => {
      setDraft(null);
      await onChange();
    },
  });

  if (q.isPending) return <Loading />;
  if (!q.data) return null;
  const { card, transitions } = q.data;
  const data = { ...card.data, ...(draft ?? {}) };
  const idx = def.stages.findIndex((s) => s.key === card.stage);
  const current = def.stages[idx]!;
  const next = def.stages.slice(idx + 1).find((s) => !s.alternative);
  const alternatives = def.stages.filter((s) => s.alternative && s.key !== card.stage);
  const label = (key: string | null) => def.stages.find((s) => s.key === key)?.label ?? "—";

  return (
    <section className="panel stack card-panel">
      <div className="row">
        <h2>{card.title}</h2>
        <button type="button" className="btn-link" onClick={onClose}>
          Fechar
        </button>
      </div>
      <p>
        <Badge tone={current.final ? (current.alternative ? "muted" : "ok") : "info"}>{current.label}</Badge> <span className="muted small">{current.description}</span>
      </p>
      <div className="grid-fields">
        {def.fields.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`f-${f.key}`} hint={f.hint}>
            <FieldInput field={f} value={data[f.key]} options={optionsFor(f, data)} disabled={current.final} onChange={(v) => setDraft({ ...(draft ?? {}), [f.key]: v })} />
          </Field>
        ))}
      </div>
      {def.key === "admissao" && typeof card.data.teacherId === "string" && (
        <Link to="/e/$slug/professores/$teacherId" params={{ slug, teacherId: card.data.teacherId }}>
          Abrir ficha do professor
        </Link>
      )}
      <div className="actions">
        {draft && !current.final && (
          <button type="button" className="btn" disabled={save.isPending} onClick={() => save.mutate(draft)}>
            Salvar campos
          </button>
        )}
        {!current.final && next && (
          <button type="button" className="btn btn-primary" disabled={move.isPending} onClick={() => move.mutate(next.key)}>
            Mover para {next.label}
          </button>
        )}
        {!current.final &&
          alternatives.map((a) => (
            <button key={a.key} type="button" className="btn btn-danger" disabled={move.isPending} onClick={() => confirm(`Mover para ${a.label}?`) && move.mutate(a.key)}>
              {a.label}
            </button>
          ))}
        {!current.final && (
          <select aria-label="Mover para outra etapa" value="" onChange={(e) => e.target.value && move.mutate(e.target.value)} className="select-auto">
            <option value="">Ir para etapa…</option>
            {def.stages
              .filter((s) => s.key !== card.stage && !s.alternative)
              .map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
          </select>
        )}
        {current.final && (
          <button type="button" className="btn" disabled={move.isPending} onClick={() => move.mutate(def.stages[0]!.key)}>
            Reabrir em {def.stages[0]!.label}
          </button>
        )}
      </div>
      <ActionError error={move.error ?? save.error} />
      <p className="muted small">Pular etapas executa o que cada etapa intermediária faz, em ordem. Voltar etapa não desfaz o que já foi feito.</p>
      <div className="stack-sm">
        <h3>Histórico</h3>
        <ul className="plain small">
          {transitions.map((t) => (
            <li key={t.id}>
              {fmtDate(t.createdAt)} {fmtTime(t.createdAt)} · {t.fromStage ? `${label(t.fromStage)} → ` : ""}
              {label(t.toStage)}
              {t.note && <span className="muted"> · {t.note}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RenewalQueue({ slug, onCreated }: { slug: string; onCreated: () => Promise<unknown> }) {
  const q = useQuery({ queryKey: ["renewal-queue", slug], queryFn: () => school.renewalQueue(slug) });
  const start = useMutation({ mutationFn: (enrollmentId: string) => school.createCard(slug, "renovacao", { enrollmentId }), onSuccess: onCreated });
  if (!q.data?.queue.length) return null;
  return (
    <section className="subpanel stack">
      <h3>Contratos que vencem em até 60 dias, sem renovação iniciada</h3>
      <table className="compact">
        <tbody>
          {q.data.queue.map((r) => (
            <tr key={r.enrollmentId}>
              <td>
                <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: r.studentId }}>
                  {r.studentName}
                </Link>
                <div className="muted small">
                  {r.courseName} · {r.className}
                </div>
              </td>
              <td className="small">
                vence {fmtIsoDate(r.endsOn)} {r.urgent && <Badge tone="danger">Urgente</Badge>}
              </td>
              <td className="num small">saldo {r.balance}</td>
              <td className="right">
                <button type="button" className="btn-link" disabled={start.isPending} onClick={() => start.mutate(r.enrollmentId)}>
                  Iniciar renovação
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ActionError error={start.error} />
    </section>
  );
}
