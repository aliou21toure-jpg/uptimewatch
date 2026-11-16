export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED";

/** An expected failure with a stable code; the API layer maps codes to HTTP statuses. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (what: string) => new DomainError("NOT_FOUND", `${what} not found`);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new DomainError("FORBIDDEN", message);
export const conflict = (message: string) => new DomainError("CONFLICT", message);
