// src/server/auth/session-cookie.ts
// Name and attributes of the session cookie (SRS-AUTH-04: HttpOnly, Secure, SameSite=Lax).
// Kept free of Node-only imports so the Edge middleware can read the cookie name too.

/** Cookie that carries the raw session token. */
export const SESSION_COOKIE_NAME = "uscc_session";

/**
 * Browser-side lifetime of the cookie. The server enforces the real 16 h idle limit on every request;
 * the cookie just needs to outlive a multi-day tournament so the sliding expiry can keep working.
 */
const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Attributes accepted by NextResponse.cookies.set. */
export interface SessionCookieAttributes {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

/**
 * Builds the attributes for setting the session cookie.
 *
 * @param isSecure - Whether to set the Secure flag (true in production, see isSessionCookieSecure).
 * @returns Cookie attributes for a fresh session.
 */
export function buildSessionCookieAttributes(isSecure: boolean): SessionCookieAttributes {
  return {
    httpOnly: true,
    secure: isSecure,
    // Lax, not Strict: Strict would drop the cookie when a TD opens the app from a bookmark or chat link.
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * Builds the attributes that delete the session cookie.
 *
 * @param isSecure - Must match the flag used when the cookie was set.
 * @returns Cookie attributes with maxAge 0.
 */
export function buildExpiredSessionCookieAttributes(isSecure: boolean): SessionCookieAttributes {
  return { ...buildSessionCookieAttributes(isSecure), maxAge: 0 };
}
