// src/server/auth/session-token.ts
// Pure helpers for opaque session tokens: generation, hashing and sliding-expiry arithmetic.
// The browser holds the raw token; the database holds only its SHA-256 hash (see Session model),
// so a leaked database dump cannot be replayed as a cookie.

import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes = 256 bits of entropy, far beyond brute-force range. */
const SESSION_TOKEN_BYTES = 32;

/**
 * Refresh the stored expiry at most once per this interval. Writing on every request would add a
 * DB write to each page load; one write per 5 minutes keeps the 16 h idle window accurate enough.
 */
export const SESSION_REFRESH_INTERVAL_MILLISECONDS = 5 * 60 * 1000;

/**
 * Generates a new random session token.
 *
 * @returns A base64url string (43 characters) safe to put in a cookie.
 */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/**
 * Hashes a session token for storage and lookup.
 * SHA-256 without salt is appropriate here: the input is 256 random bits, not a guessable password.
 *
 * @param sessionToken - The raw token from the cookie.
 * @returns Lowercase hex SHA-256 digest (64 characters).
 */
export function hashSessionToken(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("hex");
}

/**
 * Computes when a session expires if no further activity happens.
 *
 * @param lastActivityAt - Time of the most recent request on the session.
 * @param idleTimeoutHours - Allowed inactivity in hours (SRS-AUTH-04: 16 by default).
 * @returns The expiry instant.
 */
export function computeSessionExpiry(lastActivityAt: Date, idleTimeoutHours: number): Date {
  return new Date(lastActivityAt.getTime() + idleTimeoutHours * 60 * 60 * 1000);
}

/**
 * Whether a session has passed its expiry.
 *
 * @param expiresAt - Stored expiry of the session.
 * @param now - Current time.
 * @returns true when the session must be rejected.
 */
export function isSessionExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Whether the sliding expiry should be pushed forward on this request.
 *
 * @param lastSeenAt - When the session's expiry was last refreshed.
 * @param now - Current time.
 * @returns true when at least SESSION_REFRESH_INTERVAL_MILLISECONDS have passed.
 */
export function shouldRefreshSession(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= SESSION_REFRESH_INTERVAL_MILLISECONDS;
}
