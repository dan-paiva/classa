import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { api } from "../api.ts";
import { authClient } from "../auth-client.ts";

const NAV = [
  { to: "/e/$slug", label: "Início", exact: true },
  { to: "/e/$slug/agenda", label: "Agenda" },
  { to: "/e/$slug/turmas", label: "Turmas" },
  { to: "/e/$slug/alunos", label: "Alunos" },
  { to: "/e/$slug/professores", label: "Professores" },
  { to: "/e/$slug/empresas", label: "Empresas" },
  { to: "/e/$slug/cursos", label: "Cursos" },
  { to: "/e/$slug/financeiro", label: "Financeiro" },
  { to: "/e/$slug/folha", label: "Folha" },
  { to: "/e/$slug/configuracoes", label: "Configurações" },
] as const;

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
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              params={{ slug }}
              className="nav-link"
              activeOptions={{ exact: "exact" in item }}
              activeProps={{ className: "nav-link active" }}
            >
              {item.label}
            </Link>
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
