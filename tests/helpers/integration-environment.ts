// tests/helpers/integration-environment.ts
// Vitest setup file for the integration project: swaps DATABASE_URL to the verified test database
// before any module creates a PrismaClient, so services under test never touch dev data.

import { getVerifiedTestDatabaseUrl } from "./test-database-url";

process.env.DATABASE_URL = getVerifiedTestDatabaseUrl();
process.env.APP_URL = "http://localhost:3000";
