import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "./api.ts";
import { authClient } from "./auth-client.ts";

export function App() {
  const session = authClient.useSession();

  if (session.isPending) return <Shell>Carregando…</Shell>;
  if (!session.data) return <Shell><LoginForm /></Shell>;
  return <Shell><Home /></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="brand">Classa</header>
      <main className="panel">{children}</main>
    </div>
  );
}

function LoginForm() {
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
    if (res.error) setError(res.error.message ?? "Não foi possível entrar. Confira e-mail e senha.");
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <h1>{mode === "entrar" ? "Entrar" : "Criar conta"}</h1>
      {mode === "criar" && (
        <label>
          Nome
          <input id="name" name="name" required autoComplete="name" />
        </label>
      )}
      <label>
        E-mail
        <input id="email" name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Senha
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete={mode === "entrar" ? "current-password" : "new-password"}
        />
        {mode === "criar" && <small>Mínimo de 10 caracteres.</small>}
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Aguarde…" : mode === "entrar" ? "Entrar" : "Criar conta"}
      </button>
      <button type="button" className="link" onClick={() => setMode(mode === "entrar" ? "criar" : "entrar")}>
        {mode === "entrar" ? "Ainda não tem conta? Criar conta" : "Já tem conta? Entrar"}
      </button>
    </form>
  );
}

function Home() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const queryClient = useQueryClient();

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
  }

  if (me.isPending) return <p>Carregando…</p>;
  if (me.isError) return <p className="error">Não foi possível carregar seus dados.</p>;

  const { user, memberships } = me.data;
  return (
    <div className="stack">
      <div className="row">
        <span>
          {user.name} · {user.email}
        </span>
        <button type="button" className="link" onClick={signOut}>
          Sair
        </button>
      </div>
      {memberships.length === 0 ? (
        <CreateTenantForm />
      ) : (
        <>
          <h1>Suas escolas</h1>
          <ul className="list">
            {memberships.map((m) => (
              <li key={m.tenantId}>
                <strong>{m.name}</strong>
                <span>/{m.slug} · administrador</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function CreateTenantForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const create = useMutation({
    mutationFn: api.createTenant,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
  const issues = create.error instanceof ApiError ? create.error.issues : {};

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ name, slug });
      }}
    >
      <h1>Criar sua escola</h1>
      <p>Você será o administrador. Depois dá para convidar coordenação, professores e equipe.</p>
      <label>
        Nome da escola
        <input
          id="tenant-name"
          value={name}
          required
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
        {issues.name && <small className="error">{issues.name[0]}</small>}
      </label>
      <label>
        Endereço
        <input
          id="tenant-slug"
          value={slug}
          required
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
        {issues.slug ? <small className="error">{issues.slug[0]}</small> : <small>Letras minúsculas, números e hífen.</small>}
      </label>
      {create.isError && !(create.error instanceof ApiError && create.error.status < 500) && (
        <p className="error" role="alert">Não foi possível criar a escola. Tente de novo.</p>
      )}
      <button type="submit" disabled={create.isPending}>
        {create.isPending ? "Criando…" : "Criar escola"}
      </button>
    </form>
  );
}
