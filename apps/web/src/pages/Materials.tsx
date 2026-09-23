import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api, issuesOf } from "../api.ts";
import { school, type Material } from "../api-school.ts";
import { useCan } from "../lib/permissions.ts";
import { ActionError, Badge, Empty, Field, FormError, LoadError, Loading, PageHead } from "../ui.tsx";

type Draft = { courseId: string; moduleId: string; title: string; url: string; notes: string };
const EMPTY: Draft = { courseId: "", moduleId: "", title: "", url: "", notes: "" };

/**
 * Material do aluno (DOMINIO.md §4.5). O Acadêmico cadastra um link por curso
 * ou por nível; no pós-venda da entrada, o CX envia e o aluno vê na área dele.
 */
export function Materials() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const qc = useQueryClient();
  const canEdit = useCan("materiais", "editar");
  const canToggle = useCan("materiais", "inativar");
  const q = useQuery({ queryKey: ["materials", slug], queryFn: () => school.materials(slug) });
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const toggle = useMutation({
    mutationFn: (m: Material) => school.setMaterialActive(slug, m.id, !!m.deactivatedAt),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["materials", slug] }),
  });

  const byCourse = new Map<string, Material[]>();
  for (const m of q.data?.materials ?? []) byCourse.set(m.courseName, [...(byCourse.get(m.courseName) ?? []), m]);

  return (
    <div className="stack-lg">
      <PageHead
        title="Materiais"
        subtitle="O link do material de cada curso e de cada nível. O CX envia na chegada do aluno, e ele encontra na área dele."
        actions={
          canEdit &&
          !editing && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ id: null, draft: EMPTY })}>
              Novo material
            </button>
          )
        }
      />
      {editing && (
        <MaterialForm
          slug={slug}
          id={editing.id}
          initial={editing.draft}
          onDone={async () => {
            setEditing(null);
            await qc.invalidateQueries({ queryKey: ["materials", slug] });
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} />
      ) : byCourse.size === 0 ? (
        <Empty>Nenhum material cadastrado. Sem material, o CX não tem o que enviar no fim da entrada do aluno.</Empty>
      ) : (
        [...byCourse.entries()].map(([courseName, list]) => (
          <section key={courseName} className="panel stack">
            <h2>{courseName}</h2>
            <table className="compact">
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className={m.deactivatedAt ? "is-off" : undefined}>
                    <td>
                      <a href={m.url} target="_blank" rel="noreferrer">
                        {m.title}
                      </a>
                      {m.notes && <div className="muted small">{m.notes}</div>}
                    </td>
                    <td className="small">{m.moduleName ? <Badge tone="info">{m.moduleName}</Badge> : <span className="muted">Curso todo</span>}</td>
                    <td className="small">{m.deactivatedAt && <Badge tone="muted">Inativo</Badge>}</td>
                    <td className="right">
                      <span className="actions">
                        {canEdit && (
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => setEditing({ id: m.id, draft: { courseId: m.courseId, moduleId: m.moduleId ?? "", title: m.title, url: m.url, notes: m.notes ?? "" } })}
                          >
                            Editar
                          </button>
                        )}
                        {canToggle && (
                          <button type="button" className={`btn-link${m.deactivatedAt ? "" : " danger"}`} disabled={toggle.isPending} onClick={() => toggle.mutate(m)}>
                            {m.deactivatedAt ? "Reativar" : "Inativar"}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
      <ActionError error={toggle.error} />
    </div>
  );
}

function MaterialForm({ slug, id, initial, onDone, onCancel }: { slug: string; id: string | null; initial: Draft; onDone: () => Promise<unknown>; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const modules = courses.data?.courses.find((c) => c.id === d.courseId)?.modules.filter((m) => !m.deactivatedAt) ?? [];
  const save = useMutation({
    mutationFn: () => {
      const input = { courseId: d.courseId, moduleId: d.moduleId || null, title: d.title, url: d.url, notes: d.notes || null };
      return id ? school.updateMaterial(slug, id, input) : school.createMaterial(slug, input);
    },
    onSuccess: onDone,
  });
  const issues = issuesOf(save.error);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value, ...(k === "courseId" ? { moduleId: "" } : {}) });
  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>{id ? "Editar material" : "Novo material"}</h2>
      <div className="grid-fields">
        <Field label="Curso" htmlFor="mt-course" errors={issues.courseId}>
          <select id="mt-course" value={d.courseId} onChange={set("courseId")}>
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
        <Field label="Nível" htmlFor="mt-module" errors={issues.moduleId} hint="Vazio: vale para qualquer nível do curso">
          <select id="mt-module" value={d.moduleId} onChange={set("moduleId")} disabled={modules.length === 0}>
            <option value="">Curso todo</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Título" htmlFor="mt-title" errors={issues.title}>
          <input id="mt-title" value={d.title} onChange={set("title")} placeholder="Ex.: Livro do aluno · Nível 2" />
        </Field>
        <Field label="Link" htmlFor="mt-url" errors={issues.url} hint="Drive, plataforma ou PDF">
          <input id="mt-url" type="url" value={d.url} onChange={set("url")} placeholder="https://" />
        </Field>
      </div>
      <Field label="Observação para o aluno" htmlFor="mt-notes">
        <textarea id="mt-notes" rows={2} value={d.notes} onChange={set("notes")} />
      </Field>
      <FormError error={save.error} />
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
