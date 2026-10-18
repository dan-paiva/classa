import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  GraduationCap,
  LayoutGrid,
  LogOut,
  Magnet,
  Package,
  Presentation,
  ReceiptText,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
  Video,
  Workflow,
} from "lucide-react";
import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { api, type Membership } from "../api.ts";
import { canDo } from "../lib/permissions.ts";
import { authClient } from "../auth-client.ts";
import { ThemeLogo, useThemeAssets } from "../lib/theme.tsx";
import { useSchoolSettings, useVocab } from "../lib/vocabulary.ts";
import { effectiveMembership, getViewAs, profileLabel, setViewAs, useDemoProfiles, type DemoProfile } from "../lib/view-as.ts";

/** Cada item aparece só para quem tem a permissão de ver o recurso. */
const NAV = [
  { to: "/e/$slug", label: "Início", exact: true, resource: "painel", icon: LayoutGrid },
  { to: "/e/$slug/minha-area", label: "Minha área", resource: "minha-area", icon: UserRound },
  { to: "/e/$slug/agenda", label: "Agenda", resource: "agenda", icon: CalendarDays },
  { to: "/e/$slug/acoes", label: "Ações", resource: "fluxos", icon: Workflow },
  { to: "/e/$slug/turmas", label: "Turmas", resource: "turmas", icon: Users },
  { to: "/e/$slug/vagas", label: "Vagas", resource: "agenda", icon: CalendarClock },
  { to: "/e/$slug/contas-zoom", label: "Contas Zoom", resource: "videoconferencia", icon: Video },
  { to: "/e/$slug/alunos", label: "Alunos", resource: "alunos", icon: GraduationCap },
  { to: "/e/$slug/professores", label: "Professores", resource: "professores", icon: Presentation },
  { to: "/e/$slug/leads", label: "Leads", resource: "leads", icon: Magnet },
  { to: "/e/$slug/empresas", label: "Empresas", resource: "empresas", icon: Building2 },
  { to: "/e/$slug/cursos", label: "Cursos", resource: "cursos", icon: BookOpen },
  { to: "/e/$slug/materiais", label: "Materiais", resource: "materiais", icon: Package },
  { to: "/e/$slug/financeiro", label: "Financeiro", resource: "financeiro", icon: Wallet },
  { to: "/e/$slug/folha", label: "Folha", resource: "folha", icon: ReceiptText },
  { to: "/e/$slug/relatorios", label: "Relatórios", resource: "relatorios", icon: ChartColumn },
  { to: "/e/$slug/auditoria", label: "Auditoria", resource: "auditoria", icon: ShieldCheck },
  { to: "/e/$slug/configuracoes", label: "Configurações", resource: "configuracoes", icon: Settings },
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
  const demo = useDemoProfiles(slug);
  // numa escola de demonstração o admin pode estar vendo como outro perfil
  const school = effectiveMembership(
    me.data?.memberships.find((m) => m.slug === slug),
    demo.data?.profiles,
  );
  const v = useVocab();
  // escola com identidade própria (settings.theme): cores, fonte e logo dela
  const theme = useSchoolSettings().data?.theme ?? null;
  useThemeAssets(theme);
  // turmas e cursos aparecem com o nome que a escola usa (DOMINIO.md §4.6)
  const label = (item: (typeof NAV)[number]) =>
    item.resource === "turmas" ? v.classGroup.plural : item.resource === "cursos" ? v.course.plural : item.label;

  const signOut = async () => {
    await authClient.signOut();
    queryClient.clear();
  };

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
    <div className="app" data-theme={theme ?? undefined}>
      <aside className="sidebar">
        <Link to="/" className="brand">
          {theme ? <ThemeLogo theme={theme} title={school.name} /> : "Classa"}
        </Link>
        <div className="school-name">{school.name}</div>
        {demo.data?.demo && <ViewAsPicker slug={slug} profiles={demo.data.profiles} />}
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
              <item.icon size={18} strokeWidth={1.8} aria-hidden />
              {label(item)}
            </Link>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="avatar" aria-hidden>
            {initials(me.data?.user.name ?? "")}
          </span>
          <span className="sidebar-user-name">
            <strong>{me.data?.user.name}</strong>
            <small>{profileLabel(school)}</small>
          </span>
          <button type="button" className="icon-btn" aria-label="Sair" title="Sair" onClick={signOut}>
            <LogOut size={18} aria-hidden />
          </button>
        </div>
      </aside>
      <main className="content">
        {demo.data?.demo && getViewAs(slug) && <ViewingBanner slug={slug} profiles={demo.data.profiles} />}
        <Outlet />
      </main>
    </div>
  );
}

/** Troca o perfil emprestado e recarrega tudo da escola com ele, a partir do início. */
function useSwitchProfile(slug: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (id: string | null) => {
    setViewAs(slug, id);
    // o que estava em cache foi lido com o outro perfil
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "demo-profiles" });
    void queryClient.invalidateQueries({ queryKey: ["demo-profiles", slug] });
    void navigate({ to: "/e/$slug", params: { slug } });
  };
}

/** "Ver como": só aparece para o admin de uma escola de demonstração. */
function ViewAsPicker({ slug, profiles }: { slug: string; profiles: DemoProfile[] }) {
  const switchTo = useSwitchProfile(slug);
  const current = getViewAs(slug) ?? profiles.find((p) => p.isMe)?.id ?? "";
  return (
    <label className="view-as" htmlFor="view-as">
      <span>Ver como</span>
      <select id="view-as" value={current} onChange={(e) => switchTo(profiles.find((p) => p.id === e.target.value)?.isMe ? null : e.target.value)}>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.isMe ? `Você (${profileLabel(p)})` : `${profileLabel(p)} · ${p.name} (${p.email.split("@")[0]})`}
          </option>
        ))}
      </select>
    </label>
  );
}

function ViewingBanner({ slug, profiles }: { slug: string; profiles: DemoProfile[] }) {
  const switchTo = useSwitchProfile(slug);
  const p = profiles.find((x) => x.id === getViewAs(slug));
  if (!p || p.isMe) return null;
  return (
    <div className="view-as-banner" role="status">
      <span>
        Vendo como <strong>{p.name}</strong> · {profileLabel(p)}. As telas e as permissões são as desse perfil; o que você fizer fica no seu nome.
      </span>
      <button type="button" className="btn-link" onClick={() => switchTo(null)}>
        Voltar para o seu perfil
      </button>
    </div>
  );
}

/** "Ana Barros Brandão" → "AB", para o avatar do menu com tema. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}
