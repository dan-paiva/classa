import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { type AuditEntry, school } from "../api-school.ts";
import { fmtDate, fmtTime, money } from "../lib/format.ts";
import { Badge, LoadError, Loading, PageHead, type Tone } from "../ui.tsx";

const ENTITY: Record<string, string> = {
  tenant: "Escola",
  course: "Curso",
  course_module: "Módulo",
  person: "Pessoa",
  teacher: "Professor",
  student: "Aluno",
  room: "Sala",
  class_group: "Turma",
  holiday: "Feriado",
  lesson: "Aula",
  lesson_student: "Agendamento",
  agenda_event: "Reunião, evento ou nivelamento",
  course_material: "Material",
  enrollment: "Matrícula",
  credit_entry: "Crédito",
  contract: "Contrato",
  payment: "Pagamento",
  payroll_period: "Folha",
  payroll_line: "Folha · professor",
  company: "Empresa",
  company_charge: "Cobrança de empresa",
  lead: "Lead",
  membership: "Acesso",
  invitation: "Convite",
};
const ACTION: Record<string, [string, Tone]> = {
  create: ["criação", "ok"],
  update: ["alteração", "info"],
  deactivate: ["inativação", "warn"],
  reactivate: ["reativação", "neutral"],
  delete: ["exclusão", "danger"],
  cancel: ["cancelamento", "danger"],
  import: ["importação", "neutral"],
  transition: ["mudança de etapa", "info"],
};
const label = (e: string) => ENTITY[e] ?? (e.startsWith("fluxo:") ? `Fluxo · ${e.slice(6)}` : e);

/** Nome de cada campo em português; o que não estiver aqui aparece como veio. */
const FIELD: Record<string, string> = {
  name: "nome",
  email: "e-mail",
  phone: "telefone",
  cpf: "CPF",
  status: "situação",
  state: "situação da aula",
  stage: "etapa",
  previousStage: "etapa anterior",
  lostReason: "motivo da perda",
  data: "dados",
  studentId: "aluno",
  teacherId: "professor",
  originalTeacherId: "professor original",
  roomId: "sala",
  classGroupId: "turma",
  courseId: "curso",
  moduleId: "módulo",
  personId: "pessoa",
  companyId: "empresa",
  enrollmentId: "matrícula",
  capacity: "vagas",
  startsAt: "início",
  endsAt: "término",
  startsOn: "começa em",
  endsOn: "termina em",
  endedAt: "encerrada em",
  dueDate: "vencimento",
  paidOn: "pago em",
  amountCents: "valor",
  amount: "quantidade",
  rateOverrideCents: "valor da aula",
  teacherRateCents: "valor por aula do professor",
  hourlyRateCents: "valor por hora",
  lessonPriceCents: "preço da aula",
  weeklyLimit: "limite semanal",
  availability: "disponibilidade",
  areas: "áreas",
  level: "nível",
  profileType: "tipo de acesso",
  acceptedAt: "aceito em",
  revokedAt: "cancelado em",
  deactivatedAt: "inativado em",
  cancelledAt: "cancelado em",
  cancelReason: "motivo do cancelamento",
  cancelledInTime: "cancelou com antecedência",
  supportReason: "motivo do apoio",
  notes: "observações",
  kind: "tipo",
  membershipId: "acesso",
  settings: "configurações",
  createdAt: "criado em",
  createdBy: "criado por",
  updatedAt: "atualizado em",
  expiresAt: "expira em",
  acceptedUserId: "conta que aceitou",
  actorId: "autor",
  justification: "justificativa",
  reversalOfId: "estorno de",
  color: "cor",
  position: "posição",
  modality: "modalidade",
  timezone: "fuso",
  slug: "link da escola",
  rateOverrideReason: "motivo do valor",
  supportDetail: "detalhe do apoio",
  paidCents: "valor pago",
  netCents: "valor líquido",
  grossCents: "valor bruto",
  discountCents: "descontos",
};
const fieldLabel = (f: string) => FIELD[f] ?? f;

const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** Valor de um campo em texto simples: data vira data, objeto vira "chave: valor". */
function valueText(v: unknown, field?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  // valor em centavos no banco vira dinheiro na tela
  if (field?.endsWith("Cents") && typeof v === "number") return money(v);
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "string") return ISO.test(v) ? `${fmtDate(v)} ${fmtTime(v)}` : v;
  if (Array.isArray(v)) return v.length ? v.map((item) => valueText(item, field)).join(", ") : "—";
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    return entries.length ? entries.map(([k, val]) => `${fieldLabel(k)}: ${valueText(val, k)}`).join(" · ") : "—";
  }
  return String(v);
}

function Detail({ entry }: { entry: AuditEntry }) {
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const hidden = new Set(["id", "tenantId", "createdAt", "createdBy", "updatedAt", "actorId"]);
  const fields = entry.changed.length ? entry.changed : Object.keys(after).filter((k) => !hidden.has(k));
  if (fields.length === 0) return <p className="muted small">Sem campos para mostrar.</p>;
  return (
    <table className="compact audit-detail">
      <thead>
        <tr>
          <th>Campo</th>
          <th>Antes</th>
          <th>Depois</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f}>
            <td>{fieldLabel(f)}</td>
            <td className="muted">{entry.before ? valueText(before[f], f) : "—"}</td>
            <td>{valueText(after[f], f)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Audit() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["audit", slug, entity, page], queryFn: () => school.audit(slug, { entity: entity || undefined, page }) });

  return (
    <div className="stack-lg">
      <PageHead title="Auditoria" subtitle="Toda alteração feita na escola: quem, quando, o quê e os valores de antes e depois." />
      <div className="toolbar">
        <select
          aria-label="Tipo de registro"
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Todos os registros</option>
          {q.data?.entities.map((x) => (
            <option key={x.entity} value={x.entity}>
              {label(x.entity)} ({x.n})
            </option>
          ))}
        </select>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Registro</th>
                <th>O que mudou</th>
              </tr>
            </thead>
            <tbody>
              {q.data.entries.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <td className="small">
                      {fmtDate(e.createdAt)} {fmtTime(e.createdAt)}
                    </td>
                    <td className="small">
                      {e.actorName}
                      {e.actorEmail && <div className="muted">{e.actorEmail}</div>}
                    </td>
                    <td>
                      {label(e.entity)}{" "}
                      <Badge tone={(ACTION[e.action] ?? [e.action, "neutral"])[1]}>
                        {e.action === "transition" && e.entity === "lesson" ? "mudança de situação" : (ACTION[e.action] ?? [e.action])[0]}
                      </Badge>
                    </td>
                    <td className="small">
                      {e.changed.length ? e.changed.map(fieldLabel).join(", ") : "—"}
                      {e.justification && <div className="muted">Justificativa: {e.justification}</div>}{" "}
                      <button type="button" className="btn-link" onClick={() => setOpen(open === e.id ? null : e.id)}>
                        {open === e.id ? "Fechar" : "Detalhes"}
                      </button>
                    </td>
                  </tr>
                  {open === e.id && (
                    <tr className="detail-row">
                      <td colSpan={4}>
                        <Detail entry={e} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ← Mais recentes
        </button>
        <button type="button" className="btn" disabled={!q.data?.hasMore} onClick={() => setPage(page + 1)}>
          Mais antigos →
        </button>
      </div>
    </div>
  );
}
