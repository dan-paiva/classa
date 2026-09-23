import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import {
  AREA_LABELS,
  CAMPAIGN_CHANNELS,
  ENTRY_MAX_NO_SHOWS,
  FLOWS,
  RETENTION_REASONS,
  stageArea,
  SUBSTITUTION_REASONS,
  type Area,
  type FlowDefinition,
  type FlowField,
  type FlowKey,
} from "@classa/domain";
import { useEffect, useState } from "react";
import { api, issuesOf } from "../api.ts";
import { PAYMENT_METHOD_LABELS, school, type FlowOptions, type WorkflowCard } from "../api-school.ts";
import { fmtDate, fmtIsoDate, fmtShortDate, fmtTime, money, parseReais } from "../lib/format.ts";
import { useCan } from "../lib/permissions.ts";
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
      case "entrada.leadId":
        return (o.leads ?? []).map((l) => ({ value: l.id, label: `${l.name}${l.busy && l.id !== data.leadId ? " · já tem entrada em andamento" : ""}`, disabled: l.busy && l.id !== data.leadId }));
      case "entrada.courseId":
        return (o.courses ?? []).map((c) => ({ value: c.id, label: c.name }));
      case "entrada.evaluatorPersonId":
        return (o.evaluators ?? []).map((p) => ({ value: p.id, label: p.name }));
      case "entrada.suggestedModuleId":
        return (o.modules ?? []).filter((m) => !data.courseId || m.courseId === data.courseId).map((m) => ({ value: m.id, label: m.name }));
      case "entrada.regime":
        return [
          { value: "regular", label: "Regular (turma fixa)" },
          { value: "open_entry", label: "Open-entry (reserva aula a aula)" },
        ];
      case "entrada.classGroupId":
        return (o.classGroups ?? [])
          .filter((g) => (!data.courseId || g.courseId === data.courseId) && (!data.suggestedModuleId || g.moduleId === data.suggestedModuleId))
          .map((g) => ({ value: g.id, label: g.name }));
      case "entrada.lostReason":
        return (o.lostReasons ?? []).map((r) => ({ value: r, label: r }));
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
    case "datetime":
      // "AAAA-MM-DDTHH:MM" sem fuso: a API lê na hora da escola
      return <input id={id} type="datetime-local" disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} />;
    default:
      return <input id={id} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

/**
 * Área de cada etapa nesta escola. Vem da API porque a escola pode mudar
 * algumas (D16: quem matricula na entrada); sem resposta ainda, vale a definição.
 */
function useAreaOf(slug: string, def: FlowDefinition) {
  const flows = useQuery({ queryKey: ["flows", slug], queryFn: () => school.flows(slug) });
  return (stage: string) => (flows.data?.stageAreas[def.key]?.[stage] as Area | undefined) ?? stageArea(def, stage);
}

/** Na criação da entrada, só os campos da primeira etapa; o resto se preenche no caminho. */
function createFields(def: FlowDefinition) {
  if (def.key !== "entrada") return def.fields;
  const first = new Set(["leadId", ...(def.stages[0]!.requires ?? [])]);
  return def.fields.filter((f) => first.has(f.key));
}

/** Escolher o lead traz CPF, e-mail e curso que a pessoa já tem. */
function prefill(def: FlowDefinition, key: string, value: unknown, data: Record<string, unknown>, leads?: { id: string; cpf: string | null; email: string | null; courseId: string | null }[]) {
  const next = { ...data, [key]: value };
  if (def.key !== "entrada" || key !== "leadId") return next;
  const l = leads?.find((x) => x.id === value);
  if (!l) return next;
  return { ...next, cpf: data.cpf || l.cpf || "", email: data.email || l.email || "", courseId: data.courseId || l.courseId || null };
}

/** Em que áreas de fluxo o perfil pode operar: decide quais botões aparecem. */
function useAreaOperate(): Record<string, boolean> {
  return {
    adm: useCan("fluxo:adm", "operar"),
    com: useCan("fluxo:com", "operar"),
    ped: useCan("fluxo:ped", "operar"),
    aca: useCan("fluxo:aca", "operar"),
    cx: useCan("fluxo:cx", "operar"),
    fin: useCan("fluxo:fin", "operar"),
    mkt: useCan("fluxo:mkt", "operar"),
  };
}

export function Flows() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  // links de outras telas: ?fluxo=entrada&lead=… abre o formulário; &card=… abre o card
  const search = useSearch({ strict: false }) as { fluxo?: string; lead?: string; card?: string };
  const counts = useQuery({ queryKey: ["flows", slug], queryFn: () => school.flows(slug) });
  // o servidor devolve só os fluxos que o perfil vê (por alguma das áreas das etapas)
  const visible = Object.values(FLOWS).filter((f) => !counts.data || f.key in counts.data.openCounts);
  const [picked, setFlow] = useState<FlowKey | null>(search.fluxo && search.fluxo in FLOWS ? (search.fluxo as FlowKey) : null);
  const flow = picked && visible.some((f) => f.key === picked) ? picked : (visible[0]?.key ?? "entrada");
  const def = FLOWS[flow];

  return (
    <div className="stack-lg">
      <PageHead title="Ações" subtitle="Fluxos da operação em kanban. Cada etapa diz o que precisa para entrar nela e o que muda no sistema." />
      <div className="tabs" role="tablist">
        {visible.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={flow === f.key} className={flow === f.key ? "tab on" : "tab"} onClick={() => setFlow(f.key)}>
            {f.title}
            {counts.data?.openCounts[f.key] ? <span className="tab-count">{counts.data.openCounts[f.key]}</span> : null}
          </button>
        ))}
      </div>
      <FlowBoard
        key={flow}
        slug={slug}
        def={def}
        initialLeadId={flow === search.fluxo ? search.lead : undefined}
        initialCardId={flow === search.fluxo ? search.card : undefined}
      />
    </div>
  );
}

function FlowBoard({ slug, def, initialLeadId, initialCardId }: { slug: string; def: FlowDefinition; initialLeadId?: string; initialCardId?: string }) {
  const qc = useQueryClient();
  const cards = useQuery({ queryKey: ["cards", slug, def.key], queryFn: () => school.cards(slug, def.key) });
  const [creating, setCreating] = useState(!!initialLeadId);
  const [openId, setOpenId] = useState<string | null>(initialCardId ?? null);
  const multiArea = def.stages.some((s) => s.area);
  const areaOf = useAreaOf(slug, def);
  const canCreate = useCan(`fluxo:${areaOf(def.stages[0]!.key)}`, "operar");
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
        {!creating && canCreate && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            Novo(a) {def.singular}
          </button>
        )}
      </div>
      {creating && <CardForm slug={slug} def={def} initialLeadId={initialLeadId} onDone={() => setCreating(false)} onCreated={refresh} />}
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
                {multiArea && <span className="small area-tag">{AREA_LABELS[areaOf(stage.key)]}</span>}
                <p className="muted small">{stage.description}</p>
                {list.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`kcard kcard-button${openId === c.id ? " on" : ""}${c.canOperate === false ? " kcard-watching" : ""}`}
                    onClick={() => setOpenId(openId === c.id ? null : c.id)}
                  >
                    <strong>{c.title}</strong>
                    <span className="muted small">desde {fmtDate(c.stageChangedAt)}</span>
                    {c.canOperate === false && !stage.final && <span className="muted small">acompanhando · está com {AREA_LABELS[areaOf(stage.key)]}</span>}
                    {c.data.unresponsive === true ? (
                      <Badge tone="danger">Sem resposta · CX precisa procurar</Badge>
                    ) : (
                      typeof c.data.noShows === "number" && c.data.noShows > 0 && <Badge tone="warn">{`${c.data.noShows} falta(s) no nivelamento`}</Badge>
                    )}
                    {typeof c.data.nextPossibleOn === "string" && c.stage === "a_marcar" && <Badge tone="info">{`sem vaga · próxima ${fmtIsoDate(c.data.nextPossibleOn)}`}</Badge>}
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

function CardForm({
  slug,
  def,
  initialLeadId,
  onDone,
  onCreated,
}: {
  slug: string;
  def: FlowDefinition;
  initialLeadId?: string;
  onDone: () => void;
  onCreated: () => Promise<unknown>;
}) {
  const [data, setData] = useState<Record<string, unknown>>(initialLeadId ? { leadId: initialLeadId } : {});
  const optionsFor = useFieldOptions(slug, def.key);
  const leads = useQuery({ queryKey: ["flow-options", slug, def.key], queryFn: () => school.flowOptions(slug, def.key), enabled: def.key === "entrada" });
  // veio da tela de Leads: quando a lista chega, traz CPF, e-mail e curso do lead escolhido
  const leadList = leads.data?.options.leads;
  useEffect(() => {
    if (initialLeadId && leadList) setData((d) => prefill(def, "leadId", initialLeadId, d, leadList));
  }, [initialLeadId, leadList, def]);
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
        {createFields(def).map((f) => (
          <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={`f-${f.key}`} errors={issues[f.key]} hint={f.hint}>
            <FieldInput field={f} value={data[f.key]} options={optionsFor(f, data)} onChange={(v) => setData(prefill(def, f.key, v, data, leads.data?.options.leads))} />
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
  const canArea = useAreaOperate();
  const areaOf = useAreaOf(slug, def);
  const noShow = useMutation({ mutationFn: () => school.entryNoShow(slug, cardId), onSuccess: async () => { setDraft(null); await onChange(); } });
  const [slotDate, setSlotDate] = useState("");
  const noSlot = useMutation({ mutationFn: () => school.entryNoSlot(slug, cardId, slotDate), onSuccess: async () => { setSlotDate(""); await onChange(); } });
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
  const { card, transitions, canOperate } = q.data;
  const data = { ...card.data, ...(draft ?? {}) };
  const idx = def.stages.findIndex((s) => s.key === card.stage);
  const current = def.stages[idx]!;
  const next = def.stages.slice(idx + 1).find((s) => !s.alternative);
  const alternatives = def.stages.filter((s) => s.alternative && s.key !== card.stage);
  const label = (key: string | null) => def.stages.find((s) => s.key === key)?.label ?? "—";
  const locked = current.final || !canOperate;
  const altAllowed = (key: string) => canOperate || canArea[areaOf(key)];

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
      {!current.final && !canOperate && (
        <p className="muted small">Você acompanha este card, mas quem move agora é {AREA_LABELS[areaOf(card.stage)]}.</p>
      )}
      {def.key === "entrada" && typeof card.data.eventId === "string" && (
        <p className="small">
          <Link to="/e/$slug/eventos/$eventId" params={{ slug, eventId: card.data.eventId }}>
            Abrir o nivelamento na agenda
          </Link>
          {typeof card.data.noShows === "number" && card.data.noShows > 0 && <span className="muted"> · {`${card.data.noShows} de ${ENTRY_MAX_NO_SHOWS} faltas`}</span>}
        </p>
      )}
      {def.key === "entrada" && typeof card.data.studentId === "string" && (
        <p className="small">
          <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: card.data.studentId }}>
            Abrir ficha do aluno
          </Link>
        </p>
      )}
      <div className="grid-fields">
        {/* o lead da entrada é o título do card e não muda: fora da lista de campos */}
        {def.fields.filter((f) => !(def.key === "entrada" && f.key === "leadId")).map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`f-${f.key}`} hint={f.hint}>
            <FieldInput field={f} value={data[f.key]} options={optionsFor(f, data)} disabled={locked} onChange={(v) => setDraft({ ...(draft ?? {}), [f.key]: v })} />
          </Field>
        ))}
      </div>
      {def.key === "admissao" && typeof card.data.teacherId === "string" && (
        <Link to="/e/$slug/professores/$teacherId" params={{ slug, teacherId: card.data.teacherId }}>
          Abrir ficha do professor
        </Link>
      )}
      <div className="actions">
        {draft && !locked && (
          <button type="button" className="btn" disabled={save.isPending} onClick={() => save.mutate(draft)}>
            Salvar campos
          </button>
        )}
        {!current.final && next && (canOperate || canArea[areaOf(next.key)]) && (
          <button type="button" className="btn btn-primary" disabled={move.isPending} onClick={() => move.mutate(next.key)}>
            Mover para {next.label}
          </button>
        )}
        {def.key === "entrada" && (card.stage === "marcado" || card.stage === "comunicada") && canArea[areaOf("marcado")] && (
          <button type="button" className="btn" disabled={noShow.isPending} onClick={() => confirm("Registrar que não compareceu ao nivelamento?") && noShow.mutate()}>
            Não compareceu
          </button>
        )}
        {!current.final &&
          alternatives.filter((a) => altAllowed(a.key)).map((a) => (
            <button key={a.key} type="button" className="btn btn-danger" disabled={move.isPending} onClick={() => confirm(`Mover para ${a.label}?`) && move.mutate(a.key)}>
              {a.label}
            </button>
          ))}
        {!current.final && canArea[areaOf(card.stage)] && (
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
        {current.final && canArea[areaOf(card.stage)] && (
          <button type="button" className="btn" disabled={move.isPending} onClick={() => move.mutate(def.stages[0]!.key)}>
            Reabrir em {def.stages[0]!.label}
          </button>
        )}
      </div>
      {def.key === "entrada" && card.stage === "a_marcar" && canArea[areaOf("a_marcar")] && (
        <div className="subpanel stack-sm">
          <strong>Sem vaga na semana pedida?</strong>
          <p className="muted small">Anote a próxima data possível. O card fica aqui e o comercial vê a data para renegociar com o lead.</p>
          <div className="toolbar">
            <label className="sr-only" htmlFor="slot-date">
              Próxima data possível
            </label>
            <input id="slot-date" type="date" value={slotDate} onChange={(e) => setSlotDate(e.target.value)} />
            <button type="button" className="btn" disabled={!slotDate || noSlot.isPending} onClick={() => noSlot.mutate()}>
              Registrar sem vaga
            </button>
          </div>
        </div>
      )}
      <ActionError error={move.error ?? save.error ?? noShow.error ?? noSlot.error} />
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
