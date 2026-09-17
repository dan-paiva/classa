export type Role = "admin";
export type Membership = { tenantId: string; name: string; slug: string; role: Role };
export type Me = { user: { id: string; name: string; email: string }; memberships: Membership[] };
export type FieldIssues = Record<string, string[] | undefined>;

export const COURSE_TYPES = ["grupo", "particular", "hibrido", "workshop", "turmas_dedicadas"] as const;
export type CourseType = (typeof COURSE_TYPES)[number];
export const COURSE_TYPE_LABELS: Record<CourseType, string> = {
  grupo: "Em grupo",
  particular: "Particular",
  hibrido: "Híbrido",
  workshop: "Workshop",
  turmas_dedicadas: "Turmas dedicadas",
};
export const MODALITIES = ["online", "presencial"] as const;
export type Modality = (typeof MODALITIES)[number];
export const allowsModules = (type: CourseType) => type === "grupo" || type === "turmas_dedicadas";

export type CourseModule = {
  id: string;
  courseId: string;
  name: string;
  color: string;
  position: number;
  deactivatedAt: string | null;
};

export type Course = {
  id: string;
  name: string;
  type: CourseType;
  color: string;
  capacity: number;
  lessonMinutes: number;
  packageLessons: number;
  cancelNoticeHours: number;
  lessonPriceCents: number;
  modalities: Modality[];
  deactivatedAt: string | null;
  modules: CourseModule[];
};

export type CourseRulesInput = Pick<
  Course,
  "capacity" | "lessonMinutes" | "packageLessons" | "cancelNoticeHours" | "lessonPriceCents" | "modalities"
>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly issues: FieldIssues = {},
    message?: string,
  ) {
    super(message ?? `A API respondeu ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as { issues?: FieldIssues; message?: string };
  if (!res.ok) throw new ApiError(res.status, body.issues, body.message);
  return body as T;
}

const post = (body?: unknown): RequestInit => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

export const api = {
  me: () => request<Me>("/me"),
  createTenant: (input: { name: string; slug: string }) =>
    request<{ tenant: { id: string; name: string; slug: string } }>("/tenants", post(input)),

  courses: (slug: string) => request<{ courses: Course[] }>(`/t/${slug}/courses`),
  course: (slug: string, id: string) => request<{ course: Course }>(`/t/${slug}/courses/${id}`),
  createCourse: (slug: string, input: { name: string; type: CourseType } & Partial<CourseRulesInput>) =>
    request<{ course: Course }>(`/t/${slug}/courses`, post(input)),
  updateCourse: (slug: string, id: string, input: Partial<CourseRulesInput & { name: string; color: string }>) =>
    request<{ course: Course }>(`/t/${slug}/courses/${id}`, patch(input)),
  setCourseActive: (slug: string, id: string, active: boolean) =>
    request<{ course: Course }>(`/t/${slug}/courses/${id}/${active ? "reactivate" : "deactivate"}`, post()),

  createModule: (slug: string, courseId: string, input: { name: string }) =>
    request<{ module: CourseModule }>(`/t/${slug}/courses/${courseId}/modules`, post(input)),
  updateModule: (slug: string, courseId: string, id: string, input: { name?: string; color?: string }) =>
    request<{ module: CourseModule }>(`/t/${slug}/courses/${courseId}/modules/${id}`, patch(input)),
  setModuleActive: (slug: string, courseId: string, id: string, active: boolean) =>
    request<{ module: CourseModule }>(
      `/t/${slug}/courses/${courseId}/modules/${id}/${active ? "reactivate" : "deactivate"}`,
      post(),
    ),
};

export const issuesOf = (err: unknown): FieldIssues => (err instanceof ApiError ? err.issues : {});

export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "58,50" → 5850. Devolve null se não for um valor válido. */
export function parseReais(text: string): number | null {
  const clean = text.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (clean === "" || Number.isNaN(Number(clean))) return null;
  return Math.round(Number(clean) * 100);
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
