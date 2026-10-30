// vitest.config.ts
// Vitest configuration with two projects:
//   unit        — pure modules, no database (pnpm test:unit)
//   integration — services and route handlers against the migrated test database (pnpm test:integration)
// Playwright e2e tests live in tests/e2e and are run by Playwright, not Vitest.

import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const sharedResolve = { alias: { "@": resolve(__dirname, "src") } };

export default defineConfig({
  resolve: sharedResolve,
  test: {
    // Integration files share one database and wipe it between tests, so files must run one at a time.
    // Vitest only honours this at the root, not per project; unit tests are fast enough serially.
    fileParallelism: false,
    projects: [
      {
        resolve: sharedResolve,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: sharedResolve,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Points DATABASE_URL at TEST_DATABASE_URL before any Prisma client is created.
          setupFiles: ["tests/helpers/integration-environment.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
