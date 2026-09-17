import {
  INSTALLMENT_STATUS_LABELS,
  LESSON_STATE_LABELS,
  STUDENT_STATUS_LABELS,
  type InstallmentStatus,
  type Lesson,
  type LessonState,
  type StudentStatus,
} from "./api-school.ts";
import { Badge, type Tone } from "./ui.tsx";

const LESSON_TONE: Record<LessonState, Tone> = {
  agendada: "info",
  em_andamento: "info",
  concluida: "ok",
  nao_finalizada: "warn",
  cancelada: "muted",
};

export function LessonStateBadge({ lesson }: { lesson: Pick<Lesson, "state" | "flags"> }) {
  return (
    <span className="badges">
      <Badge tone={LESSON_TONE[lesson.state]}>{LESSON_STATE_LABELS[lesson.state]}</Badge>
      {lesson.flags.semProfessor && <Badge tone="danger">Sem professor</Badge>}
      {lesson.flags.semAlunos && <Badge tone="warn">Sem alunos</Badge>}
      {lesson.flags.substituida && lesson.state !== "cancelada" && <Badge tone="neutral">Substituição</Badge>}
    </span>
  );
}

const STUDENT_TONE: Record<StudentStatus, Tone> = {
  ativo: "ok",
  suspenso: "warn",
  congelado: "warn",
  inadimplente: "danger",
  cancelado: "danger",
  inativo: "muted",
};

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  return <Badge tone={STUDENT_TONE[status]}>{STUDENT_STATUS_LABELS[status]}</Badge>;
}

const INSTALLMENT_TONE: Record<InstallmentStatus, Tone> = { a_vencer: "info", vencida: "danger", paga: "ok", cancelada: "muted" };

export function InstallmentBadge({ status, daysLate }: { status: InstallmentStatus; daysLate?: number }) {
  return (
    <Badge tone={INSTALLMENT_TONE[status]}>
      {INSTALLMENT_STATUS_LABELS[status]}
      {status === "vencida" && daysLate ? ` · ${daysLate} d` : ""}
    </Badge>
  );
}

/** Barra de uso do pacote: âmbar a partir de 80%, vermelho a partir de 95%. */
export function UsageBar({ used, granted }: { used: number; granted: number }) {
  const pct = granted > 0 ? Math.min(100, Math.round((used / granted) * 100)) : 0;
  const tone = pct >= 95 ? "danger" : pct >= 80 ? "warn" : "ok";
  return (
    <span className="usage" title={`${used} de ${granted} aulas usadas`}>
      <span className={`usage-track usage-${tone}`}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="usage-label">{pct}%</span>
    </span>
  );
}
