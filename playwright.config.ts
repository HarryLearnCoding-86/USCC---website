// playwright.config.ts
// Playwright end-to-end configuration. Runs against `pnpm dev` and the seeded dev database
// (pnpm db:seed). Viewports follow CLAUDE.md: mobile 390×844 for recorder flows, desktop 1440×900 for the TD;
// the 1920×1080 projection project is added in Phase 3.

import { defineConfig, devices } from "@playwright/test";

const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
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
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: "pnpm dev",
    url: `${E2E_BASE_URL}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
