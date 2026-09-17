import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  allowsModules,
  api,
  COURSE_TYPE_LABELS,
  issuesOf,
  parseReais,
  type Course,
  type CourseModule,
} from "../api.ts";
import { ColorDot, Field, FormError, StatusBadge } from "../ui.tsx";
import { draftFromRules, RulesFields, rulesFromDraft, type RulesDraft } from "./CourseRulesFields.tsx";

export function CourseDetail() {
  const { slug, courseId } = useParams({ from: "/e/$slug/cursos/$courseId" });
  const query = useQuery({ queryKey: ["course", slug, courseId], queryFn: () => api.course(slug, courseId) });

  if (query.isPending) return <p>Carregando…</p>;
  if (query.isError) {
    return (
      <div className="stack">
        <p className="error">Curso não encontrado.</p>
        <Link to="/e/$slug/cursos" params={{ slug }} className="btn">
          Voltar para cursos
        </Link>
      </div>
    );
  }
  return <CourseEditor key={query.data.course.id} slug={slug} course={query.data.course} />;
}

function useRefresh(slug: string, courseId: string) {
  const queryClient = useQueryClient();
  return (course?: Course) => {
    if (course) queryClient.setQueryData(["course", slug, courseId], { course });
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["courses", slug] }),
      queryClient.invalidateQueries({ queryKey: ["course", slug, courseId] }),
    ]);
  };
}

function CourseEditor({ slug, course }: { slug: string; course: Course }) {
  const refresh = useRefresh(slug, course.id);
  const [name, setName] = useState(course.name);
  const [color, setColor] = useState(course.color);
  const [rules, setRules] = useState<RulesDraft>(draftFromRules(course));
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.updateCourse(slug, course.id, { name, color, ...rulesFromDraft(rules, course.type, parseReais) }),
    onSuccess: async ({ course: updated }) => {
      await refresh(updated);
      setSaved(true);
    },
  });
  const toggle = useMutation({
    mutationFn: () => api.setCourseActive(slug, course.id, !!course.deactivatedAt),
    onSuccess: ({ course: updated }) => refresh(updated),
  });
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  const issues = issuesOf(save.error);
  const inactive = !!course.deactivatedAt;

  return (
    <div className="stack-lg">
      <nav className="crumbs" aria-label="Trilha">
        <Link to="/e/$slug/cursos" params={{ slug }}>
          Cursos
        </Link>
        <span aria-hidden="true">/</span>
        <span>{course.name}</span>
      </nav>

      <header className="page-head">
        <div>
          <h1 className="title-with-dot">
            <ColorDot color={course.color} />
            {course.name}
          </h1>
          <p className="muted">
            {COURSE_TYPE_LABELS[course.type]} · <StatusBadge inactive={inactive} />
          </p>
        </div>
        <button
          type="button"
          className={inactive ? "btn" : "btn btn-danger"}
          disabled={toggle.isPending}
          onClick={() => {
            if (inactive || confirm(`Inativar "${course.name}"? Ele some das listas, mas nada é apagado e dá para reativar.`)) {
              toggle.mutate();
            }
          }}
        >
          {inactive ? "Reativar curso" : "Inativar curso"}
        </button>
      </header>

      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h2>Dados e regras</h2>
        <div className="grid-fields">
          <Field label="Nome" htmlFor="course-name" errors={issues.name}>
            <input id="course-name" value={name} required onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Cor" htmlFor="course-color" errors={issues.color} hint="Usada na agenda e nos badges.">
            <input id="course-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </Field>
        </div>
        <RulesFields draft={rules} onChange={setRules} issues={issues} type={course.type} />
        <FormError error={save.error} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar alterações"}
          </button>
          {saved && (
            <span className="ok" role="status">
              Alterações salvas
            </span>
          )}
        </div>
      </form>

      {allowsModules(course.type) ? (
        <Modules slug={slug} course={course} />
      ) : (
        <section className="panel">
          <h2>Módulos</h2>
          <p className="muted">Cursos do tipo {COURSE_TYPE_LABELS[course.type].toLowerCase()} não se dividem em módulos.</p>
        </section>
      )}
    </div>
  );
}

function Modules({ slug, course }: { slug: string; course: Course }) {
  const refresh = useRefresh(slug, course.id);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.createModule(slug, course.id, { name }),
    onSuccess: async () => {
      setName("");
      await refresh();
    },
  });
  const issues = issuesOf(create.error);
  const label = course.type === "turmas_dedicadas" ? "turma" : "módulo";

  return (
    <section className="panel stack">
      <div>
        <h2>{course.type === "turmas_dedicadas" ? "Turmas do contrato" : "Módulos"}</h2>
        <p className="muted">
          {course.type === "turmas_dedicadas"
            ? "Cada turma do contrato com a empresa ocupa o lugar de um módulo."
            : "Os níveis do curso, na ordem em que o aluno avança."}
        </p>
      </div>

      {course.modules.length > 0 && (
        <ol className="modules">
          {course.modules.map((m) => (
            <ModuleRow key={m.id} slug={slug} courseId={course.id} module={m} />
          ))}
        </ol>
      )}

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={`Novo ${label}`} htmlFor="module-name" errors={issues.name}>
          <input
            id="module-name"
            value={name}
            required
            placeholder={course.type === "turmas_dedicadas" ? "Turma 1" : "Nível 1"}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn" disabled={create.isPending}>
          Adicionar {label}
        </button>
      </form>
      <FormError error={create.error} />
    </section>
  );
}

function ModuleRow({ slug, courseId, module: m }: { slug: string; courseId: string; module: CourseModule }) {
  const refresh = useRefresh(slug, courseId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);
  const rename = useMutation({
    mutationFn: () => api.updateModule(slug, courseId, m.id, { name }),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: () => api.setModuleActive(slug, courseId, m.id, !!m.deactivatedAt),
    onSuccess: () => refresh(),
  });
  const inactive = !!m.deactivatedAt;

  return (
    <li className={inactive ? "is-off" : undefined}>
      {editing ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate();
          }}
        >
          <Field label="Nome" htmlFor={`module-${m.id}`} errors={issuesOf(rename.error).name}>
            <input id={`module-${m.id}`} value={name} required autoFocus onChange={(e) => setName(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={rename.isPending}>
            Salvar
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setName(m.name);
              setEditing(false);
            }}
          >
            Cancelar
          </button>
        </form>
      ) : (
        <>
          <span className="module-name">
            <ColorDot color={m.color} />
            {m.name}
            {inactive && <StatusBadge inactive />}
          </span>
          <span className="row-actions">
            <button type="button" className="btn-link" onClick={() => setEditing(true)}>
              Renomear
            </button>
            <button type="button" className="btn-link" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {inactive ? "Reativar" : "Inativar"}
            </button>
          </span>
        </>
      )}
    </li>
  );
}
