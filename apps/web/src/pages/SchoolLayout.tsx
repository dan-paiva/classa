import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { api, type Membership } from "../api.ts";
import { canDo } from "../lib/permissions.ts";
import { authClient } from "../auth-client.ts";

/** Cada item aparece só para quem tem a permissão de ver o recurso. */
const NAV = [
  { to: "/e/$slug", label: "Início", exact: true, resource: "painel" },
  { to: "/e/$slug/minha-area", label: "Minha área", resource: "minha-area" },
  { to: "/e/$slug/agenda", label: "Agenda", resource: "agenda" },
  { to: "/e/$slug/acoes", label: "Ações", resource: "fluxos" },
  { to: "/e/$slug/turmas", label: "Turmas", resource: "turmas" },
  { to: "/e/$slug/alunos", label: "Alunos", resource: "alunos" },
  { to: "/e/$slug/professores", label: "Professores", resource: "professores" },
  { to: "/e/$slug/leads", label: "Leads", resource: "leads" },
  { to: "/e/$slug/empresas", label: "Empresas", resource: "empresas" },
  { to: "/e/$slug/cursos", label: "Cursos", resource: "cursos" },
  { to: "/e/$slug/financeiro", label: "Financeiro", resource: "financeiro" },
  { to: "/e/$slug/folha", label: "Folha", resource: "folha" },
  { to: "/e/$slug/auditoria", label: "Auditoria", resource: "auditoria" },
  { to: "/e/$slug/configuracoes", label: "Configurações", resource: "configuracoes" },
] as const;

function visible(m: Membership, resource: string) {
  if (m.profileType === "admin") return resource !== "minha-area";
  if (m.profileType === "aluno") return resource === "minha-area";
  if (resource === "minha-area") return false;
  if (resource === "painel") return canDo(m, "financeiro");
  if (resource === "fluxos") return Object.entries(m.permissions).some(([k, v]) => k.startsWith("fluxo:") && v.includes("ver"));
  return canDo(m, resource);
}

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

  if (school.status === "bloqueado") {
    return (
      <div className="auth stack">
        <p>Seu acesso a {school.name} está bloqueado. Fale com a administração da escola.</p>
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
          {NAV.filter((item) => visible(school, item.resource)).map((item) => (
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
