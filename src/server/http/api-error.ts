// src/server/http/api-error.ts
// The single error type that services and guards throw to produce an HTTP error response.
// SRS §10.2: every API error body is { code, messageVi }; the code is stable for clients and tests,
// the message is Vietnamese text from vi.ts shown to the arbiter.

/** An expected, user-facing failure with its HTTP status. */
export class ApiError extends Error {
  /**
   * @param httpStatus - Status code to return (400, 401, 403, 404, 409, 413, 422, 429).
   * @param code - Stable machine-readable code, UPPER_SNAKE_CASE, e.g. "VERSION_CONFLICT".
   * @param messageVi - Vietnamese message from vi.ts.
   * @param details - Optional extra data for the client, e.g. per-field validation errors.
   */
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    readonly messageVi: string,
    readonly details?: unknown,
  ) {
    super(`${code}: ${messageVi}`);
    this.name = "ApiError";
  }
}

/** JSON body of every error response (SRS §10.2). */
export interface ApiErrorBody {
  code: string;
  messageVi: string;
  details?: unknown;
}

/**
 * Converts an ApiError to its JSON body.
 *
 * @param apiError - The error to serialise.
 * @returns The response body; details are included only when present.
 */
export function toApiErrorBody(apiError: ApiError): ApiErrorBody {
  return apiError.details === undefined
    ? { code: apiError.code, messageVi: apiError.messageVi }
    : { code: apiError.code, messageVi: apiError.messageVi, details: apiError.details };
}
