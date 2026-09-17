import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { school } from "../api-school.ts";
import { fmtDate, fmtTime } from "../lib/format.ts";
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
                      {label(e.entity)} <Badge tone={(ACTION[e.action] ?? [e.action, "neutral"])[1]}>{(ACTION[e.action] ?? [e.action])[0]}</Badge>
                    </td>
                    <td className="small">
                      {e.changed.length ? e.changed.join(", ") : "—"}
                      {e.justification && <div className="muted">Justificativa: {e.justification}</div>}{" "}
                      <button type="button" className="btn-link" onClick={() => setOpen(open === e.id ? null : e.id)}>
                        {open === e.id ? "Fechar" : "Detalhes"}
                      </button>
                    </td>
                  </tr>
                  {open === e.id && (
                    <tr className="detail-row">
                      <td colSpan={4}>
                        <div className="grid-2">
                          <pre className="json">{JSON.stringify(e.before, null, 2) ?? "—"}</pre>
                          <pre className="json">{JSON.stringify(e.after, null, 2) ?? "—"}</pre>
                        </div>
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
