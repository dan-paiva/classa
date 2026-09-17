import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from "@tanstack/react-router";
import { authClient } from "./auth-client.ts";
import { CourseDetail } from "./pages/CourseDetail.tsx";
import { Courses } from "./pages/Courses.tsx";
import { Login } from "./pages/Login.tsx";
import { SchoolLayout } from "./pages/SchoolLayout.tsx";
import { Schools } from "./pages/Schools.tsx";

function Root() {
  const session = authClient.useSession();
  if (session.isPending) return <div className="auth">Carregando…</div>;
  if (!session.data) return <Login />;
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: Root });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Schools });

const schoolRoute = createRoute({ getParentRoute: () => rootRoute, path: "/e/$slug", component: SchoolLayout });

const schoolIndexRoute = createRoute({
  getParentRoute: () => schoolRoute,
  path: "/",
  component: function SchoolIndex() {
    const { slug } = schoolIndexRoute.useParams();
    return <Navigate to="/e/$slug/cursos" params={{ slug }} replace />;
  },
});

const coursesRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/cursos", component: Courses });

const courseRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/cursos/$courseId", component: CourseDetail });

const routeTree = rootRoute.addChildren([indexRoute, schoolRoute.addChildren([schoolIndexRoute, coursesRoute, courseRoute])]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
