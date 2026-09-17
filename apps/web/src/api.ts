export type Membership = { tenantId: string; name: string; slug: string; role: "admin" };
export type Me = { user: { id: string; name: string; email: string }; memberships: Membership[] };
export type FieldIssues = Record<string, string[] | undefined>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly issues: FieldIssues = {},
  ) {
    super(`API respondeu ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { issues?: FieldIssues }).issues);
  return body as T;
}

export const api = {
  me: () => request<Me>("/me"),
  createTenant: (input: { name: string; slug: string }) =>
    request<{ tenant: { id: string; name: string; slug: string } }>("/tenants", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
