// tests/helpers/test-database.ts
// Helpers for integration tests: wipe the test database between tests and create fixture users.
// Wiping disables triggers for the transaction only (session_replication_role = replica) because the
// append-only trigger on result_events would otherwise block cleanup. Never used outside the test DB.

import type { Role } from "@prisma/client";
import { prisma } from "@/server/database/prisma-client";
import { hashPassword } from "@/server/auth/password-hasher";
import { getVerifiedTestDatabaseUrl } from "./test-database-url";

/** Tables wiped between tests, children first for readability (CASCADE handles order anyway). */
const TABLES_TO_WIPE = [
  "result_events",
  "results",
  "games",
  "rounds",
  "players",
  "result_codes",
  "pairing_imports",
  "column_mappings",
  "tournaments",
  "idempotency_records",
  "login_attempts",
  "sessions",
  "users",
];

/**
 * Removes every row from every application table in the test database.
 *
 * @throws Error when DATABASE_URL is not the verified test database.
 */
export async function wipeTestDatabase(): Promise<void> {
  if (process.env.DATABASE_URL !== getVerifiedTestDatabaseUrl()) {
    throw new Error("wipeTestDatabase called while DATABASE_URL is not the test database");
  }
  const tableList = TABLES_TO_WIPE.map((tableName) => `"${tableName}"`).join(", ");
  await prisma.$transaction([
    prisma.$executeRawUnsafe("SET LOCAL session_replication_role = replica"),
    prisma.$executeRawUnsafe(`TRUNCATE ${tableList} CASCADE`),
  ]);
}

/** Password used for every fixture user; a test value, not a real credential. */
export const FIXTURE_PASSWORD = "Fixture-Password-123";

/**
 * Creates a fixture arbiter account.
 *
 * @param username - Login name.
 * @param role - TECHNICAL or RECORDER.
 * @param isActive - Whether the account is active (default true).
 * @returns The created user.
 */
export async function createFixtureUser(username: string, role: Role, isActive = true) {
  return prisma.user.create({
    data: { username, role, isActive, passwordHash: await hashPassword(FIXTURE_PASSWORD) },
  });
}
