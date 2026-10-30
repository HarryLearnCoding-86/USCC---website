// src/server/auth/password-hasher.ts
// Password hashing utilities using argon2id.
// Responsibilities: hash plain-text passwords, verify a password against a stored hash.
// Never log or expose the plain-text password or the hash beyond what is needed.

import * as argon2 from "argon2";

/** Argon2id parameters chosen for defence-in-depth on a single-server deployment. */
const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB — OWASP recommendation for argon2id
  timeCost: 3, // 3 iterations
  parallelism: 1,
};

/**
 * Hashes a plain-text password with argon2id.
 *
 * @param plainPassword - The raw password supplied by the user.
 * @returns A promise resolving to the argon2id hash string.
 * @throws If hashing fails (e.g. argon2 native module not compiled).
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, ARGON2_OPTIONS);
}

/**
 * Verifies a plain-text password against a stored argon2id hash.
 * Returns false instead of throwing on a mismatch, so callers
 * do not need to distinguish "wrong password" from "error".
 *
 * @param storedHash - The hash value stored in the database.
 * @param plainPassword - The raw password supplied by the user.
 * @returns True when the password matches, false otherwise.
 */
export async function verifyPassword(
  storedHash: string,
  plainPassword: string,
): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, plainPassword);
  } catch {
    // argon2.verify throws on malformed hashes — treat as mismatch.
    return false;
  }
}

