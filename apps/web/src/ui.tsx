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
