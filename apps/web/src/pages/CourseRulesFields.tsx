import { MODALITIES, type CourseRulesInput, type CourseType, type FieldIssues, type Modality } from "../api.ts";
import { Field } from "../ui.tsx";

/** Estado do formulário: números como texto, para o campo poder ficar vazio enquanto a pessoa digita. */
export type RulesDraft = {
  capacity: string;
  lessonMinutes: string;
  packageLessons: string;
  cancelNoticeHours: string;
  lessonPrice: string;
  modalities: Modality[];
  autoAgenda: boolean;
};

const MODALITY_LABELS: Record<Modality, string> = { online: "Online", presencial: "Presencial" };

export function RulesFields({
  draft,
  onChange,
  issues,
  type,
}: {
  draft: RulesDraft;
  onChange: (next: RulesDraft) => void;
  issues: FieldIssues;
  type: CourseType;
}) {
  const set = (key: keyof RulesDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...draft, [key]: e.target.value });

  return (
    <div className="grid-fields">
      <Field
        label="Alunos por aula"
        htmlFor="capacity"
        errors={issues.capacity}
        hint={type === "particular" ? "Particular é sempre 1." : undefined}
      >
        <input
          id="capacity"
          inputMode="numeric"
          value={type === "particular" ? "1" : draft.capacity}
          disabled={type === "particular"}
          onChange={set("capacity")}
        />
      </Field>
      <Field label="Duração da aula (min)" htmlFor="lessonMinutes" errors={issues.lessonMinutes}>
        <input id="lessonMinutes" inputMode="numeric" value={draft.lessonMinutes} onChange={set("lessonMinutes")} />
      </Field>
      <Field label="Aulas no pacote" htmlFor="packageLessons" errors={issues.packageLessons}>
        <input id="packageLessons" inputMode="numeric" value={draft.packageLessons} onChange={set("packageLessons")} />
      </Field>
      <Field
        label="Cancelar com antecedência (h)"
        htmlFor="cancelNoticeHours"
        errors={issues.cancelNoticeHours}
        hint="Até quantas horas antes o aluno cancela sem perder a aula."
      >
        <input id="cancelNoticeHours" inputMode="numeric" value={draft.cancelNoticeHours} onChange={set("cancelNoticeHours")} />
      </Field>
      <Field label="Valor da aula (R$)" htmlFor="lessonPrice" errors={issues.lessonPriceCents}>
        <input id="lessonPrice" inputMode="decimal" value={draft.lessonPrice} onChange={set("lessonPrice")} />
      </Field>
      <fieldset className="field">
        <legend>Modalidades</legend>
        <div className="checks">
          {MODALITIES.map((m) => (
            <label key={m} className="check" htmlFor={`modality-${m}`}>
              <input
                id={`modality-${m}`}
                type="checkbox"
                checked={draft.modalities.includes(m)}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    modalities: e.target.checked ? [...draft.modalities, m] : draft.modalities.filter((x) => x !== m),
                  })
                }
              />
              {MODALITY_LABELS[m]}
            </label>
          ))}
        </div>
        {issues.modalities?.[0] && <small className="error">{issues.modalities[0]}</small>}
      </fieldset>
      <fieldset className="field">
        <legend>Quem marca a aula open-entry</legend>
        <label className="check" htmlFor="autoAgenda">
          <input
            id="autoAgenda"
            type="checkbox"
            checked={draft.autoAgenda}
            onChange={(e) => onChange({ ...draft, autoAgenda: e.target.checked })}
          />
          O próprio aluno reserva
        </label>
        <small>Desmarcado, só a secretaria marca. Vale só para turmas open-entry deste curso.</small>
      </fieldset>
    </div>
  );
}

export function draftFromRules(r: CourseRulesInput): RulesDraft {
  return {
    capacity: String(r.capacity),
    lessonMinutes: String(r.lessonMinutes),
    packageLessons: String(r.packageLessons),
    cancelNoticeHours: String(r.cancelNoticeHours),
    lessonPrice: (r.lessonPriceCents / 100).toFixed(2).replace(".", ","),
    modalities: r.modalities,
    autoAgenda: r.autoAgenda ?? true,
  };
}

/** Converte o rascunho no corpo da API. Texto que não é número vai como NaN e a API devolve a mensagem do campo. */
export function rulesFromDraft(d: RulesDraft, type: CourseType, parseReais: (s: string) => number | null): CourseRulesInput {
  const int = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
  return {
    capacity: type === "particular" ? 1 : int(d.capacity),
    lessonMinutes: int(d.lessonMinutes),
    packageLessons: int(d.packageLessons),
    cancelNoticeHours: int(d.cancelNoticeHours),
    lessonPriceCents: parseReais(d.lessonPrice) ?? Number.NaN,
    modalities: d.modalities,
    autoAgenda: d.autoAgenda,
  };
}
