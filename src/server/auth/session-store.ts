// src/server/auth/session-store.ts
// Database-backed sessions: create on login, resolve on every request, delete on logout or deactivation.
// Resolving checks the user's isActive flag on every request, so a deactivated arbiter is locked out
// on their next request — well inside the 1-minute bound of SRS-AUTH-07.

import type { Role } from "@prisma/client";
import { getServerEnvironment } from "@/server/config/server-environment";
import { prisma } from "@/server/database/prisma-client";
import type { DatabaseClient } from "@/server/database/database-client";
import {
  computeSessionExpiry,
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  shouldRefreshSession,
} from "@/server/auth/session-token";

/** The authenticated arbiter attached to a request. */
export interface SignedInUser {
  id: string;
  username: string;
  role: Role;
}

/** Client details stored with a session for the TD's reference; both are optional. */
export interface SessionRequestMetadata {
  userAgent: string | null;
  ipAddress: string | null;
}

/** Longest user-agent string kept, so a hostile header cannot bloat the table. */
const MAXIMUM_USER_AGENT_LENGTH = 300;

/**
 * Creates a session for a user and returns the raw token for the cookie.
 *
 * @param userId - The user who just authenticated.
 * @param requestMetadata - User agent and IP of the login request.
 * @param now - Current time; injectable for tests.
 * @returns The raw session token (only ever sent to the browser) and its expiry.
 */
export async function createSessionForUser(
  userId: string,
  requestMetadata: SessionRequestMetadata,
  now: Date = new Date(),
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const sessionToken = generateSessionToken();
  const expiresAt = computeSessionExpiry(now, getServerEnvironment().SESSION_IDLE_TIMEOUT_HOURS);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt,
      lastSeenAt: now,
      userAgent: requestMetadata.userAgent?.slice(0, MAXIMUM_USER_AGENT_LENGTH) ?? null,
      ipAddress: requestMetadata.ipAddress,
    },
  });
  return { sessionToken, expiresAt };
}

/**
 * Resolves a raw session token to its user, enforcing expiry and account activation.
 * Expired sessions are deleted on sight. The sliding expiry is refreshed at most every few minutes.
 *
 * @param sessionToken - Raw token from the cookie.
 * @param now - Current time; injectable for tests.
 * @returns The signed-in user, or null when the token is unknown, expired or the account is inactive.
 */
export async function findSignedInUserBySessionToken(
  sessionToken: string,
  now: Date = new Date(),
): Promise<SignedInUser | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(sessionToken) },
    include: { user: { select: { id: true, username: true, role: true, isActive: true } } },
  });
  if (!session) {
    return null;
  }
  if (isSessionExpired(session.expiresAt, now) || !session.user.isActive) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (shouldRefreshSession(session.lastSeenAt, now)) {
    const idleTimeoutHours = getServerEnvironment().SESSION_IDLE_TIMEOUT_HOURS;
    // updateMany: a concurrent logout may have deleted the row; that must not throw.
    await prisma.session.updateMany({
      where: { id: session.id },
      data: { lastSeenAt: now, expiresAt: computeSessionExpiry(now, idleTimeoutHours) },
    });
  }
  return { id: session.user.id, username: session.user.username, role: session.user.role };
}

/**
 * Deletes the session identified by a raw token (logout). Unknown tokens are ignored.
 *
 * @param sessionToken - Raw token from the cookie.
 */
export async function deleteSessionByToken(sessionToken: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(sessionToken) } });
}

/**
 * Ends every session of a user, e.g. after deactivation or a password reset (SRS-AUTH-07).
 *
 * @param userId - The user whose sessions to end.
 * @param database - Transaction client when called inside a use-case transaction.
 * @returns Number of sessions ended.
 */
export async function deleteAllSessionsForUser(
  userId: string,
  database: DatabaseClient = prisma,
): Promise<number> {
  const deletion = await database.session.deleteMany({ where: { userId } });
  return deletion.count;
}
