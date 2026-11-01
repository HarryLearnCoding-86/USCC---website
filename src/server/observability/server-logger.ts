// src/server/observability/server-logger.ts
// Structured server logging and error reporting (NFR-14): one JSON object per line, with the request ID that the
// middleware stamps on every request, and never a password, session token or cookie value (keys that look like
// secrets are redacted). Errors go through a replaceable ErrorReporter, so an external tracker such as Sentry
// (AGENT_PROMPT.md §2, optional, enabled by SENTRY_DSN) can be plugged in without touching call sites.

/** Header carrying the per-request ID, set by src/middleware.ts. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Log severity. */
export type LogLevel = "info" | "warn" | "error";

/** Extra structured fields; values must be JSON-serialisable. */
export type LogFields = Record<string, unknown>;

/** Field names whose values are never written (NFR-14). */
const SECRET_FIELD_PATTERN = /password|token|cookie|secret|authorization/i;

/**
 * Replaces secret-looking fields with "[redacted]", recursively.
 *
 * @param fields - Fields to clean.
 * @returns A copy safe to log.
 */
export function redactSecretFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([fieldName, fieldValue]) => {
      if (SECRET_FIELD_PATTERN.test(fieldName)) return [fieldName, "[redacted]"];
      if (fieldValue && typeof fieldValue === "object" && !Array.isArray(fieldValue) && !(fieldValue instanceof Date)) {
        return [fieldName, redactSecretFields(fieldValue as LogFields)];
      }
      return [fieldName, fieldValue];
    }),
  );
}

/**
 * Writes one structured log line to stdout/stderr (collected by Docker).
 *
 * @param level - Severity.
 * @param eventName - Short stable event name, e.g. "api.unhandled_error".
 * @param fields - Structured context.
 */
export function logServerEvent(level: LogLevel, eventName: string, fields: LogFields = {}): void {
  const logLine = JSON.stringify({ timestamp: new Date().toISOString(), level, event: eventName, ...redactSecretFields(fields) });
  // stdout/stderr split only; the level inside the JSON is what log tools filter on. The lint rule allows warn/error.
  if (level === "error") console.error(logLine);
  else console.warn(logLine);
}

/** Receives unexpected server errors. */
export interface ErrorReporter {
  /**
   * Reports one error.
   * @param error - What was thrown.
   * @param context - Request ID, path and other redacted context.
   */
  reportError(error: unknown, context: LogFields): void;
}

/** Default reporter: a structured log line with the error name, message and stack. */
const logOnlyErrorReporter: ErrorReporter = {
  reportError(error, context) {
    const errorDetails = error instanceof Error ? { errorName: error.name, errorMessage: error.message, stack: error.stack } : { errorValue: String(error) };
    logServerEvent("error", "server.unhandled_error", { ...context, ...errorDetails });
  },
};

let activeErrorReporter: ErrorReporter = logOnlyErrorReporter;

/**
 * Replaces the error reporter (e.g. with a Sentry-backed one at startup).
 *
 * @param errorReporter - Reporter to use from now on.
 */
export function registerErrorReporter(errorReporter: ErrorReporter): void {
  activeErrorReporter = errorReporter;
}

/**
 * Reports an unexpected server error. Never throws: reporting must not turn one failure into two.
 *
 * @param error - What was thrown.
 * @param context - Request ID, path, method.
 */
export function reportServerError(error: unknown, context: LogFields): void {
  try {
    activeErrorReporter.reportError(error, redactSecretFields(context));
  } catch (reportingError) {
    console.error("Error reporter failed", reportingError);
  }
}
