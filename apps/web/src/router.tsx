import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { authClient } from "./auth-client.ts";
import { Agenda } from "./pages/Agenda.tsx";
import { ClassGroupDetail } from "./pages/ClassGroupDetail.tsx";
import { ClassGroups } from "./pages/ClassGroups.tsx";
import { CourseDetail } from "./pages/CourseDetail.tsx";
import { Courses } from "./pages/Courses.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Finance } from "./pages/Finance.tsx";
import { LessonDetail } from "./pages/LessonDetail.tsx";
import { Login } from "./pages/Login.tsx";
import { SchoolLayout } from "./pages/SchoolLayout.tsx";
import { Schools } from "./pages/Schools.tsx";
import { Settings } from "./pages/Settings.tsx";
import { StudentDetail, StudentForm, Students } from "./pages/Students.tsx";
import { TeacherDetail, TeacherForm, Teachers } from "./pages/Teachers.tsx";

function Root() {
  const session = authClient.useSession();
  if (session.isPending) return <div className="auth">Carregando…</div>;
  if (!session.data) return <Login />;
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: Root });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Schools });
const schoolRoute = createRoute({ getParentRoute: () => rootRoute, path: "/e/$slug", component: SchoolLayout });

const dashboardRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/", component: Dashboard });
const agendaRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/agenda", component: Agenda });
const lessonRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/aulas/$lessonId", component: LessonDetail });
const classGroupsRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/turmas", component: ClassGroups });
const classGroupRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/turmas/$classGroupId", component: ClassGroupDetail });
const studentsRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/alunos", component: Students });
const studentNewRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/alunos/novo", component: StudentForm });
const studentRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/alunos/$studentId", component: StudentDetail });
const teachersRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/professores", component: Teachers });
const teacherNewRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/professores/novo", component: TeacherForm });
const teacherRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/professores/$teacherId", component: TeacherDetail });
const coursesRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/cursos", component: Courses });
const courseRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/cursos/$courseId", component: CourseDetail });
const financeRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/financeiro", component: Finance });
const settingsRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/configuracoes", component: Settings });

const routeTree = rootRoute.addChildren([
  indexRoute,
  schoolRoute.addChildren([
    dashboardRoute,
    agendaRoute,
    lessonRoute,
    classGroupsRoute,
    classGroupRoute,
    studentsRoute,
    studentNewRoute,
    studentRoute,
    teachersRoute,
    teacherNewRoute,
    teacherRoute,
    coursesRoute,
    courseRoute,
    financeRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
