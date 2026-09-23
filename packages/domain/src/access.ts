/**
 * Acesso (DOMINIO.md §8): tipo de perfil + nível (o que pode fazer) + áreas (onde).
 * O servidor decide; a tela só usa o resultado para esconder o que não pode.
 */

export const PROFILE_TYPES = ["admin", "colaborador", "prestador", "aluno"] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

export const AREAS = ["adm", "com", "ped", "aca", "cx", "fin", "mkt"] as const;
export type Area = (typeof AREAS)[number];
export const AREA_LABELS: Record<Area, string> = {
  adm: "Administrativo",
  com: "Comercial",
  ped: "Pedagógico",
  aca: "Acadêmico",
  cx: "CX",
  fin: "Financeiro/Fiscal",
  mkt: "Marketing",
};

export const LEVELS = [1, 2, 3, 4, 5] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABELS: Record<Level, string> = { 1: "Administrador", 2: "Gestor", 3: "Editor", 4: "Colaborador", 5: "Visualizador" };

/** total: vê e age conforme o nível; restrito: só vê. */
export type AreaAccess = "total" | "restrito";
export type AccessProfile = { profileType: ProfileType; level: number; areas: Partial<Record<Area, AreaAccess>> };

/**
 * Ações, da mais leve para a mais pesada, com o nível máximo que pode executá-las:
 * - ver: qualquer nível;
 * - operar: registrar o dia a dia (presença, mover cartão, pagamento) — até Colaborador;
 * - editar: criar e alterar cadastros — até Editor;
 * - inativar: inativar, encerrar, cancelar — até Gestor;
 * - administrar: usuários, configurações, reabrir folha — só Administrador.
 */
export const ACTIONS = ["ver", "operar", "editar", "inativar", "administrar"] as const;
export type Action = (typeof ACTIONS)[number];
const MAX_LEVEL: Record<Action, number> = { ver: 5, operar: 4, editar: 3, inativar: 2, administrar: 1 };

export const RESOURCES = [
  "agenda",
  "eventos",
  "cursos",
  "materiais",
  "turmas",
  "alunos",
  "professores",
  "financeiro",
  "folha",
  "empresas",
  "leads",
  "fluxo:ped",
  "fluxo:aca",
  "fluxo:adm",
  "fluxo:fin",
  "fluxo:com",
  "fluxo:cx",
  "fluxo:mkt",
  "relatorios",
  "configuracoes",
  "usuarios",
  "auditoria",
] as const;
export type Resource = (typeof RESOURCES)[number];

/** Áreas que permitem ver cada recurso. Recursos sem área são só do tipo Admin. */
export const RESOURCE_AREAS: Record<Resource, readonly Area[]> = {
  agenda: AREAS,
  // reunião, evento e nivelamento: qualquer área cria (DOMINIO.md §5.8)
  eventos: AREAS,
  cursos: ["ped", "aca", "com", "cx", "mkt", "adm"],
  // o acadêmico cuida; o CX entrega; pedagógico e comercial consultam
  materiais: ["aca", "ped", "cx", "com", "adm"],
  turmas: ["ped", "aca", "adm", "com", "cx"],
  alunos: ["aca", "adm", "com", "cx", "fin", "mkt"],
  professores: ["ped", "aca", "adm", "fin"],
  financeiro: ["fin", "adm"],
  folha: ["fin", "ped", "adm"],
  empresas: ["com", "fin"],
  leads: ["com", "mkt"],
  "fluxo:ped": ["ped"],
  "fluxo:aca": ["aca"],
  "fluxo:adm": ["adm"],
  "fluxo:fin": ["fin"],
  "fluxo:com": ["com"],
  "fluxo:cx": ["cx"],
  "fluxo:mkt": ["mkt"],
  relatorios: AREAS,
  configuracoes: [],
  usuarios: [],
  auditoria: [],
};

/** Áreas que permitem agir (operar, editar, inativar); quando não listado, as mesmas de ver. */
export const RESOURCE_ACT_AREAS: Partial<Record<Resource, readonly Area[]>> = {
  relatorios: [], // relatório é só leitura
  agenda: ["ped", "aca"],
  cursos: ["ped", "aca"],
  materiais: ["aca"],
  turmas: ["ped", "aca"],
  alunos: ["aca", "com", "cx", "adm"],
  professores: ["ped", "adm"],
  financeiro: ["fin"],
  folha: ["fin"],
  empresas: ["com", "fin"],
};

export function can(p: AccessProfile, resource: Resource, action: Action): boolean {
  if (p.profileType === "admin") return true;
  if (p.profileType === "aluno") return false;
  if (p.profileType === "prestador") {
    // professor: só a própria agenda (o escopo "próprias aulas" é conferido no servidor)
    return resource === "agenda" && (action === "ver" || action === "operar");
  }
  if (p.level > MAX_LEVEL[action]) return false;
  const areas = RESOURCE_AREAS[resource];
  if (areas.length === 0) return false; // configurações, usuários e auditoria: só o tipo Admin
  if (action === "ver") return areas.some((a) => !!p.areas[a]);
  return (RESOURCE_ACT_AREAS[resource] ?? areas).some((a) => p.areas[a] === "total");
}

/** Tudo que o perfil pode ver e fazer, para a tela montar o menu. */
export function permissionMap(p: AccessProfile): Record<Resource, Action[]> {
  return Object.fromEntries(RESOURCES.map((r) => [r, ACTIONS.filter((a) => can(p, r, a))])) as Record<Resource, Action[]>;
}

/** Área de cada fluxo em kanban. */
export const FLOW_AREA: Record<string, Area> = {
  entrada: "com", // área de cada etapa em FLOWS.entrada; esta é só a porta de entrada
  substituicao: "ped",
  nivel: "aca",
  reposicao: "aca",
  admissao: "adm",
  cobranca: "fin",
  renovacao: "com",
  retencao: "cx",
  campanha: "mkt",
};

/** Cargos com nível e áreas sugeridos (matriz do protótipo). O cadastro pode ajustar. */
export const ROLE_PRESETS: { key: string; label: string; profile: AccessProfile }[] = [
  { key: "diretoria", label: "Diretoria", profile: { profileType: "admin", level: 1, areas: {} } },
  { key: "coord_ped", label: "Coordenação pedagógica", profile: { profileType: "colaborador", level: 2, areas: { ped: "total", aca: "restrito" } } },
  { key: "supervisor_aca", label: "Supervisão acadêmica", profile: { profileType: "colaborador", level: 2, areas: { aca: "total", ped: "restrito" } } },
  { key: "plantao_ped", label: "Plantão pedagógico", profile: { profileType: "colaborador", level: 4, areas: { ped: "total", aca: "restrito" } } },
  { key: "consultor", label: "Consultor de vendas", profile: { profileType: "colaborador", level: 4, areas: { com: "total" } } },
  { key: "gerente_com", label: "Gerência comercial", profile: { profileType: "colaborador", level: 2, areas: { com: "total", aca: "restrito" } } },
  { key: "financeiro", label: "Financeiro", profile: { profileType: "colaborador", level: 3, areas: { fin: "total", aca: "restrito" } } },
  { key: "atendimento", label: "Relacionamento (CX)", profile: { profileType: "colaborador", level: 4, areas: { cx: "total", aca: "restrito" } } },
  { key: "marketing", label: "Marketing", profile: { profileType: "colaborador", level: 3, areas: { mkt: "total" } } },
  { key: "administrativo", label: "Auxiliar administrativo", profile: { profileType: "colaborador", level: 4, areas: { adm: "total", cx: "restrito" } } },
  { key: "professor", label: "Professor", profile: { profileType: "prestador", level: 4, areas: {} } },
  { key: "aluno", label: "Aluno", profile: { profileType: "aluno", level: 5, areas: {} } },
];
