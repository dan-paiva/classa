import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { AREA_LABELS, AREAS, COURSE_KINDS, DEFAULT_VOCABULARY, type Term, type Vocabulary } from "@classa/domain";
import { issuesOf } from "../api.ts";
import { ROOM_KIND_LABELS, school, type Room } from "../api-school.ts";
import { fmtIsoDate, todayIso } from "../lib/format.ts";
import { Badge, Field, FormError, Loading, PageHead } from "../ui.tsx";
import { Team } from "./Team.tsx";
import { useSchoolSettings, useVocab } from "../lib/vocabulary.ts";

export function Settings() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  return (
    <div className="stack-lg">
      <PageHead title="Configurações" subtitle="Equipe e acessos, nomes que a escola usa, aula bônus, salas e calendário." />
      <Team />
      <div className="grid-2">
        <VocabularySettings slug={slug} />
        <BonusSettings slug={slug} />
      </div>
      <div className="grid-2">
        <Rooms slug={slug} />
        <Holidays slug={slug} />
      </div>
      <FlowSettings slug={slug} />
    </div>
  );
}

function Rooms({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rooms", slug], queryFn: () => school.rooms(slug) });
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Room["kind"]>("virtual");
  const [link, setLink] = useState("");
  const [capacity, setCapacity] = useState("");
  const create = useMutation({
    mutationFn: () => school.createRoom(slug, { name, kind, link: link || null, capacity: capacity ? Number(capacity) : null }),
    onSuccess: async () => {
      setName("");
      setLink("");
      setCapacity("");
      await qc.invalidateQueries({ queryKey: ["rooms", slug] });
    },
  });
  const issues = issuesOf(create.error);
  return (
    <section className="panel stack">
      <h2>Salas</h2>
      {q.isPending ? (
        <Loading />
      ) : (
        <table className="compact">
          <tbody>
            {q.data?.rooms.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>
                  <Badge tone={r.kind === "virtual" ? "info" : "neutral"}>{ROOM_KIND_LABELS[r.kind]}</Badge>
                </td>
                <td className="small">
                  {r.link ? (
                    <a href={r.link} target="_blank" rel="noreferrer">
                      link
                    </a>
                  ) : r.capacity ? (
                    `${r.capacity} pessoas`
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid-fields">
          <Field label="Nome" htmlFor="room-name" errors={issues.name}>
            <input id="room-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Tipo" htmlFor="room-kind" errors={issues.kind}>
            <select id="room-kind" value={kind} onChange={(e) => setKind(e.target.value as Room["kind"])}>
              {Object.entries(ROOM_KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {kind === "virtual" ? (
            <Field label="Link da reunião" htmlFor="room-link" errors={issues.link}>
              <input id="room-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
            </Field>
          ) : (
            <Field label="Capacidade" htmlFor="room-cap" errors={issues.capacity}>
              <input id="room-cap" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </Field>
          )}
        </div>
        <FormError error={create.error} />
        <button type="submit" className="btn" disabled={create.isPending}>
          Adicionar sala
        </button>
      </form>
    </section>
  );
}

function Holidays({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const q = useQuery({ queryKey: ["holidays", slug, year], queryFn: () => school.holidays(slug, year) });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [name, setName] = useState("Recesso");
  const refresh = () => qc.invalidateQueries({ queryKey: ["holidays", slug] });
  const importYear = useMutation({ mutationFn: () => school.importHolidays(slug, year), onSuccess: refresh });
  const recess = useMutation({ mutationFn: () => school.addRecess(slug, { from, to, name }), onSuccess: refresh });
  const issues = issuesOf(recess.error);
  const nacionais = q.data?.holidays.filter((h) => h.kind === "nacional").length ?? 0;
  return (
    <section className="panel stack">
      <div className="row">
        <h2>Feriados e recessos</h2>
        <span className="actions">
          <button type="button" className="btn-link" onClick={() => setYear(year - 1)}>
            ←
          </button>
          <strong>{year}</strong>
          <button type="button" className="btn-link" onClick={() => setYear(year + 1)}>
            →
          </button>
        </span>
      </div>
      {!q.isPending && nacionais === 0 && (
        <p className="warn-box small">
          {year} não tem feriados nacionais importados: a agenda gera aula nesses dias.{" "}
          <button type="button" className="btn-link" onClick={() => importYear.mutate()}>
            Importar feriados de {year}
          </button>
        </p>
      )}
      <ul className="plain small holiday-list">
        {q.data?.holidays.map((h) => (
          <li key={h.id}>
            {fmtIsoDate(h.date)} · {h.name} <Badge tone={h.kind === "recesso" ? "warn" : "muted"}>{h.kind}</Badge>
          </li>
        ))}
      </ul>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          recess.mutate();
        }}
      >
        <div className="grid-fields">
          <Field label="Recesso de" htmlFor="rec-from" errors={issues.from}>
            <input id="rec-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="até" htmlFor="rec-to" errors={issues.to}>
            <input id="rec-to" type="date" required value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Nome" htmlFor="rec-name" errors={issues.name}>
            <input id="rec-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <FormError error={recess.error} />
        <button type="submit" className="btn" disabled={recess.isPending}>
          Adicionar recesso
        </button>
        <p className="muted small">Aulas já geradas nesses dias não são removidas automaticamente; cancele-as pela agenda.</p>
      </form>
    </section>
  );
}

/** Decisão D16: que área matricula no fim da entrada do aluno. */
function FlowSettings({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const flows = useQuery({ queryKey: ["flows", slug], queryFn: () => school.flows(slug) });
  const current = flows.data?.stageAreas.entrada?.matricula ?? "adm";
  const save = useMutation({
    mutationFn: (area: string) => school.saveFlowSettings(slug, { entryEnrollmentArea: area }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flows", slug] }),
  });
  return (
    <section className="panel stack">
      <h2>Fluxos</h2>
      <Field label="Quem matricula no fim da entrada do aluno" htmlFor="entry-area" hint="Essa área recebe o card depois do nivelamento, converte o lead em aluno e abre a matrícula.">
        <select id="entry-area" value={current} disabled={flows.isPending || save.isPending} onChange={(e) => save.mutate(e.target.value)}>
          {AREAS.map((a) => (
            <option key={a} value={a}>
              {AREA_LABELS[a]}
            </option>
          ))}
        </select>
      </Field>
      <FormError error={save.error} />
    </section>
  );
}

type TermKey = "course" | "level" | "classGroup";
const TERM_LABELS: Record<TermKey, string> = { course: "Curso", level: "Nível", classGroup: "Turma" };

/** Como a escola chama curso, nível, turma e os tipos de curso (DOMINIO.md §4.6). */
function VocabularySettings({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const settings = useSchoolSettings();
  const current = settings.data?.vocabulary;
  const [draft, setDraft] = useState<Vocabulary | null>(null);
  const [saved, setSaved] = useState(false);
  const v = draft ?? current ?? DEFAULT_VOCABULARY;
  const save = useMutation({
    mutationFn: () => school.saveVocabulary(slug, v),
    onSuccess: async () => {
      setDraft(null);
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["school-settings", slug] });
    },
  });
  const issues = issuesOf(save.error);
  const setTerm = (k: TermKey, patch: Partial<Term>) => {
    setSaved(false);
    setDraft({ ...v, [k]: { ...v[k], ...patch } });
  };
  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <h2>Nomes da escola</h2>
        <p className="muted small">Como a escola chama cada coisa. Muda só o que aparece nas telas; as regras continuam presas ao tipo do curso.</p>
      </div>
      <table className="compact">
        <thead>
          <tr>
            <th>Padrão</th>
            <th>Singular</th>
            <th>Plural</th>
            <th>Feminino</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(TERM_LABELS) as TermKey[]).map((k) => (
            <tr key={k}>
              <td>{TERM_LABELS[k]}</td>
              <td>
                <input aria-label={`${TERM_LABELS[k]}: singular`} value={v[k].singular} onChange={(e) => setTerm(k, { singular: e.target.value })} />
              </td>
              <td>
                <input aria-label={`${TERM_LABELS[k]}: plural`} value={v[k].plural} onChange={(e) => setTerm(k, { plural: e.target.value })} />
              </td>
              <td>
                <input
                  aria-label={`${TERM_LABELS[k]}: feminino`}
                  type="checkbox"
                  checked={v[k].feminine}
                  onChange={(e) => setTerm(k, { feminine: e.target.checked })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid-fields">
        {COURSE_KINDS.map((k) => (
          <Field key={k} label={`Tipo ${DEFAULT_VOCABULARY.kinds[k]}`} htmlFor={`kind-${k}`} errors={issues[`kinds.${k}`]}>
            <input
              id={`kind-${k}`}
              value={v.kinds[k]}
              onChange={(e) => {
                setSaved(false);
                setDraft({ ...v, kinds: { ...v.kinds, [k]: e.target.value } });
              }}
            />
          </Field>
        ))}
      </div>
      <FormError error={save.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={save.isPending || !draft}>
          {save.isPending ? "Salvando…" : "Salvar nomes"}
        </button>
        <button type="button" className="btn" disabled={save.isPending} onClick={() => setDraft(DEFAULT_VOCABULARY)}>
          Voltar ao padrão
        </button>
        {saved && (
          <span className="ok" role="status">
            Salvo
          </span>
        )}
      </div>
    </form>
  );
}

/** A cada N presenças em aula open entry, uma aula private de bônus (DOMINIO.md §5.9.1). */
function BonusSettings({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const settings = useSchoolSettings();
  const v = useVocab();
  const rule = settings.data?.bonus;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [every, setEvery] = useState<string | null>(null);
  const on = enabled ?? rule?.enabled ?? false;
  const n = every ?? String(rule?.every ?? 5);
  const save = useMutation({
    mutationFn: () => school.saveBonus(slug, { enabled: on, every: Number(n) }),
    onSuccess: async () => {
      setEnabled(null);
      setEvery(null);
      await qc.invalidateQueries({ queryKey: ["school-settings", slug] });
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
      <div>
        <h2>Aula {v.kind("particular")} bônus</h2>
        <p className="muted small">
          O aluno que frequenta aulas {v.kind("open_entry")} ganha uma aula {v.kind("particular")} a cada tantas presenças. O crédito entra sozinho na
          matrícula {v.kind("particular")} dele; sem ela, fica guardado e entra quando ela for criada.
        </p>
      </div>
      <label className="check" htmlFor="bonus-on">
        <input id="bonus-on" type="checkbox" checked={on} onChange={(e) => setEnabled(e.target.checked)} />
        Usar a aula bônus
      </label>
      <Field label={`Presenças ${v.kind("open_entry")} por aula bônus`} htmlFor="bonus-every" errors={issues.every}>
        <input id="bonus-every" inputMode="numeric" value={n} disabled={!on} onChange={(e) => setEvery(e.target.value)} />
      </Field>
      <p className="small muted">Conta a presença quando a aula é concluída. Corrigir uma presença depois não tira um bônus já ganho.</p>
      <FormError error={save.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={save.isPending || (enabled === null && every === null)}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
