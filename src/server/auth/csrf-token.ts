// src/server/auth/csrf-token.ts
// CSRF tokens for every authenticated mutation (SRS §10.2, NFR-07), using the double-submit pattern bound to the
// session: token = base64url(SHA-256("uscc-csrf:" + sessionToken)). The browser keeps it in a readable,
// SameSite=Strict cookie and echoes it in the X-CSRF-Token header; another site can neither read the cookie nor
// compute the token, because the session cookie is HttpOnly. Uses WebCrypto only, so the Edge middleware and the
// Node route handlers derive the same value. Layered on top of the same-origin check and SameSite=Lax cookies.

/** Readable cookie carrying the CSRF token. */
export const CSRF_COOKIE_NAME = "uscc_csrf";
/** Request header the client echoes the token in. */
export const CSRF_HEADER_NAME = "x-csrf-token";

/** Same lifetime as the session cookie; the server-side session expiry is what matters. */
const CSRF_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Derives the CSRF token for a session.
 *
 * @param sessionToken - Raw session token from the HttpOnly cookie.
 * @returns base64url SHA-256 digest (43 characters).
 */
export async function deriveCsrfToken(sessionToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`uscc-csrf:${sessionToken}`));
  let binaryText = "";
  for (const digestByte of new Uint8Array(digest)) binaryText += String.fromCharCode(digestByte);
  return btoa(binaryText).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Checks a submitted CSRF token against the session, comparing in constant time.
 *
 * @param sessionToken - Raw session token, or undefined when there is no session cookie.
 * @param submittedToken - Value of the X-CSRF-Token header, or null.
 * @returns true only when both are present and match.
 */
export async function isCsrfTokenValid(sessionToken: string | undefined, submittedToken: string | null): Promise<boolean> {
  if (!sessionToken || !submittedToken) return false;
  const expectedToken = await deriveCsrfToken(sessionToken);
  if (expectedToken.length !== submittedToken.length) return false;
  let difference = 0;
  for (let characterIndex = 0; characterIndex < expectedToken.length; characterIndex++) {
    difference |= expectedToken.charCodeAt(characterIndex) ^ submittedToken.charCodeAt(characterIndex);
  }
  return difference === 0;
}

/** Attributes accepted by NextResponse.cookies.set for the CSRF cookie. */
export interface CsrfCookieAttributes {
  httpOnly: false;
  secure: boolean;
  sameSite: "strict";
  path: "/";
  maxAge: number;
}

/**
 * Attributes of the CSRF cookie. Not HttpOnly by design: same-origin scripts must read it.
 *
 * @param isSecure - Secure flag (true in production).
 * @param isExpired - true to delete the cookie.
 * @returns Cookie attributes.
 */
export function buildCsrfCookieAttributes(isSecure: boolean, isExpired = false): CsrfCookieAttributes {
  return { httpOnly: false, secure: isSecure, sameSite: "strict", path: "/", maxAge: isExpired ? 0 : CSRF_COOKIE_MAX_AGE_SECONDS };
}
