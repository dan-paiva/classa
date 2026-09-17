import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api, issuesOf } from "../api.ts";
import { COMPANY_MODEL_LABELS, PAYMENT_METHOD_LABELS, school, type Company, type CompanyInput, type PaymentMethod } from "../api-school.ts";
import { addDaysIso, fmtDate, fmtIsoDate, money, parseReais, todayIso } from "../lib/format.ts";
import { StudentStatusBadge } from "../status.tsx";
import { ActionError, Badge, Empty, Field, FormError, LoadError, Loading, PageHead, Stat, type Tone } from "../ui.tsx";

const STATUS: Record<Company["status"], [string, Tone]> = { ativo: ["Ativo", "ok"], renovacao: ["Renovação", "warn"], encerrado: ["Encerrado", "muted"] };
const formatCnpj = (c: string | null) => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : (c ?? "—"));

export function Companies() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["companies", slug], queryFn: () => school.companies(slug) });
  const renewals = (q.data?.companies ?? []).filter((c) => c.status === "renovacao").length;

  return (
    <div className="stack-lg">
      <PageHead
        title="Empresas"
        subtitle="Contas B2B, em que a empresa paga as licenças, e B2B2C, em que a empresa subsidia parte e o colaborador paga o resto."
        actions={
          !creating && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Nova empresa
            </button>
          )
        }
      />
      {creating && <CompanyForm slug={slug} onDone={() => setCreating(false)} />}
      {renewals > 0 && <p className="warn-box small">{renewals} contrato(s) vencem em até 60 dias.</p>}
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} />
      ) : q.data.companies.length === 0 ? (
        <Empty>Nenhuma empresa cadastrada.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Modelo</th>
                <th>Situação</th>
                <th className="num">Licenças</th>
                <th className="num">Consumo</th>
                <th className="num">Presença</th>
                <th className="num">Por mês</th>
                <th>Alertas</th>
              </tr>
            </thead>
            <tbody>
              {q.data.companies.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to="/e/$slug/empresas/$companyId" params={{ slug, companyId: c.id }} className="row-link">
                      {c.name}
                    </Link>
                    <div className="muted small">até {fmtIsoDate(c.endsOn)}</div>
                  </td>
                  <td className="small">{c.model.toUpperCase()}</td>
                  <td>
                    <Badge tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge>
                  </td>
                  <td className="num">
                    {c.licensesInUse}/{c.licenses}
                  </td>
                  <td className="num">{c.contractedLessons ? `${c.consumed}/${c.contractedLessons}` : c.consumed}</td>
                  <td className="num">{c.attendancePercent != null ? `${c.attendancePercent}%` : "—"}</td>
                  <td className="num">{money(c.monthlyCompanyCents)}</td>
                  <td>
                    <span className="badges">
                      {c.alerts.map((a) => (
                        <Badge key={a.message} tone={a.tone}>
                          {a.message}
                        </Badge>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CompanyForm({ slug, company, onDone }: { slug: string; company?: Company; onDone: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const [v, setV] = useState({
    name: company?.name ?? "",
    cnpj: company?.cnpj ?? "",
    segment: company?.segment ?? "",
    model: company?.model ?? ("b2b" as Company["model"]),
    hrName: company?.hrName ?? "",
    hrEmail: company?.hrEmail ?? "",
    startsOn: company?.startsOn ?? todayIso(),
    endsOn: company?.endsOn ?? addDaysIso(todayIso(), 365),
    licenses: String(company?.licenses ?? 5),
    contractedLessons: String(company?.contractedLessons ?? 240),
    licensePrice: company ? (company.licensePriceCents / 100).toFixed(2).replace(".", ",") : "400,00",
    subsidyPercent: String(company?.subsidyPercent ?? 50),
    discountPercent: String(company?.discountPercent ?? 0),
    autoRenew: company?.autoRenew ?? true,
    allowAll: company ? company.allowedCourseIds === null : true,
    allowedCourseIds: company?.allowedCourseIds ?? [],
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const input = (): CompanyInput => ({
    name: v.name,
    cnpj: v.cnpj || null,
    segment: v.segment || null,
    model: v.model,
    hrName: v.hrName || null,
    hrEmail: v.hrEmail || null,
    startsOn: v.startsOn,
    endsOn: v.endsOn,
    licenses: Number(v.licenses),
    contractedLessons: Number(v.contractedLessons || 0),
    licensePriceCents: parseReais(v.licensePrice) ?? Number.NaN,
    subsidyPercent: Number(v.subsidyPercent),
    discountPercent: Number(v.discountPercent),
    autoRenew: v.autoRenew,
    allowedCourseIds: v.allowAll ? null : v.allowedCourseIds,
  });
  const save = useMutation({
    mutationFn: () => (company ? school.updateCompany(slug, company.id, input()) : school.createCompany(slug, input())),
    onSuccess: async ({ company: saved }) => {
      await qc.invalidateQueries({ queryKey: ["companies", slug] });
      await qc.invalidateQueries({ queryKey: ["company", slug, saved.id] });
      onDone();
      if (!company) navigate({ to: "/e/$slug/empresas/$companyId", params: { slug, companyId: saved.id } });
    },
  });
  const issues = issuesOf(save.error);

  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>{company ? "Editar empresa" : "Nova empresa"}</h2>
      <div className="grid-fields">
        <Field label="Nome" htmlFor="co-name" errors={issues.name}>
          <input id="co-name" required value={v.name} onChange={set("name")} />
        </Field>
        <Field label="CNPJ" htmlFor="co-cnpj" errors={issues.cnpj}>
          <input id="co-cnpj" inputMode="numeric" value={v.cnpj} onChange={set("cnpj")} />
        </Field>
        <Field label="Segmento" htmlFor="co-segment">
          <input id="co-segment" value={v.segment} onChange={set("segment")} />
        </Field>
        <Field label="Modelo" htmlFor="co-model" errors={issues.model}>
          <select id="co-model" value={v.model} onChange={set("model")}>
            {Object.entries(COMPANY_MODEL_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Início da vigência" htmlFor="co-start" errors={issues.startsOn}>
          <input id="co-start" type="date" required value={v.startsOn} onChange={set("startsOn")} />
        </Field>
        <Field label="Fim da vigência" htmlFor="co-end" errors={issues.endsOn}>
          <input id="co-end" type="date" required value={v.endsOn} onChange={set("endsOn")} />
        </Field>
        <Field label="Licenças" htmlFor="co-licenses" errors={issues.licenses} hint="Colaboradores estudando ao mesmo tempo">
          <input id="co-licenses" inputMode="numeric" value={v.licenses} onChange={set("licenses")} />
        </Field>
        <Field label="Valor por licença ao mês (R$)" htmlFor="co-price" errors={issues.licensePriceCents}>
          <input id="co-price" inputMode="decimal" value={v.licensePrice} onChange={set("licensePrice")} />
        </Field>
        <Field label="Aulas contratadas" htmlFor="co-lessons" errors={issues.contractedLessons}>
          <input id="co-lessons" inputMode="numeric" value={v.contractedLessons} onChange={set("contractedLessons")} />
        </Field>
        {v.model === "b2b2c" && (
          <>
            <Field label="Empresa paga (%)" htmlFor="co-subsidy" errors={issues.subsidyPercent}>
              <input id="co-subsidy" inputMode="numeric" value={v.subsidyPercent} onChange={set("subsidyPercent")} />
            </Field>
            <Field label="Desconto ao colaborador (%)" htmlFor="co-discount" errors={issues.discountPercent} hint="Sobre a parte que o colaborador paga">
              <input id="co-discount" inputMode="numeric" value={v.discountPercent} onChange={set("discountPercent")} />
            </Field>
          </>
        )}
        <Field label="Contato do RH" htmlFor="co-hr">
          <input id="co-hr" value={v.hrName} onChange={set("hrName")} />
        </Field>
        <Field label="E-mail do RH" htmlFor="co-hr-email" errors={issues.hrEmail} hint="Recebe o relatório mensal">
          <input id="co-hr-email" type="email" value={v.hrEmail} onChange={set("hrEmail")} />
        </Field>
      </div>
      <label className="check" htmlFor="co-auto">
        <input id="co-auto" type="checkbox" checked={v.autoRenew} onChange={(e) => setV({ ...v, autoRenew: e.target.checked })} />
        Renova sozinho por 12 meses no fim da vigência
      </label>
      <fieldset className="field">
        <legend>Cursos liberados</legend>
        <label className="check" htmlFor="co-all">
          <input id="co-all" type="checkbox" checked={v.allowAll} onChange={(e) => setV({ ...v, allowAll: e.target.checked })} />
          Todos os cursos
        </label>
        {!v.allowAll && (
          <div className="chips">
            {courses.data?.courses.map((c) => {
              const on = v.allowedCourseIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setV({ ...v, allowedCourseIds: on ? v.allowedCourseIds.filter((x) => x !== c.id) : [...v.allowedCourseIds, c.id] })}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>
      <FormError error={save.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {company ? "Salvar" : "Cadastrar empresa"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function CompanyDetail() {
  const { slug, companyId } = useParams({ strict: false }) as { slug: string; companyId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["company", slug, companyId], queryFn: () => school.company(slug, companyId) });
  const students = useQuery({ queryKey: ["students", slug], queryFn: () => school.students(slug) });
  const [editing, setEditing] = useState(false);
  const [linkId, setLinkId] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [chargeMonth, setChargeMonth] = useState(todayIso().slice(0, 7));
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["company", slug, companyId] }), qc.invalidateQueries({ queryKey: ["companies", slug] }), qc.invalidateQueries({ queryKey: ["students", slug] })]);
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;
  const { company: c, students: linked, charges } = q.data;
  const candidates = (students.data?.students ?? []).filter((s) => !s.companyName && !["inativo", "cancelado"].includes(s.status));

  return (
    <div className="stack-lg">
      <nav className="crumbs" aria-label="Trilha">
        <Link to="/e/$slug/empresas" params={{ slug }}>
          Empresas
        </Link>
        <span aria-hidden="true">/</span>
        <span>{c.name}</span>
      </nav>
      <PageHead
        title={c.name}
        subtitle={`${COMPANY_MODEL_LABELS[c.model]} · CNPJ ${formatCnpj(c.cnpj)} · vigência ${fmtIsoDate(c.startsOn)} a ${fmtIsoDate(c.endsOn)}`}
        actions={
          <>
            <Badge tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const endsOn = prompt("Novo fim da vigência (AAAA-MM-DD)", addDaysIso(c.endsOn > todayIso() ? c.endsOn : todayIso(), 365));
                if (endsOn) act.mutate(() => school.renewCompany(slug, c.id, { endsOn }));
              }}
            >
              Renovar contrato
            </button>
            <button type="button" className="btn" onClick={() => setEditing(!editing)}>
              Editar
            </button>
          </>
        }
      />
      {editing && <CompanyForm slug={slug} company={c} onDone={() => setEditing(false)} />}
      <ActionError error={act.error} />
      {c.alerts.length > 0 && (
        <span className="badges">
          {c.alerts.map((a) => (
            <Badge key={a.message} tone={a.tone}>
              {a.message}
            </Badge>
          ))}
        </span>
      )}

      <div className="stats">
        <Stat label="Licenças em uso" value={`${c.licensesInUse}/${c.licenses}`} tone={c.licensesInUse > c.licenses ? "danger" : undefined} hint={`${c.linked} alunos vinculados`} />
        <Stat label="Consumo de aulas" value={c.contractedLessons ? `${c.consumed}/${c.contractedLessons}` : c.consumed} hint="na vigência" />
        <Stat label="Presença (30 dias)" value={c.attendancePercent != null ? `${c.attendancePercent}%` : "—"} tone={c.attendancePercent != null && c.attendancePercent < 80 ? "warn" : undefined} />
        <Stat
          label="Cobrança mensal"
          value={money(c.monthlyCompanyCents)}
          hint={c.model === "b2b" ? "a empresa paga 100% das licenças" : `empresa ${c.subsidyPercent}% · colaboradores pagam ${money(c.monthlyCollaboratorCents)} com ${c.discountPercent}% de desconto`}
        />
      </div>

      <div className="grid-2">
        <section className="panel stack">
          <h2>Alunos vinculados</h2>
          <div className="inline-form">
            <div className="field">
              <label htmlFor="link-student">Vincular aluno</label>
              <select id="link-student" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                <option value="">Escolha…</option>
                {candidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.person.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn"
              disabled={!linkId || act.isPending}
              onClick={() =>
                act.mutate(async () => {
                  const r = await school.linkStudent(slug, c.id, linkId);
                  setWarning(r.warning);
                  setLinkId("");
                })
              }
            >
              Vincular
            </button>
          </div>
          {warning && <p className="warn-box small">{warning}</p>}
          {linked.length === 0 ? (
            <p className="muted">Nenhum aluno vinculado.</p>
          ) : (
            <table className="compact">
              <tbody>
                {linked.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to="/e/$slug/alunos/$studentId" params={{ slug, studentId: s.id }}>
                        {s.name}
                      </Link>
                      <div className="muted small">
                        {s.activeEnrollments} matrícula(s) · {s.used} aulas usadas
                      </div>
                    </td>
                    <td>
                      <StudentStatusBadge status={s.status} />
                    </td>
                    <td className="right">
                      <button type="button" className="btn-link danger" onClick={() => confirm(`Desvincular ${s.name}? Ele passa a ser aluno B2C.`) && act.mutate(() => school.unlinkStudent(slug, c.id, s.id))}>
                        Desvincular
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel stack">
          <h2>Cobranças da empresa</h2>
          <div className="inline-form">
            <div className="field">
              <label htmlFor="charge-month">Mês</label>
              <input id="charge-month" type="month" value={chargeMonth} onChange={(e) => setChargeMonth(e.target.value)} />
            </div>
            <button type="button" className="btn" disabled={act.isPending} onClick={() => act.mutate(() => school.generateCharge(slug, c.id, chargeMonth))}>
              Gerar cobrança
            </button>
          </div>
          {charges.length === 0 ? (
            <p className="muted">Nenhuma cobrança gerada.</p>
          ) : (
            <table className="compact">
              <tbody>
                {charges.map((ch) => (
                  <tr key={ch.id}>
                    <td>{ch.month.split("-").reverse().join("/")}</td>
                    <td className="small muted">
                      {ch.billedLicenses} licenças · vence {fmtIsoDate(ch.dueDate)}
                    </td>
                    <td className="num">{money(ch.amountCents)}</td>
                    <td className="right">
                      {ch.paidOn ? (
                        <Badge tone="ok">
                          Paga {fmtIsoDate(ch.paidOn)} · {PAYMENT_METHOD_LABELS[ch.method!]}
                        </Badge>
                      ) : (
                        <span className="cell-actions">
                        {todayIso() > ch.dueDate && <Badge tone="danger">Vencida</Badge>}
                        <select
                          aria-label="Registrar pagamento"
                          className="select-auto"
                          value=""
                          onChange={(e) => e.target.value && act.mutate(() => school.payCharge(slug, ch.id, e.target.value as PaymentMethod))}
                        >
                          <option value="">Registrar pagamento</option>
                          {Object.entries(PAYMENT_METHOD_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="subpanel stack">
            <h3>Relatório ao RH</h3>
            <p className="small muted">
              {c.hrName ?? "Sem contato"} · {c.hrEmail ?? "sem e-mail"}
              {c.lastReportSentAt ? ` · último registro em ${fmtDate(c.lastReportSentAt)}` : ""}
            </p>
            <p className="small">
              {linked.length} alunos · {c.licensesInUse} licenças em uso · presença {c.attendancePercent != null ? `${c.attendancePercent}%` : "—"} · {c.consumed} aulas consumidas
            </p>
            <button type="button" className="btn" disabled={act.isPending} onClick={() => act.mutate(() => school.recordReport(slug, c.id))}>
              Registrar envio do relatório
            </button>
            <p className="muted small">O envio por e-mail entra junto com os convites; por enquanto fica registrado na auditoria.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
