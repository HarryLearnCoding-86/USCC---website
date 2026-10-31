// tests/helpers/test-database-url.ts
// Resolves the integration-test database URL and refuses anything that does not look like a test database,
// so destructive test helpers can never run against dev or production data (CLAUDE.md §2).

import { config as loadDotenv } from "dotenv";

/**
 * Returns TEST_DATABASE_URL after a safety check.
 *
 * @returns The test database connection string.
 * @throws Error when TEST_DATABASE_URL is missing or its database name does not contain "test".
 */
export function getVerifiedTestDatabaseUrl(): string {
  loadDotenv({ quiet: true });
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is not set. Copy it from .env.example into .env.");
  }
  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
  if (!databaseName.includes("test")) {
    throw new Error(`Refusing to use database "${databaseName}" for tests: its name must contain "test".`);
  }
  return testDatabaseUrl;
}
