import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { defaultCourseRules } from "@classa/domain";
import { api, brl, COURSE_TYPES, issuesOf, parseReais, type CourseType } from "../api.ts";
import { useVocab } from "../lib/vocabulary.ts";
import { Badge, ColorDot, Field, FormError, StatusBadge } from "../ui.tsx";
import { draftFromRules, RulesFields, rulesFromDraft, type RulesDraft } from "./CourseRulesFields.tsx";

/* regras iniciais por tipo: as mesmas da API (`defaultCourseRules`) */
const defaults = (type: CourseType): RulesDraft => draftFromRules(defaultCourseRules(type));

export function Courses() {
  const { slug } = useParams({ from: "/e/$slug/cursos" });
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const v = useVocab();
  const list = (courses.data?.courses ?? []).filter((c) => showInactive || !c.deactivatedAt);
  const inactiveCount = (courses.data?.courses ?? []).filter((c) => c.deactivatedAt).length;

  return (
    <div className="stack-lg">
      <header className="page-head">
        <div>
          <h1>{v.course.plural}</h1>
          <p className="muted">
            O que a escola oferece. O tipo define como o aluno faz as aulas ({v.kind("regular")}, {v.kind("open_entry")} ou {v.kind("particular")}); vagas,
            duração, pacote e valor você ajusta.
          </p>
        </div>
        {!creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {v.novo("course")}
          </button>
        )}
      </header>

      {creating && <NewCourse slug={slug} onClose={() => setCreating(false)} />}

      {courses.isPending ? (
        <p>Carregando…</p>
      ) : courses.isError ? (
        <p className="error">Não foi possível carregar {v.lower("course", true)}.</p>
      ) : courses.data.courses.length === 0 ? (
        !creating && (
          <div className="empty">
            <p>Nada cadastrado em {v.lower("course", true)} ainda.</p>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              {v.novo("course")}
            </button>
          </div>
        )
      ) : (
        <>
          {inactiveCount > 0 && (
            <label className="check" htmlFor="show-inactive">
              <input id="show-inactive" type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Mostrar inativos ({inactiveCount})
            </label>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{v.course.singular}</th>
                  <th>Tipo</th>
                  <th className="num">{v.level.plural}</th>
                  <th className="num">Alunos/aula</th>
                  <th className="num">Duração</th>
                  <th className="num">Pacote</th>
                  <th className="num">Valor/aula</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to="/e/$slug/cursos/$courseId" params={{ slug, courseId: c.id }} className="row-link">
                        <ColorDot color={c.color} />
                        {c.name}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={c.type === "open_entry" ? "info" : c.type === "particular" ? "warn" : "neutral"}>{v.kind(c.type)}</Badge>
                    </td>
                    <td className="num">{c.modules.filter((m) => !m.deactivatedAt).length || "—"}</td>
                    <td className="num">{c.capacity}</td>
                    <td className="num">{c.lessonMinutes} min</td>
                    <td className="num">{c.packageLessons} aulas</td>
                    <td className="num">{brl.format(c.lessonPriceCents / 100)}</td>
                    <td>
                      <StatusBadge inactive={!!c.deactivatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function NewCourse({ slug, onClose }: { slug: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const v = useVocab();
  const [type, setType] = useState<CourseType>("regular");
  const [rules, setRules] = useState<RulesDraft>(defaults("regular"));

  const create = useMutation({
    mutationFn: () => api.createCourse(slug, { name, type, ...rulesFromDraft(rules, type, parseReais) }),
    onSuccess: async ({ course }) => {
      await queryClient.invalidateQueries({ queryKey: ["courses", slug] });
      navigate({ to: "/e/$slug/cursos/$courseId", params: { slug, courseId: course.id } });
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
      <h2>{v.novo("course")}</h2>
      <Field label="Nome" htmlFor="course-name" errors={issues.name}>
        <input id="course-name" value={name} required onChange={(e) => setName(e.target.value)} />
      </Field>
      <fieldset className="field">
        <legend>Tipo · não muda depois de criado</legend>
        <div className="kind-choice">
          {COURSE_TYPES.map((t) => (
            <label key={t} htmlFor={`course-type-${t}`}>
              <span className="kind-title">
                <input
                  id={`course-type-${t}`}
                  type="radio"
                  name="course-type"
                  checked={type === t}
                  onChange={() => {
                    setType(t);
                    setRules(defaults(t));
                  }}
                />
                {v.kind(t)}
              </span>
              <ul className="rules">
                {v.rules(t).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </label>
          ))}
        </div>
        {issues.type?.[0] && <small className="error">{issues.type[0]}</small>}
      </fieldset>
      <p className="muted">As regras abaixo vêm preenchidas com o padrão do tipo. Ajuste o que for diferente na sua escola.</p>
      <RulesFields draft={rules} onChange={setRules} issues={issues} type={type} />
      <FormError error={create.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? "Salvando…" : "Criar"}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
