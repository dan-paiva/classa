import { createRootRoute, createRoute, createRouter, Outlet, useRouterState } from "@tanstack/react-router";
import { authClient } from "./auth-client.ts";
import { Agenda } from "./pages/Agenda.tsx";
import { Audit } from "./pages/Audit.tsx";
import { ClassGroupDetail } from "./pages/ClassGroupDetail.tsx";
import { ClassGroups } from "./pages/ClassGroups.tsx";
import { Companies, CompanyDetail } from "./pages/Companies.tsx";
import { CourseDetail } from "./pages/CourseDetail.tsx";
import { Courses } from "./pages/Courses.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Finance } from "./pages/Finance.tsx";
import { Flows } from "./pages/Flows.tsx";
import { Invitation } from "./pages/Invitation.tsx";
import { Leads } from "./pages/Leads.tsx";
import { MyArea } from "./pages/MyArea.tsx";
import { LessonDetail } from "./pages/LessonDetail.tsx";
import { Login } from "./pages/Login.tsx";
import { Payroll } from "./pages/Payroll.tsx";
import { SchoolLayout } from "./pages/SchoolLayout.tsx";
import { Schools } from "./pages/Schools.tsx";
import { Settings } from "./pages/Settings.tsx";
import { StudentDetail, StudentForm, Students } from "./pages/Students.tsx";
import { TeacherDetail, TeacherForm, Teachers } from "./pages/Teachers.tsx";

function Root() {
  const session = authClient.useSession();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path.startsWith("/convite/")) return <Outlet />; // o aceite de convite funciona sem estar logado
  if (session.isPending) return <div className="auth">Carregando…</div>;
  if (!session.data) return <Login />;
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: Root });
const invitationRoute = createRoute({ getParentRoute: () => rootRoute, path: "/convite/$token", component: Invitation });
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
const payrollRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/folha", component: Payroll });
const companiesRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/empresas", component: Companies });
const companyRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/empresas/$companyId", component: CompanyDetail });
const leadsRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/leads", component: Leads });
const flowsRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/acoes", component: Flows });
const myAreaRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/minha-area", component: MyArea });
const auditRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/auditoria", component: Audit });
const settingsRoute = createRoute({ getParentRoute: () => schoolRoute, path: "/configuracoes", component: Settings });

const routeTree = rootRoute.addChildren([
  indexRoute,
  invitationRoute,
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
    payrollRoute,
    auditRoute,
    myAreaRoute,
    leadsRoute,
    flowsRoute,
    companiesRoute,
    companyRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
