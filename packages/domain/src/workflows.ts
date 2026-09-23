/**
 * Fluxos em kanban. Cada etapa diz o que precisa estar preenchido para entrar nela.
 * Os efeitos (trocar professor, aplicar mudança de nível…) ficam na API; aqui só as regras de movimento.
 */

import { FLOW_AREA, type Area } from "./access.ts";

/**
 * `area` é da etapa, não do fluxo (DOMINIO.md §7.5): sem ela, vale a área do fluxo.
 * Fluxo de área única é o caso em que nenhuma etapa diz a sua.
 */
export type Stage = { key: string; label: string; description: string; requires?: string[]; final?: boolean; alternative?: boolean; area?: Area };
export type FlowField = {
  key: string;
  label: string;
  kind: "text" | "textarea" | "number" | "date" | "datetime" | "select" | "money";
  required?: boolean;
  hint?: string;
};
export type FlowDefinition = { key: FlowKey; title: string; singular: string; description: string; area: string; stages: Stage[]; fields: FlowField[] };

export const FLOW_KEYS = ["entrada", "substituicao", "nivel", "reposicao", "admissao", "cobranca", "renovacao", "retencao", "campanha"] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];

export const FLOWS: Record<FlowKey, FlowDefinition> = {
  entrada: {
    key: "entrada",
    title: "Entrada do aluno",
    singular: "entrada",
    description: "Do primeiro contato à matrícula, passando pelo nivelamento. Atravessa Comercial, Pedagógico e Administrativo.",
    area: "Comercial, Pedagógico e Administrativo",
    stages: [
      { key: "dados", label: "Dados", description: "O comercial colhe CPF, e-mail, curso, disponibilidade e pacote.", area: "com", requires: ["cpf", "email", "courseId", "availability", "packageLessons"] },
      { key: "a_marcar", label: "Nivelamento a marcar", description: "O pedagógico acha data e avaliador dentro da disponibilidade declarada.", area: "ped" },
      { key: "marcado", label: "Nivelamento marcado", description: "O nivelamento entra na agenda, com o lead como avaliado.", area: "ped", requires: ["levelingStartsAt", "evaluatorPersonId"] },
      { key: "comunicada", label: "Data comunicada", description: "O comercial avisou o lead da data.", area: "com" },
      { key: "nivelado", label: "Nivelado", description: "O resultado vai para o nivelamento.", area: "ped", requires: ["suggestedModuleId"] },
      { key: "matricula", label: "Matrícula", description: "O lead vira aluno e a matrícula abre no regime escolhido.", area: "adm", requires: ["regime", "packageLessons"] },
      { key: "concluida", label: "Concluída", description: "Aluno matriculado.", area: "adm", final: true },
      { key: "perdido", label: "Perdido", description: "O lead sai do funil; a pessoa fica.", area: "com", requires: ["lostReason"], final: true, alternative: true },
    ],
    fields: [
      { key: "leadId", label: "Lead", kind: "select", required: true },
      { key: "cpf", label: "CPF", kind: "text" },
      { key: "email", label: "E-mail", kind: "text" },
      { key: "courseId", label: "Curso de interesse", kind: "select" },
      { key: "availability", label: "Disponibilidade", kind: "text", hint: "Ex.: seg e qua depois das 18h" },
      { key: "packageLessons", label: "Aulas no pacote", kind: "number" },
      { key: "nextPossibleOn", label: "Próxima data possível", kind: "date", hint: "Sem vaga na semana pedida: anote quando dá" },
      { key: "levelingStartsAt", label: "Data e hora do nivelamento", kind: "datetime" },
      { key: "evaluatorPersonId", label: "Avaliador", kind: "select" },
      { key: "levelingLocation", label: "Local ou link", kind: "text" },
      { key: "suggestedModuleId", label: "Módulo sugerido", kind: "select" },
      { key: "levelingNotes", label: "Observação do nivelamento", kind: "textarea" },
      { key: "regime", label: "Regime", kind: "select" },
      { key: "classGroupId", label: "Turma", kind: "select", hint: "Só no regime regular" },
      { key: "lostReason", label: "Motivo da perda", kind: "select" },
      { key: "notes", label: "Observações", kind: "textarea" },
    ],
  },
  substituicao: {
    key: "substituicao",
    title: "Substituição de professor",
    singular: "substituição",
    description: "O professor avisa que não pode dar a aula; a coordenação acha quem dá.",
    area: "Pedagógico",
    stages: [
      { key: "pedido", label: "Pedido", description: "O professor avisou que não pode dar a aula." },
      { key: "buscando", label: "Buscando substituto", description: "A coordenação procura quem pode assumir." },
      { key: "confirmado", label: "Confirmado", description: "O substituto assume a aula na agenda.", requires: ["substituteId"] },
      { key: "concluido", label: "Concluído", description: "A aula aconteceu com o substituto.", final: true },
      { key: "cancelado", label: "Cancelado", description: "O professor original deu a aula ou a substituição não é mais necessária.", final: true, alternative: true },
    ],
    fields: [
      { key: "lessonId", label: "Aula", kind: "select", required: true },
      { key: "reason", label: "Motivo", kind: "select", required: true },
      { key: "substituteId", label: "Substituto", kind: "select" },
      { key: "notes", label: "Observações", kind: "textarea" },
    ],
  },
  nivel: {
    key: "nivel",
    title: "Mudança de nível",
    singular: "mudança de nível",
    description: "O aluno troca de módulo depois do teste de nível.",
    area: "Acadêmico",
    stages: [
      { key: "solicitada", label: "Solicitada", description: "Pedido do aluno, do professor ou da coordenação." },
      { key: "teste", label: "Teste de nível", description: "O aluno faz o teste." },
      { key: "aprovada", label: "Aprovada", description: "Resultado e nova turma definidos.", requires: ["result", "targetClassGroupId"] },
      { key: "aplicada", label: "Aplicada", description: "O aluno passa para a nova turma.", final: true },
      { key: "mantida", label: "Mantida", description: "O aluno continua no nível atual.", final: true, alternative: true },
    ],
    fields: [
      { key: "enrollmentId", label: "Matrícula", kind: "select", required: true },
      { key: "result", label: "Resultado do teste", kind: "text" },
      { key: "targetClassGroupId", label: "Nova turma", kind: "select" },
      { key: "notes", label: "Observações", kind: "textarea" },
    ],
  },
  reposicao: {
    key: "reposicao",
    title: "Reposição de aula",
    singular: "reposição",
    description: "O aluno faltou com justificativa e repõe em outra aula do mesmo curso.",
    area: "Acadêmico",
    stages: [
      { key: "pedido", label: "Pedido", description: "O aluno pediu a reposição de uma aula que perdeu." },
      { key: "agendada", label: "Agendada", description: "O aluno é inscrito na aula de reposição e recebe a aula de volta.", requires: ["targetLessonId"] },
      { key: "realizada", label: "Realizada", description: "A reposição aconteceu.", final: true },
      { key: "negada", label: "Negada", description: "Fora da política de reposição.", final: true, alternative: true },
    ],
    fields: [
      { key: "missedLessonStudentId", label: "Falta a repor", kind: "select", required: true },
      { key: "targetLessonId", label: "Aula de reposição", kind: "select" },
      { key: "notes", label: "Justificativa", kind: "textarea" },
    ],
  },
  admissao: {
    key: "admissao",
    title: "Admissão de professor",
    singular: "candidato",
    description: "Do currículo recebido ao professor ativo na escola.",
    area: "Administrativo",
    stages: [
      { key: "candidato", label: "Candidato", description: "Currículo recebido." },
      { key: "entrevista", label: "Entrevista e aula teste", description: "Avaliação do candidato." },
      { key: "documentacao", label: "Documentação", description: "Contrato de prestação de serviço, dados bancários e documentos.", requires: ["email", "courseIds"] },
      { key: "ativo", label: "Ativo", description: "O professor é cadastrado na escola.", final: true },
      { key: "nao_seguiu", label: "Não seguiu", description: "Reprovado ou desistiu.", final: true, alternative: true },
    ],
    fields: [
      { key: "name", label: "Nome", kind: "text", required: true },
      { key: "email", label: "E-mail", kind: "text" },
      { key: "phone", label: "Telefone", kind: "text" },
      { key: "courseIds", label: "Cursos que pode dar", kind: "select" },
      { key: "hourlyRateCents", label: "Valor hora", kind: "money" },
      { key: "notes", label: "Observações", kind: "textarea" },
    ],
  },
  cobranca: {
    key: "cobranca",
    title: "Cobrança",
    singular: "cobrança",
    description: "Parcelas vencidas até o acordo ou a baixa.",
    area: "Financeiro",
    stages: [
      { key: "aberto", label: "Em aberto", description: "Parcela vencida e ainda sem contato." },
      { key: "contato", label: "Contato feito", description: "E-mail, mensagem ou telefone." },
      { key: "negociacao", label: "Negociação", description: "Acordo proposto ao aluno.", requires: ["agreement"] },
      { key: "pago", label: "Pago", description: "As parcelas do acordo são baixadas.", final: true },
      { key: "sem_acordo", label: "Sem acordo", description: "Encaminhado para cobrança externa.", final: true, alternative: true },
    ],
    fields: [
      { key: "studentId", label: "Aluno", kind: "select", required: true },
      { key: "agreement", label: "Acordo", kind: "text", hint: "Ex.: 2x sem juros a partir de 10/10" },
      { key: "method", label: "Forma de pagamento", kind: "select" },
      { key: "notes", label: "Observações", kind: "textarea" },
    ],
  },
  renovacao: {
    key: "renovacao",
    title: "Renovação de contrato",
    singular: "renovação",
    description: "Contratos que vencem em até 60 dias.",
    area: "Comercial",
    stages: [
      { key: "vencendo", label: "Vence em breve", description: "Contrato vence em até 60 dias." },
      { key: "contato", label: "Contato feito", description: "O aluno foi procurado." },
      { key: "proposta", label: "Proposta enviada", description: "Pacote e parcelas propostos.", requires: ["packageLessons"] },
      { key: "renovado", label: "Renovado", description: "Novo contrato emitido e aulas lançadas no extrato.", final: true },
      { key: "nao_renovou", label: "Não renovou", description: "O aluno não seguiu.", final: true, alternative: true },
    ],
    fields: [
      { key: "enrollmentId", label: "Matrícula", kind: "select", required: true },
      { key: "packageLessons", label: "Aulas no novo pacote", kind: "number" },
      { key: "installments", label: "Parcelas", kind: "number" },
      { key: "notes", label: "Observações", kind: "textarea" },
    ],
  },
  retencao: {
    key: "retencao",
    title: "Cancelamento e retenção",
    singular: "pedido",
    description: "Do pedido de cancelamento à retenção ou ao encerramento.",
    area: "CX",
    stages: [
      { key: "pedido", label: "Pedido de cancelamento", description: "O aluno pediu para cancelar." },
      { key: "tentativa", label: "Tentativa de retenção", description: "Oferta feita ao aluno.", requires: ["offer"] },
      { key: "retido", label: "Retido", description: "O aluno continua.", final: true },
      { key: "cancelado", label: "Cancelado", description: "O aluno é cancelado e as matrículas encerradas.", final: true, alternative: true },
    ],
    fields: [
      { key: "studentId", label: "Aluno", kind: "select", required: true },
      { key: "reason", label: "Motivo", kind: "select", required: true },
      { key: "offer", label: "Oferta de retenção", kind: "text" },
      { key: "notes", label: "Observações", kind: "textarea" },
    ],
  },
  campanha: {
    key: "campanha",
    title: "Campanhas",
    singular: "campanha",
    description: "Da ideia ao resultado em leads.",
    area: "Marketing",
    stages: [
      { key: "ideia", label: "Ideia", description: "Proposta de campanha." },
      { key: "producao", label: "Em produção", description: "Canal e público definidos.", requires: ["channel", "audience"] },
      { key: "no_ar", label: "No ar", description: "Campanha publicada.", requires: ["startsOn", "budgetCents"] },
      { key: "encerrada", label: "Encerrada", description: "Resultado registrado.", requires: ["leads"], final: true },
    ],
    fields: [
      { key: "name", label: "Nome", kind: "text", required: true },
      { key: "channel", label: "Canal", kind: "select" },
      { key: "audience", label: "Público", kind: "text" },
      { key: "budgetCents", label: "Orçamento", kind: "money" },
      { key: "startsOn", label: "Início", kind: "date" },
      { key: "endsOn", label: "Fim", kind: "date" },
      { key: "leads", label: "Leads gerados", kind: "number" },
      { key: "notes", label: "Observações", kind: "textarea" },
    ],
  },
};

export const SUBSTITUTION_REASONS = ["Férias", "Doença", "Compromisso pessoal", "Troca de agenda", "Outro"] as const;
export const RETENTION_REASONS = ["Preço", "Horário", "Mudança de cidade ou emprego", "Insatisfação com as aulas", "Pausa nos estudos", "Outro"] as const;
export const CAMPAIGN_CHANNELS = ["Redes sociais", "Buscador", "E-mail", "Indicação", "Evento", "Site", "Empresa parceira"] as const;

const filled = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

export function missingRequired(def: FlowDefinition, data: Record<string, unknown>): string[] {
  return def.fields.filter((f) => f.required && !filled(data[f.key])).map((f) => f.key);
}

/**
 * Caminho para mover um cartão: todas as etapas entre a atual e o destino, na ordem, que
 * precisam ser atravessadas (os efeitos de cada uma rodam). Voltar ou ir para etapa
 * alternativa não atravessa nada.
 */
export function transitionPath(def: FlowDefinition, from: string, to: string): { ok: true; path: Stage[] } | { ok: false; error: string } {
  const stages = def.stages;
  const iFrom = stages.findIndex((s) => s.key === from);
  const iTo = stages.findIndex((s) => s.key === to);
  if (iFrom < 0 || iTo < 0) return { ok: false, error: "Etapa inexistente neste fluxo." };
  if (iFrom === iTo) return { ok: false, error: "O cartão já está nessa etapa." };
  const current = stages[iFrom]!;
  const target = stages[iTo]!;
  if (current.final) {
    if (iTo !== 0) return { ok: false, error: "Cartão encerrado só pode ser reaberto na primeira etapa." };
    return { ok: true, path: [] };
  }
  if (target.alternative) return { ok: true, path: [target] };
  if (iTo < iFrom) return { ok: true, path: [] };
  return { ok: true, path: stages.slice(iFrom + 1, iTo + 1).filter((s) => !s.alternative) };
}

/** Área dona da etapa: a da própria etapa ou, sem ela, a do fluxo. */
export function stageArea(def: FlowDefinition, stageKey: string): Area {
  return def.stages.find((s) => s.key === stageKey)?.area ?? FLOW_AREA[def.key] ?? "adm";
}

/** Todas as áreas que o fluxo atravessa. */
export function flowAreas(def: FlowDefinition): Area[] {
  return [...new Set(def.stages.map((s) => stageArea(def, s.key)))];
}

/** Próxima etapa do caminho principal (sem as alternativas), ou null na última. */
export function nextStage(def: FlowDefinition, stageKey: string): Stage | null {
  const i = def.stages.findIndex((s) => s.key === stageKey);
  if (i < 0 || def.stages[i]!.final) return null;
  return def.stages.slice(i + 1).find((s) => !s.alternative) ?? null;
}

/** Faltas no nivelamento até o lead ir a Perdido com "Sem resposta" (decisão D17). */
export const ENTRY_MAX_NO_SHOWS = 3;

export function checkRequires(stage: Stage, data: Record<string, unknown>, def: FlowDefinition): string | null {
  const missing = (stage.requires ?? []).filter((k) => !filled(data[k]));
  if (!missing.length) return null;
  const labels = missing.map((k) => def.fields.find((f) => f.key === k)?.label ?? k);
  return `Para ${stage.label}, preencha: ${labels.join(", ")}.`;
}

/* -------------------------------------------------------------------- leads */

export const LEAD_STAGES = ["captado", "contato", "nivelamento", "proposta", "matriculado", "perdido"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  captado: "Captado",
  contato: "Contato feito",
  nivelamento: "Nivelamento",
  proposta: "Proposta enviada",
  matriculado: "Matriculado",
  perdido: "Perdido",
};
export const LEAD_ORIGINS = ["Site", "Redes sociais", "Indicação", "Buscador", "Empresa parceira", "Evento"] as const;
export const LEAD_LOST_REASONS = ["Preço", "Horário", "Sem resposta", "Escolheu outra escola", "Adiou os estudos"] as const;
