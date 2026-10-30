// playwright.config.ts
// Playwright end-to-end configuration. Runs against `pnpm dev` and the seeded dev database
// (pnpm db:seed). Viewports follow CLAUDE.md: mobile 390×844 for recorder flows, desktop 1440×900 for the TD,
// and 1920×1080 for the projection screen (projection-*.spec.ts run only there).

import { defineConfig, devices } from "@playwright/test";

const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  // One `next dev` server compiles pages on demand; Playwright's default (half the CPU cores, 8 on a 16-core
  // laptop) overloaded it so requests stalled and clicks landed before hydration. Two workers is stable.
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  // `next dev` compiles each route on its first request, which can take several seconds; the default 5 s
  // expect timeout then fails on the first hit of a route. Assertions are unchanged, only the wait is longer.
  expect: { timeout: 20_000 },
  // Multi-step flows touch many routes that all compile on first use under `next dev`; a fresh server with two
  // workers measured ~35 s for the first run of the confirmation flow (15 s once compiled).
  timeout: 90_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },
  projects: [
    { name: "mobile", testIgnore: /projection-.*\.spec\.ts/, use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", testIgnore: /(projection|offline)-.*\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "projection", testMatch: /projection-.*\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: {
    command: "pnpm dev",
    url: `${E2E_BASE_URL}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
