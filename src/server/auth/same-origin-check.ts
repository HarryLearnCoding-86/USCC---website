// src/server/auth/same-origin-check.ts
// Rejects cross-site mutating requests by comparing the Origin header with the app's own origin.
// This is the Phase 1 CSRF defence, layered on SameSite=Lax cookies (NFR-07); the CSRF token
// required by SRS §10.2 is added in Phase 5 and documented in README "Known limitations".

/** HTTP methods that never change state and therefore skip the origin check. */
const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Decides whether a request may proceed based on its origin.
 *
 * @param httpMethod - Request method, any case.
 * @param originHeader - Value of the Origin header, or null when absent.
 * @param allowedOrigins - Origins the app is served from, e.g. ["https://kq.uscc.vn"].
 * @returns true for safe methods, and for mutating methods whose Origin matches an allowed origin.
 *   A mutating request without an Origin header is rejected: every browser that matters here sends it.
 */
export function isSameOriginRequest(
  httpMethod: string,
  originHeader: string | null,
  allowedOrigins: readonly string[],
): boolean {
  if (SAFE_HTTP_METHODS.has(httpMethod.toUpperCase())) {
    return true;
  }
  if (originHeader === null) {
    return false;
  }
  const normalizedOrigin = normalizeOrigin(originHeader);
  if (normalizedOrigin === null) {
    return false;
  }
  return allowedOrigins.some((allowedOrigin) => normalizeOrigin(allowedOrigin) === normalizedOrigin);
}

/**
 * Reduces a URL or origin string to scheme://host[:port] for comparison.
 *
 * @param urlOrOrigin - Any absolute URL or origin.
 * @returns The normalized origin, or null when the string is not a valid absolute URL.
 */
function normalizeOrigin(urlOrOrigin: string): string | null {
  try {
    return new URL(urlOrOrigin).origin;
  } catch {
    return null;
  }
}
