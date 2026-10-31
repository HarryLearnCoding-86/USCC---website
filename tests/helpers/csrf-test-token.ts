// tests/helpers/csrf-test-token.ts
// Synchronous CSRF token derivation for building test requests (the app's deriveCsrfToken is async WebCrypto).
// Same algorithm: base64url(SHA-256("uscc-csrf:" + sessionToken)); a unit test checks both agree.

import { createHash } from "node:crypto";

/**
 * Computes the CSRF token the server expects for a session.
 *
 * @param sessionToken - Raw session token.
 * @returns The token for the X-CSRF-Token header.
 */
export function computeCsrfTokenForTest(sessionToken: string): string {
  return createHash("sha256").update(`uscc-csrf:${sessionToken}`).digest("base64url");
}
