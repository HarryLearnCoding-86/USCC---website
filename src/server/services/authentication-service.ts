// src/server/services/authentication-service.ts
// Login use case: refuse locked usernames (SRS-AUTH-05), verify credentials, refuse inactive accounts, open a
// session, and record the attempt. Unknown usernames still run one argon2 verification and are throttled like real
// ones, so neither response time nor lockout behaviour reveals which usernames exist.

import type { Role } from "@prisma/client";
import { prisma } from "@/server/database/prisma-client";
import { hashPassword, verifyPassword } from "@/server/auth/password-hasher";
import { createSessionForUser, type SessionRequestMetadata } from "@/server/auth/session-store";
import type { LoginInput } from "@/server/auth/account-input-schemas";
import { evaluateLoginLock, LOGIN_ATTEMPT_LOOKBACK_MILLISECONDS } from "@/server/domain/login-throttle-rules";

/** Outcome of a login attempt. */
export type LoginOutcome =
  | {
      outcome: "SIGNED_IN";
      sessionToken: string;
      expiresAt: Date;
      user: { id: string; username: string; role: Role };
    }
  | { outcome: "INVALID_CREDENTIALS" }
  | { outcome: "ACCOUNT_INACTIVE" }
  | { outcome: "LOCKED"; retryAfterSeconds: number };

let timingEqualizerHash: Promise<string> | undefined;

/**
 * Lazily computes a throwaway argon2id hash used to burn the same CPU time for unknown usernames.
 *
 * @returns A valid argon2id hash of a random-looking constant.
 */
function getTimingEqualizerHash(): Promise<string> {
  timingEqualizerHash ??= hashPassword("timing-equalizer-not-a-real-password");
  return timingEqualizerHash;
}

/**
 * Authenticates an arbiter and opens a session.
 * "Account inactive" is only revealed after a correct password, so it leaks nothing to a guesser.
 *
 * @param loginInput - Validated username (lower-cased) and password.
 * @param requestMetadata - User agent and IP for the session record.
 * @param now - Current time; injectable for tests.
 * @returns SIGNED_IN with the raw session token, LOCKED with the wait time, or the reason for refusal.
 */
export async function loginWithPassword(
  loginInput: LoginInput,
  requestMetadata: SessionRequestMetadata,
  now: Date = new Date(),
): Promise<LoginOutcome> {
  const recentAttempts = await prisma.loginAttempt.findMany({
    where: { usernameAttempted: loginInput.username, attemptedAt: { gte: new Date(now.getTime() - LOGIN_ATTEMPT_LOOKBACK_MILLISECONDS) } },
    select: { wasSuccessful: true, attemptedAt: true },
  });
  const lockState = evaluateLoginLock(recentAttempts, now);
  if (lockState.isLocked) {
    // Not recorded: attempts during a lock must not extend it.
    return { outcome: "LOCKED", retryAfterSeconds: lockState.retryAfterSeconds };
  }

  const loginOutcome = await verifyCredentialsAndOpenSession(loginInput, requestMetadata);
  await prisma.loginAttempt.create({
    data: {
      usernameAttempted: loginInput.username,
      // An inactive account with the right password is not a guessing failure.
      wasSuccessful: loginOutcome.outcome !== "INVALID_CREDENTIALS",
      ipAddress: requestMetadata.ipAddress,
      attemptedAt: now,
    },
  });
  return loginOutcome;
}

/**
 * Checks the password and opens a session when it is correct and the account active.
 *
 * @param loginInput - Username and password.
 * @param requestMetadata - User agent and IP for the session record.
 * @returns The outcome (never LOCKED).
 */
async function verifyCredentialsAndOpenSession(loginInput: LoginInput, requestMetadata: SessionRequestMetadata): Promise<LoginOutcome> {
  const user = await prisma.user.findUnique({ where: { username: loginInput.username } });
  if (!user) {
    await verifyPassword(await getTimingEqualizerHash(), loginInput.password);
    return { outcome: "INVALID_CREDENTIALS" };
  }
  const isPasswordCorrect = await verifyPassword(user.passwordHash, loginInput.password);
  if (!isPasswordCorrect) {
    return { outcome: "INVALID_CREDENTIALS" };
  }
  if (!user.isActive) {
    return { outcome: "ACCOUNT_INACTIVE" };
  }
  const { sessionToken, expiresAt } = await createSessionForUser(user.id, requestMetadata);
  return {
    outcome: "SIGNED_IN",
    sessionToken,
    expiresAt,
    user: { id: user.id, username: user.username, role: user.role },
  };
}
