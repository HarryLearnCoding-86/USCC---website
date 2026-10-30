// tests/e2e/authentication.spec.ts
// End-to-end checks for Phase 1 auth on mobile and desktop viewports (SRS-AUTH-01, 06):
// anonymous redirect, wrong password, TD login with account page access, recorder blocked from it, logout.
// Requires the seeded dev database (pnpm db:seed); credentials come from the same SEED_* defaults.

import { expect, test, type Page } from "@playwright/test";
import { vi } from "../../src/i18n/vi";

const TECHNICAL_USERNAME = process.env.SEED_TD_USERNAME ?? "td_demo";
const TECHNICAL_PASSWORD = process.env.SEED_TD_PASSWORD ?? "TdDemo-2026!";
const RECORDER_USERNAME = process.env.SEED_RECORDER_USERNAME ?? "recorder_demo";
const RECORDER_PASSWORD = process.env.SEED_RECORDER_PASSWORD ?? "RecDemo-2026!";

/**
 * Fills and submits the login form.
 *
 * @param page - Playwright page on /login.
 * @param username - Login name.
 * @param password - Password.
 */
async function submitLoginForm(page: Page, username: string, password: string) {
  await page.getByLabel(vi.auth.usernameLabel).fill(username);
  await page.getByLabel(vi.auth.passwordLabel).fill(password);
  await page.getByRole("button", { name: vi.auth.loginButton }).click();
}

test("anonymous visitors are redirected to /login (SRS-AUTH-01)", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: vi.auth.loginTitle })).toBeVisible();
});

test("anonymous API calls get 401 JSON (SRS-AUTH-01)", async ({ request }) => {
  const response = await request.get("/api/users");
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
});

test("a wrong password shows the generic Vietnamese error", async ({ page }) => {
  await page.goto("/login");
  await submitLoginForm(page, TECHNICAL_USERNAME, "definitely-wrong");
  // Next.js also renders an empty role="alert" route announcer, so match the alert by its text.
  await expect(page.getByRole("alert").filter({ hasText: vi.auth.loginError })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("a TD signs in, opens account management and signs out", async ({ page }) => {
  await page.goto("/login");
  await submitLoginForm(page, TECHNICAL_USERNAME, TECHNICAL_PASSWORD);
  await expect(page.getByTestId("signed-in-user")).toContainText(vi.roles.TECHNICAL);
  await expect(page.getByRole("heading", { name: "Giải Demo USCC 2026" })).toBeVisible();

  await page.getByRole("link", { name: vi.nav.users }).click();
  await expect(page.getByRole("heading", { name: vi.adminUsers.pageTitle })).toBeVisible();
  await expect(page.getByTestId(`user-row-${RECORDER_USERNAME}`)).toBeVisible();

  await page.getByRole("button", { name: vi.auth.logoutButton }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("a recorder cannot open account management (SRS-AUTH-06)", async ({ page }) => {
  await page.goto("/login");
  await submitLoginForm(page, RECORDER_USERNAME, RECORDER_PASSWORD);
  await expect(page.getByTestId("signed-in-user")).toContainText(vi.roles.RECORDER);
  await expect(page.getByRole("link", { name: vi.nav.users })).toHaveCount(0);

  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(page.getByRole("heading", { name: vi.errors.forbiddenTitle })).toBeVisible();

  const apiResponse = await page.request.get("/api/users");
  expect(apiResponse.status()).toBe(403);
});
