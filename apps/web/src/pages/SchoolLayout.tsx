import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { api } from "../api.ts";
import { authClient } from "../auth-client.ts";

const SOON = ["Turmas", "Professores", "Alunos", "Matrículas"];

export function SchoolLayout() {
  const { slug } = useParams({ from: "/e/$slug" });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const queryClient = useQueryClient();
  const school = me.data?.memberships.find((m) => m.slug === slug);

  if (me.isPending) return <div className="auth">Carregando…</div>;
  if (!school) {
    return (
      <div className="auth stack">
        <p>Escola não encontrada ou você não tem acesso a ela.</p>
        <Link to="/" className="btn">
          Ver minhas escolas
        </Link>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand">
          Classa
        </Link>
        <div className="school-name">{school.name}</div>
        <nav aria-label="Menu da escola">
          <Link to="/e/$slug/cursos" params={{ slug }} className="nav-link" activeProps={{ className: "nav-link active" }}>
            Cursos
          </Link>
          {SOON.map((item) => (
            <span key={item} className="nav-link disabled" aria-disabled="true">
              {item} <em>em breve</em>
            </span>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span>{me.data?.user.name}</span>
          <button
            type="button"
            className="btn-link"
            onClick={async () => {
              await authClient.signOut();
              queryClient.clear();
            }}
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
