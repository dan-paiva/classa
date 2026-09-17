import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { api, type Membership } from "../api.ts";

/** Perfil do usuário na escola aberta. O servidor decide; a tela só esconde o que não pode. */
export function useMembership(): Membership | undefined {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  return me.data?.memberships.find((m) => m.slug === slug);
}

export function canDo(m: Membership | undefined, resource: string, action = "ver") {
  return !!m && (m.profileType === "admin" || (m.permissions[resource] ?? []).includes(action));
}

export function useCan(resource: string, action = "ver") {
  return canDo(useMembership(), resource, action);
}
