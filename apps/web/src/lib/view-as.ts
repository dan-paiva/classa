import { useQuery } from "@tanstack/react-query";
import { AREA_LABELS, LEVEL_LABELS, type Area } from "@classa/domain";
import { request, type Membership, type ProfileType } from "../api.ts";

/**
 * "Ver como" das escolas de demonstração: o admin escolhe um perfil da escola e as
 * chamadas seguintes vão com o vínculo emprestado. O servidor só aceita em escola de
 * demonstração e de quem é admin de verdade nela; aqui é só a escolha do usuário.
 */
const KEY = "classa:view-as";
const memory: Record<string, string> = {};

function load(): Record<string, string> {
  try {
    return { ...JSON.parse(localStorage.getItem(KEY) ?? "{}"), ...memory };
  } catch {
    return memory;
  }
}

export function getViewAs(slug: string): string | null {
  return load()[slug] ?? null;
}

export function setViewAs(slug: string, membershipId: string | null) {
  const all = load();
  if (membershipId) all[slug] = membershipId;
  else delete all[slug];
  if (membershipId) memory[slug] = membershipId;
  else delete memory[slug];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // sem armazenamento: vale só nesta aba
  }
}

/** Cabeçalho para as rotas /t/:slug, quando há perfil emprestado nessa escola. */
export function viewAsHeader(path: string): Record<string, string> {
  const slug = /^\/t\/([^/]+)\//.exec(path)?.[1];
  const id = slug ? getViewAs(slug) : null;
  return id ? { "x-classa-view-as": id } : {};
}

export type DemoProfile = {
  id: string;
  name: string;
  email: string;
  isMe: boolean;
  profileType: ProfileType;
  level: number;
  areas: Record<string, "total" | "restrito">;
  permissions: Record<string, string[]>;
};

export function useDemoProfiles(slug: string) {
  return useQuery({
    queryKey: ["demo-profiles", slug],
    queryFn: () => request<{ demo: boolean; viewingAs: string | null; profiles: DemoProfile[] }>(`/t/${slug}/demo/profiles`),
    staleTime: 5 * 60_000,
    enabled: !!slug,
  });
}

const PROFILE_LABELS: Record<ProfileType, string> = { admin: "Administrador", colaborador: "Equipe", prestador: "Professor", aluno: "Aluno" };

export function profileLabel(p: Pick<DemoProfile, "profileType" | "level" | "areas">) {
  if (p.profileType !== "colaborador") return PROFILE_LABELS[p.profileType];
  const areas = Object.keys(p.areas).map((k) => AREA_LABELS[k as Area]);
  return `${LEVEL_LABELS[p.level as 1]} · ${areas.join(", ")}`;
}

/** O vínculo que vale na tela: o emprestado, quando o admin está vendo como outro perfil. */
export function effectiveMembership(m: Membership | undefined, profiles: DemoProfile[] | undefined): Membership | undefined {
  if (!m) return m;
  const id = getViewAs(m.slug);
  const p = id ? profiles?.find((x) => x.id === id && !x.isMe) : undefined;
  return p ? { ...m, profileType: p.profileType, level: p.level, areas: p.areas, permissions: p.permissions } : m;
}
