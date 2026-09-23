import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api, brl, COURSE_TYPE_LABELS, COURSE_TYPES, issuesOf, parseReais, type CourseType } from "../api.ts";
import { ColorDot, Field, FormError, StatusBadge } from "../ui.tsx";
import { draftFromRules, RulesFields, rulesFromDraft, type RulesDraft } from "./CourseRulesFields.tsx";

/* regras iniciais por tipo, espelhando apps/api/src/modules/courses/domain.ts */
const DEFAULTS: Record<CourseType, RulesDraft> = {
  grupo: draftFromRules({ capacity: 8, lessonMinutes: 45, packageLessons: 48, cancelNoticeHours: 6, lessonPriceCents: 6000, modalities: ["online"], autoAgenda: true }),
  particular: draftFromRules({ capacity: 1, lessonMinutes: 60, packageLessons: 32, cancelNoticeHours: 24, lessonPriceCents: 14000, modalities: ["online", "presencial"], autoAgenda: true }),
  hibrido: draftFromRules({ capacity: 8, lessonMinutes: 45, packageLessons: 48, cancelNoticeHours: 6, lessonPriceCents: 6000, modalities: ["online", "presencial"], autoAgenda: true }),
  workshop: draftFromRules({ capacity: 20, lessonMinutes: 90, packageLessons: 1, cancelNoticeHours: 24, lessonPriceCents: 8000, modalities: ["online"], autoAgenda: true }),
  turmas_dedicadas: draftFromRules({ capacity: 25, lessonMinutes: 50, packageLessons: 36, cancelNoticeHours: 6, lessonPriceCents: 40000, modalities: ["presencial", "online"], autoAgenda: true }),
};

export function Courses() {
  const { slug } = useParams({ from: "/e/$slug/cursos" });
  const courses = useQuery({ queryKey: ["courses", slug], queryFn: () => api.courses(slug) });
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const list = (courses.data?.courses ?? []).filter((c) => showInactive || !c.deactivatedAt);
  const inactiveCount = (courses.data?.courses ?? []).filter((c) => c.deactivatedAt).length;

  return (
    <div className="stack-lg">
      <header className="page-head">
        <div>
          <h1>Cursos</h1>
          <p className="muted">O que a escola oferece, com as regras de vagas, duração, pacote e valor.</p>
        </div>
        {!creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            Novo curso
          </button>
        )}
      </header>

      {creating && <NewCourse slug={slug} onClose={() => setCreating(false)} />}

      {courses.isPending ? (
        <p>Carregando…</p>
      ) : courses.isError ? (
        <p className="error">Não foi possível carregar os cursos.</p>
      ) : courses.data.courses.length === 0 ? (
        !creating && (
          <div className="empty">
            <p>Nenhum curso cadastrado ainda.</p>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Cadastrar o primeiro curso
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
                  <th>Curso</th>
                  <th>Tipo</th>
                  <th className="num">Módulos</th>
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
                    <td>{COURSE_TYPE_LABELS[c.type]}</td>
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
  const [type, setType] = useState<CourseType>("grupo");
  const [rules, setRules] = useState<RulesDraft>(DEFAULTS.grupo);

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
      <h2>Novo curso</h2>
      <div className="grid-fields">
        <Field label="Nome" htmlFor="course-name" errors={issues.name}>
          <input id="course-name" value={name} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Tipo" htmlFor="course-type" errors={issues.type} hint="Não muda depois de criado.">
          <select
            id="course-type"
            value={type}
            onChange={(e) => {
              const next = e.target.value as CourseType;
              setType(next);
              setRules(DEFAULTS[next]);
            }}
          >
            {COURSE_TYPES.map((t) => (
              <option key={t} value={t}>
                {COURSE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="muted">As regras abaixo vêm preenchidas com o padrão do tipo. Ajuste o que for diferente na sua escola.</p>
      <RulesFields draft={rules} onChange={setRules} issues={issues} type={type} />
      <FormError error={create.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? "Salvando…" : "Criar curso"}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
