// tests/helpers/prepare-test-database.ts
// Run by `pnpm test:integration` before Vitest: creates the test database if it does not exist and
// applies all migrations to it. Only ever targets the database named by TEST_DATABASE_URL.

import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { getVerifiedTestDatabaseUrl } from "./test-database-url";

/**
 * Creates the test database when missing, then runs `prisma migrate deploy` against it.
 */
async function prepareTestDatabase(): Promise<void> {
  const testDatabaseUrl = getVerifiedTestDatabaseUrl();
  const testDatabaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
  // Connect to the server's maintenance database to issue CREATE DATABASE.
  const maintenanceUrl = new URL(testDatabaseUrl);
  maintenanceUrl.pathname = "/postgres";

  const maintenanceClient = new PrismaClient({ datasources: { db: { url: maintenanceUrl.toString() } } });
  try {
    const existingDatabases = await maintenanceClient.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname = ${testDatabaseName}`;
    if (existingDatabases.length === 0) {
      // Identifiers cannot be bound as parameters; the name was validated by getVerifiedTestDatabaseUrl.
      await maintenanceClient.$executeRawUnsafe(`CREATE DATABASE "${testDatabaseName.replace(/"/g, "")}"`);
      console.warn(`Created test database ${testDatabaseName}`);
    }
  } finally {
    await maintenanceClient.$disconnect();
  }

  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  });
}

prepareTestDatabase().catch((error: unknown) => {
  console.error("Preparing the test database failed:", error);
  process.exitCode = 1;
});
