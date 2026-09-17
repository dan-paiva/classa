import type { ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  hint,
  errors,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  errors?: string[];
  children: ReactNode;
}) {
  const error = errors?.[0];
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <small className="error" role="alert">
          {error}
        </small>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </div>
  );
}

export function StatusBadge({ inactive }: { inactive: boolean }) {
  return <span className={`badge ${inactive ? "badge-off" : "badge-on"}`}>{inactive ? "Inativo" : "Ativo"}</span>;
}

export function ColorDot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} aria-hidden="true" />;
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const status = (error as { status?: number }).status;
  if (status === 400 || status === 409) return null; // já aparece no campo
  const message = (error as Error).message;
  return (
    <p className="error" role="alert">
      {status === 422 ? message : "Não foi possível salvar. Tente de novo."}
    </p>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "muted";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ""}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Loading() {
  return <p className="muted">Carregando…</p>;
}

export function LoadError({ error }: { error: unknown }) {
  return (
    <p className="error" role="alert">
      {(error as Error)?.message || "Não foi possível carregar."}
    </p>
  );
}

/** Mensagem de erro da API para ações sem formulário (botões). */
export function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {(error as Error).message || "Não foi possível concluir a ação."}
    </p>
  );
}
