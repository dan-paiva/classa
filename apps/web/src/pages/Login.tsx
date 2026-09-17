import { useState, type FormEvent } from "react";
import { authClient } from "../auth-client.ts";

export function Login() {
  const [mode, setMode] = useState<"entrar" | "criar">("entrar");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setError(null);
    const res =
      mode === "entrar"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name")) });
    setBusy(false);
    if (res.error) setError(mode === "entrar" ? "E-mail ou senha incorretos." : (res.error.message ?? "Não foi possível criar a conta."));
  }

  return (
    <div className="auth">
      <div className="brand">Classa</div>
      <form onSubmit={onSubmit} className="panel stack">
        <h1>{mode === "entrar" ? "Entrar" : "Criar conta"}</h1>
        {mode === "criar" && (
          <div className="field">
            <label htmlFor="name">Seu nome</label>
            <input id="name" name="name" required autoComplete="name" />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete={mode === "entrar" ? "current-password" : "new-password"}
          />
          {mode === "criar" && <small>Mínimo de 10 caracteres.</small>}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Aguarde…" : mode === "entrar" ? "Entrar" : "Criar conta"}
        </button>
        <button type="button" className="btn-link" onClick={() => setMode(mode === "entrar" ? "criar" : "entrar")}>
          {mode === "entrar" ? "Ainda não tem conta? Criar conta" : "Já tem conta? Entrar"}
        </button>
      </form>
    </div>
  );
}
