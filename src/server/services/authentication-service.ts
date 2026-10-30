// src/server/services/authentication-service.ts
// Login use case: verify credentials, refuse inactive accounts, open a session.
// Unknown usernames still run one argon2 verification, so response time does not reveal
// which usernames exist.

import type { Role } from "@prisma/client";
import { prisma } from "@/server/database/prisma-client";
import { hashPassword, verifyPassword } from "@/server/auth/password-hasher";
import { createSessionForUser, type SessionRequestMetadata } from "@/server/auth/session-store";
import type { LoginInput } from "@/server/auth/account-input-schemas";

/** Outcome of a login attempt. */
export type LoginOutcome =
  | {
      outcome: "SIGNED_IN";
      sessionToken: string;
      expiresAt: Date;
      user: { id: string; username: string; role: Role };
    }
  | { outcome: "INVALID_CREDENTIALS" }
  | { outcome: "ACCOUNT_INACTIVE" };

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
 * @returns SIGNED_IN with the raw session token, or the reason for refusal.
 */
export async function loginWithPassword(
  loginInput: LoginInput,
  requestMetadata: SessionRequestMetadata,
): Promise<LoginOutcome> {
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
