import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { FLOWS, LEAD_LOST_REASONS, LEAD_ORIGINS, LEAD_STAGE_LABELS } from "@classa/domain";
import { useState } from "react";
import { api, issuesOf } from "../api.ts";
import { school, type Lead } from "../api-school.ts";
import { formatPhone } from "../lib/format.ts";
import { useCan } from "../lib/permissions.ts";
import { ActionError, Badge, Field, FormError, LoadError, Loading, PageHead, Stat } from "../ui.tsx";

const OPEN = ["captado", "contato", "nivelamento", "proposta"] as const;

export function Leads() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["leads", slug], queryFn: () => school.leads(slug) });
  const [creating, setCreating] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["leads", slug] }), qc.invalidateQueries({ queryKey: ["students", slug] })]);
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });

  const leads = q.data?.leads ?? [];
  const closed = leads.filter((l) => l.stage === "matriculado" || l.stage === "perdido");
  const won = leads.filter((l) => l.stage === "matriculado").length;

  return (
    <div className="stack-lg">
      <PageHead
        title="Leads"
        subtitle="Funil comercial: do primeiro contato à matrícula."
        actions={
          !creating && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Novo lead
            </button>
          )
        }
      />
      {creating && <LeadForm slug={slug} onDone={() => setCreating(false)} />}
      <div className="stats">
        <Stat label="Em aberto" value={leads.length - closed.length} />
        <Stat label="Propostas paradas" value={leads.filter((l) => l.stalled).length} tone={leads.some((l) => l.stalled) ? "warn" : undefined} hint="há 14 dias ou mais" />
        <Stat label="Matriculados" value={won} tone="ok" />
        <Stat label="Conversão" value={closed.length ? `${Math.round((won / closed.length) * 100)}%` : "—"} hint="dos leads encerrados" />
      </div>
      <ActionError error={act.error} />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} />
      ) : (
        <div className="kanban">
          {OPEN.map((stage, i) => {
            const cards = leads.filter((l) => l.stage === stage);
            return (
              <section key={stage} className="kanban-col">
                <h3>
                  {LEAD_STAGE_LABELS[stage]} <span className="muted">{cards.length}</span>
                </h3>
                {cards.map((l) => (
                  <LeadCard key={l.id} slug={slug} lead={l} canAdvance={i < 3} act={act.mutate} busy={act.isPending} />
                ))}
              </section>
            );
          })}
          <section className="kanban-col kanban-closed">
            <h3>
              Encerrados <span className="muted">{closed.length}</span>
            </h3>
            {closed.slice(0, 15).map((l) => (
              <div key={l.id} className="kcard">
                <strong>{l.name}</strong>
                {l.stage === "matriculado" ? (
                  <span className="small">
                    <Badge tone="ok">Matriculado</Badge>{" "}
                    {l.studentId && (
                      <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: l.studentId }}>
                        abrir ficha
                      </Link>
                    )}
                  </span>
                ) : (
                  <span className="small">
                    <Badge tone="muted">Perdido · {l.lostReason}</Badge>{" "}
                    <button type="button" className="btn-link" onClick={() => act.mutate(() => school.moveLead(slug, l.id, { to: "reabrir" }))}>
                      Reabrir
                    </button>
                  </span>
                )}
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

function LeadCard({ slug, lead: l, canAdvance, act, busy }: { slug: string; lead: Lead; canAdvance: boolean; act: (fn: () => Promise<unknown>) => void; busy: boolean }) {
  const [losing, setLosing] = useState(false);
  const canStartEntry = useCan("fluxo:com", "operar");
  return (
    <div className={`kcard${l.stalled ? " kcard-warn" : ""}`}>
      <strong>{l.name}</strong>
      <span className="muted small">
        {l.courseName ?? "curso a definir"} · {l.origin}
      </span>
      <span className="muted small">{l.email ?? formatPhone(l.phone)}</span>
      <span className="small">
        {l.daysInStage === 0 ? "entrou hoje" : `${l.daysInStage} dia(s) na etapa`}
        {l.stalled && <Badge tone="warn">Parada</Badge>}
        {l.temperature && <Badge tone={l.temperature === "quente" ? "danger" : l.temperature === "morno" ? "warn" : "info"}>{l.temperature}</Badge>}
      </span>
      {/* a entrada do aluno leva o lead do nivelamento até a matrícula (DOMINIO.md §7.5.1) */}
      {l.entry ? (
        <Link to="/e/$slug/acoes" params={{ slug }} search={{ fluxo: "entrada", card: l.entry.cardId }} className="small">
          Entrada: {FLOWS.entrada.stages.find((s) => s.key === l.entry!.stage)?.label ?? l.entry.stage}
        </Link>
      ) : (
        canStartEntry && (
          <Link to="/e/$slug/acoes" params={{ slug }} search={{ fluxo: "entrada", lead: l.id }} className="small">
            Iniciar entrada (nivelamento e matrícula)
          </Link>
        )
      )}
      {losing ? (
        <select aria-label="Motivo da perda" defaultValue="" onChange={(e) => e.target.value && act(() => school.moveLead(slug, l.id, { to: "perdido", reason: e.target.value }))}>
          <option value="">Motivo da perda…</option>
          {LEAD_LOST_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : (
        <span className="kcard-actions">
          {canAdvance ? (
            <button type="button" className="btn-link" disabled={busy} onClick={() => act(() => school.moveLead(slug, l.id, { to: "avancar" }))}>
              Avançar
            </button>
          ) : (
            <button type="button" className="btn-link" disabled={busy} onClick={() => act(() => school.convertLead(slug, l.id))}>
              Matricular
            </button>
          )}
          <button type="button" className="btn-link danger" onClick={() => setLosing(true)}>
            Perder
          </button>
        </span>
      )}
    </div>
  );
}

function LeadForm({ slug, onDone }: { slug: string; onDone: () => void }) {
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const [v, setV] = useState({ name: "", email: "", phone: "", cpf: "", origin: "Site", courseId: "", temperature: "", consent: true });
  const create = useMutation({
    mutationFn: () =>
      school.createLead(slug, {
        name: v.name,
        email: v.email || null,
        phone: v.phone || null,
        cpf: v.cpf || null,
        origin: v.origin,
        courseId: v.courseId || null,
        temperature: (v.temperature || null) as Lead["temperature"],
        consent: v.consent,
      } as Parameters<typeof school.createLead>[1]),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["leads", slug] });
      onDone();
    },
  });
  const issues = issuesOf(create.error);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2>Novo lead</h2>
      <div className="grid-fields">
        <Field label="Nome" htmlFor="lead-name" errors={issues.name}>
          <input id="lead-name" required value={v.name} onChange={set("name")} />
        </Field>
        <Field label="E-mail" htmlFor="lead-email" errors={issues.email}>
          <input id="lead-email" type="email" value={v.email} onChange={set("email")} />
        </Field>
        <Field label="Telefone ou WhatsApp" htmlFor="lead-phone">
          <input id="lead-phone" inputMode="tel" value={v.phone} onChange={set("phone")} />
        </Field>
        <Field label="CPF" htmlFor="lead-cpf" errors={issues.cpf} hint="Opcional agora. É ele que reconhece quem já é aluno ou já foi.">
          <input id="lead-cpf" inputMode="numeric" value={v.cpf} onChange={set("cpf")} />
        </Field>
        <Field label="Origem" htmlFor="lead-origin">
          <select id="lead-origin" value={v.origin} onChange={set("origin")}>
            {LEAD_ORIGINS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Curso de interesse" htmlFor="lead-course">
          <select id="lead-course" value={v.courseId} onChange={set("courseId")}>
            <option value="">A definir</option>
            {courses.data?.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Temperatura" htmlFor="lead-temp">
          <select id="lead-temp" value={v.temperature} onChange={set("temperature")}>
            <option value="">—</option>
            <option value="frio">Frio</option>
            <option value="morno">Morno</option>
            <option value="quente">Quente</option>
          </select>
        </Field>
      </div>
      <label className="check" htmlFor="lead-consent">
        <input id="lead-consent" type="checkbox" checked={v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} />
        Aceita receber comunicação por e-mail e WhatsApp (LGPD)
      </label>
      <FormError error={create.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          Criar lead
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
