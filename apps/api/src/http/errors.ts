import type { ContentfulStatusCode } from "hono/utils/http-status";

export type Issues = Record<string, string[]>;

/** Erro de regra de negócio com status HTTP e mensagem para a tela. */
export class DomainError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly issues?: Issues,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new DomainError(404, "not_found", `${what} não encontrado.`);
export const invalid = (field: string, message: string) => new DomainError(400, "validation", message, { [field]: [message] });
export const conflict = (field: string, message: string) => new DomainError(409, "conflict", message, { [field]: [message] });
export const unprocessable = (message: string) => new DomainError(422, "unprocessable", message);
